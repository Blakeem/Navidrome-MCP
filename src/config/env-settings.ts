/**
 * Navidrome MCP Server - Settings built from the environment (form seed and headless runtime fallback)
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readSettings, type SettingsFile } from './store.js';
import {
  DEFAULT_LRCLIB_BASE,
  DEFAULT_MCP_HTTP_PORT,
  DEFAULT_MUSICBRAINZ_USER_AGENT,
  DEFAULT_TOKEN_EXPIRY_SECONDS,
  DEFAULT_TRANSCODE_BITRATE,
  DEFAULT_TRANSCODE_FORMAT,
  DEFAULT_USER_AGENT,
  DEFAULT_WEBUI_PORT,
} from '../constants/defaults.js';
import { logger } from '../utils/logger.js';

/**
 * A first run pre-fills these. Later runs only hint them beside blank fields, so a deliberate blank
 * stays. `radioBrowserBase` has no entry, since a blank value selects a mirror by SRV.
 */
export const FORM_SUGGESTIONS = {
  'features.musicBrainzUserAgent': DEFAULT_MUSICBRAINZ_USER_AGENT,
  'features.radioBrowserUserAgent': DEFAULT_USER_AGENT,
  'features.lyricsProvider': 'lrclib',
  'features.lrclibUserAgent': DEFAULT_USER_AGENT,
  'features.lrclibBase': DEFAULT_LRCLIB_BASE,
} as const;

/**
 * Without a usable settings.json, the seed imports `process.env` and a legacy `.env`, so an
 * upgrading user verifies instead of retyping. It returns real secrets, which the routes mask.
 */
export function buildFormSeed(): SettingsFile {
  const existing = readSettings();
  if (existing !== null) {
    return existing;
  }
  return importFromLegacyEnv();
}

/**
 * Reads `process.env` only, since `.env` files are import-only. It skips the radio and lyrics
 * suggestions, so those features turn on only by explicit env opt-in.
 */
export function buildEnvRuntimeSettings(): SettingsFile {
  return settingsFromEnvSource((key) => {
    const value = process.env[key];
    return value !== undefined && value.trim() !== '' ? value : undefined;
  }, false);
}

function importFromLegacyEnv(): SettingsFile {
  const envFile = readLegacyEnvFile();
  return settingsFromEnvSource((key: string): string | undefined => {
    const fromProcess = process.env[key];
    if (fromProcess !== undefined && fromProcess.trim() !== '') return fromProcess;
    const fromFile = envFile[key];
    if (fromFile !== undefined && fromFile.trim() !== '') return fromFile;
    return undefined;
  }, true);
}

/**
 * `applySuggestions` is true only for the form seed, which the user reviews before saving.
 * MusicBrainz keeps its default either way, since it gates no feature.
 */
