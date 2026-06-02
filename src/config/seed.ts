/**
 * Navidrome MCP Server - Settings form seed (pre-fill source)
 * Copyright (C) 2025
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readSettings, type SettingsFile } from './store.js';
import { DEFAULT_USER_AGENT, DEFAULT_LRCLIB_BASE } from '../constants/defaults.js';

/**
 * Recommended values for the optional radio/lyrics fields that gate a feature
 * on. Single source for two behaviours, keyed by the form's dotted field path
 * (see `app.js` FIELDS):
 *
 *   - First run (no settings.json): `importFromLegacyEnv` pre-fills these into
 *     the seed, so a fresh install gets working radio + lyrics without the user
 *     hunting for what to type.
 *   - Later runs (settings.json exists): the file is returned verbatim, and the
 *     form surfaces these as non-intrusive "suggested" hints *beside* any field
 *     the user left blank — never auto-filling, so a deliberate blank (e.g.
 *     radio turned off) is preserved.
 *
 * `features.radioBrowserBase` is intentionally absent: blank there means
 * SRV-based auto mirror selection, which is more robust than pinning a mirror.
 */
export const FORM_SUGGESTIONS = {
  'features.radioBrowserUserAgent': DEFAULT_USER_AGENT,
  'features.lyricsProvider': 'lrclib',
  'features.lrclibUserAgent': DEFAULT_USER_AGENT,
  'features.lrclibBase': DEFAULT_LRCLIB_BASE,
} as const;

/**
 * Compute the seed used to pre-fill the settings form.
 *
 * - If a `settings.json` already exists, it IS the seed (pre-fill from the file
 *   so the user edits what they have).
 * - Otherwise, import a partial config from legacy sources so existing users
 *   only have to verify + submit rather than re-type: `process.env` (covers the
 *   MCP-client JSON env and the shell) merged with a legacy project-root `.env`
 *   (covers dev installs). Optional radio/lyrics fields that gate a feature on
 *   are pre-filled with working defaults (see `importFromLegacyEnv`) so a
 *   fresh install gets functional features without hunting for values.
 *
 * This is import-only and never on the normal runtime path — `loadConfig()`
 * reads `settings.json` exclusively. Returns REAL values (including secrets);
 * masking for display happens at the HTTP layer.
 */
export function buildFormSeed(): SettingsFile {
  const existing = readSettings();
  if (existing !== null) {
    return existing;
  }
  return importFromLegacyEnv();
}

function importFromLegacyEnv(): SettingsFile {
  const envFile = readLegacyEnvFile();
  const get = (key: string): string | undefined => {
    const fromProcess = process.env[key];
    if (fromProcess !== undefined && fromProcess.trim() !== '') return fromProcess;
    const fromFile = envFile[key];
    if (fromFile !== undefined && fromFile.trim() !== '') return fromFile;
    return undefined;
  };

  const libsRaw = get('NAVIDROME_DEFAULT_LIBRARIES');
  const defaultLibraryIds = libsRaw !== undefined
    ? libsRaw.split(',').map(t => parseInt(t.trim(), 10)).filter(n => !Number.isNaN(n))
    : [];

  const port = toInt(get('WEBUI_PORT'), 8808);
  const cacheTtl = toInt(get('CACHE_TTL'), 300);
  const tokenExpiry = toInt(get('TOKEN_EXPIRY'), 86400);

  return {
    navidrome: {
      url: get('NAVIDROME_URL') ?? '',
      username: get('NAVIDROME_USERNAME') ?? '',
      password: get('NAVIDROME_PASSWORD') ?? '',
    },
    library: {
      defaultLibraryIds,
      filterCacheEnabled: get('NAVIDROME_FILTER_CACHE_ENABLED') !== 'false',
    },
    features: {
      lastFmApiKey: get('LASTFM_API_KEY') ?? null,
      // Radio + lyrics gating fields are pre-filled with the recommended
      // defaults on first run (the values are the single-sourced FORM_SUGGESTIONS
      // above, so the form's later-run "suggested" hints match exactly).
      radioBrowserUserAgent: get('RADIO_BROWSER_USER_AGENT') ?? FORM_SUGGESTIONS['features.radioBrowserUserAgent'],
      // Left blank by default: blank means SRV-based auto mirror selection, which
      // is more robust than pinning one mirror that may go offline.
      radioBrowserBase: get('RADIO_BROWSER_BASE') ?? null,
      lyricsProvider: get('LYRICS_PROVIDER') ?? FORM_SUGGESTIONS['features.lyricsProvider'],
      lrclibUserAgent: get('LRCLIB_USER_AGENT') ?? FORM_SUGGESTIONS['features.lrclibUserAgent'],
      lrclibBase: get('LRCLIB_BASE') ?? FORM_SUGGESTIONS['features.lrclibBase'],
    },
    playback: {
      mpvPath: get('MPV_PATH') ?? null,
      transcodeFormat: get('PLAYBACK_TRANSCODE_FORMAT') ?? 'raw',
      transcodeBitrate: get('PLAYBACK_TRANSCODE_BITRATE') ?? '192',
    },
    webui: {
      enabled: get('WEBUI_ENABLED') !== 'false',
      port,
      host: get('WEBUI_HOST') ?? null,
      expose: get('WEBUI_EXPOSE') === 'true',
      autoOpenBrowser: get('WEBUI_AUTO_OPEN_BROWSER') === 'true',
      persistAfterMcpExit: get('WEBUI_PERSIST_AFTER_MCP_EXIT') === 'true',
    },
    advanced: {
      debug: get('DEBUG') === 'true',
      cacheTtl,
      tokenExpiry,
    },
  };
}

function toInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Parse a legacy `.env` (project root or cwd), import-only. A plain KEY=VALUE
 * line parser — NOT a shell sourcer — so values with shell-special characters
 * (e.g. parens in `RADIO_BROWSER_USER_AGENT`) are read verbatim. Returns an
 * empty map when no `.env` is found.
 */
function readLegacyEnvFile(): Record<string, string> {
  for (const candidate of legacyEnvCandidates()) {
    try {
      return parseEnv(readFileSync(candidate, 'utf8'));
    } catch {
      /* try next candidate */
    }
  }
  return {};
}

function legacyEnvCandidates(): string[] {
  const candidates: string[] = [];
  try {
    // dist/config/seed.js → project root is two levels up; src/config/seed.ts
    // under tsx resolves the same way.
    const here = dirname(fileURLToPath(import.meta.url));
    candidates.push(join(here, '..', '..', '.env'));
  } catch {
    /* import.meta unavailable — skip */
  }
  candidates.push(join(process.cwd(), '.env'));
  return candidates;
}

function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    let key = line.slice(0, eq).trim();
    // Tolerate `export FOO=bar` lines from shell-style .env files.
    if (key.startsWith('export ')) key = key.slice('export '.length).trim();
    if (key === '') continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}