function settingsFromEnvSource(
  get: (key: string) => string | undefined,
  applySuggestions: boolean,
): SettingsFile {
  const suggest = (key: keyof typeof FORM_SUGGESTIONS): string | null =>
    applySuggestions ? FORM_SUGGESTIONS[key] : null;

  const defaultLibraryIds = toLibraryIds(get('NAVIDROME_DEFAULT_LIBRARIES'));

  const port = toInt('WEBUI_PORT', get('WEBUI_PORT'), DEFAULT_WEBUI_PORT);
  const tokenExpiry = toInt('TOKEN_EXPIRY', get('TOKEN_EXPIRY'), DEFAULT_TOKEN_EXPIRY_SECONDS);

  const transportType = toTransportType(get('MCP_TRANSPORT'));
  const transportPort = toInt('MCP_HTTP_PORT', get('MCP_HTTP_PORT'), DEFAULT_MCP_HTTP_PORT);

  return {
    navidrome: {
      url: get('NAVIDROME_URL') ?? '',
      username: get('NAVIDROME_USERNAME') ?? '',
      password: get('NAVIDROME_PASSWORD') ?? '',
    },
    transport: {
      type: transportType,
      host: get('MCP_HTTP_HOST') ?? null,
      port: transportPort,
      expose: toBool('MCP_HTTP_EXPOSE', get('MCP_HTTP_EXPOSE'), false),
      authToken: get('MCP_HTTP_AUTH_TOKEN') ?? null,
      allowedHosts: toList(get('MCP_HTTP_ALLOWED_HOSTS')),
      allowedOrigins: toList(get('MCP_HTTP_ALLOWED_ORIGINS')),
    },
    library: {
      defaultLibraryIds,
      filterCacheEnabled: toBool('NAVIDROME_FILTER_CACHE_ENABLED', get('NAVIDROME_FILTER_CACHE_ENABLED'), true),
    },
    features: {
      lastFmApiKey: get('LASTFM_API_KEY') ?? null,
      musicBrainzUserAgent: get('MUSICBRAINZ_USER_AGENT') ?? FORM_SUGGESTIONS['features.musicBrainzUserAgent'],
      radioBrowserUserAgent: get('RADIO_BROWSER_USER_AGENT') ?? suggest('features.radioBrowserUserAgent'),
      radioBrowserBase: get('RADIO_BROWSER_BASE') ?? null,
      lyricsProvider: get('LYRICS_PROVIDER') ?? suggest('features.lyricsProvider'),
      lrclibUserAgent: get('LRCLIB_USER_AGENT') ?? suggest('features.lrclibUserAgent'),
      lrclibBase: get('LRCLIB_BASE') ?? suggest('features.lrclibBase'),
    },
    playback: {
      mpvPath: get('MPV_PATH') ?? null,
      transcodeFormat: get('PLAYBACK_TRANSCODE_FORMAT') ?? DEFAULT_TRANSCODE_FORMAT,
      transcodeBitrate: get('PLAYBACK_TRANSCODE_BITRATE') ?? DEFAULT_TRANSCODE_BITRATE,
    },
    webui: {
      enabled: toBool('WEBUI_ENABLED', get('WEBUI_ENABLED'), true),
      port,
      host: get('WEBUI_HOST') ?? null,
      expose: toBool('WEBUI_EXPOSE', get('WEBUI_EXPOSE'), false),
      allowedHosts: toList(get('WEBUI_ALLOWED_HOSTS')),
      autoOpenBrowser: toBool('WEBUI_AUTO_OPEN_BROWSER', get('WEBUI_AUTO_OPEN_BROWSER'), false),
      persistAfterMcpExit: toBool('WEBUI_PERSIST_AFTER_MCP_EXIT', get('WEBUI_PERSIST_AFTER_MCP_EXIT'), false),
      visualizer: toBool('WEBUI_VISUALIZER', get('WEBUI_VISUALIZER'), true),
    },
    advanced: {
      debug: toBool('DEBUG', get('DEBUG'), false),
      tokenExpiry,
    },
  };
}

function toInt(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = parseInt(value, 10);
  if (!Number.isNaN(n)) return n;
  logger.warn(`${name}="${value}" is not an integer, so ${fallback} is used.`);
  return fallback;
}

function toBool(name: string, value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  logger.warn(`${name}="${value}" is not true or false, so ${String(fallback)} is used.`);
  return fallback;
}

function toLibraryIds(value: string | undefined): number[] {
  if (value === undefined) return [];
  const tokens = value.split(',').map((t) => t.trim()).filter((t) => t !== '');
  const validTokens = tokens.filter((t) => /^\d+$/.test(t));
  const invalidTokens = tokens.filter((t) => !/^\d+$/.test(t));
  if (invalidTokens.length > 0) {
    const quoted = invalidTokens.map((t) => `"${t}"`).join(', ');
    logger.warn(`NAVIDROME_DEFAULT_LIBRARIES ignores ${quoted}, since a library ID is a number.`);
  }
  return validTokens.map((t) => parseInt(t, 10));
}

function toTransportType(value: string | undefined): 'stdio' | 'http' {
  if (value === 'http') return 'http';
  if (value !== undefined && value !== 'stdio') {
    logger.warn(`MCP_TRANSPORT="${value}" is not supported (use http or stdio), so stdio is used.`);
  }
  return 'stdio';
}

function toList(value: string | undefined): string[] | null {
  if (value === undefined) return null;
  const items = value.split(',').map((s) => s.trim()).filter((s) => s !== '');
  return items.length > 0 ? items : null;
}

function readLegacyEnvFile(): Record<string, string> {
  for (const candidate of legacyEnvCandidates()) {
    try {
      return parseEnv(readFileSync(candidate, 'utf8'));
    } catch {
      // A missing or unreadable candidate falls through to the next one.
    }
  }
  return {};
}

function legacyEnvCandidates(): string[] {
  return [
    // Both dist/config/env-settings.js and src/config/env-settings.ts sit two levels below the
    // project root.
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env'),
    join(process.cwd(), '.env'),
  ];
}

/**
 * A KEY=VALUE line parser, not a shell sourcer, so shell-special characters such as the parens in
 * `RADIO_BROWSER_USER_AGENT` are read verbatim.
 */
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
