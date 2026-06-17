/**
 * Unit tests for buildFormSeed — the settings-form pre-fill source.
 *
 * Deterministic aspects only: that an existing store wins over env, and that
 * process.env values map to the right nested fields (process.env takes
 * precedence over any legacy .env, so these assertions don't depend on whether
 * a project .env is present).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFormSeed } from '../../../src/config/seed.js';

const ENV_KEYS = [
  'NAVIDROME_URL', 'NAVIDROME_USERNAME', 'NAVIDROME_PASSWORD',
  'WEBUI_PORT', 'WEBUI_EXPOSE', 'DEBUG', 'LASTFM_API_KEY',
  'RADIO_BROWSER_USER_AGENT', 'RADIO_BROWSER_BASE',
  'LYRICS_PROVIDER', 'LRCLIB_USER_AGENT', 'LRCLIB_BASE',
  'MCP_TRANSPORT', 'MCP_HTTP_HOST', 'MCP_HTTP_PORT',
];

describe('buildFormSeed', () => {
  let dir: string;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = { NAVIDROME_CONFIG_PATH: process.env['NAVIDROME_CONFIG_PATH'] };
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    dir = mkdtempSync(join(tmpdir(), 'nd-seed-'));
    process.env['NAVIDROME_CONFIG_PATH'] = join(dir, 'settings.json');
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns the existing store when one is present (wins over env)', () => {
    writeFileSync(
      process.env['NAVIDROME_CONFIG_PATH']!,
      JSON.stringify({ navidrome: { url: 'http://from-store:4533' } }),
    );
    process.env['NAVIDROME_URL'] = 'http://from-env:4533';
    expect(buildFormSeed().navidrome?.url).toBe('http://from-store:4533');
  });

  it('imports from process.env when no store exists', () => {
    process.env['NAVIDROME_URL'] = 'http://env-only:4533';
    process.env['NAVIDROME_USERNAME'] = 'envuser';
    process.env['NAVIDROME_PASSWORD'] = 'envpass';
    const seed = buildFormSeed();
    expect(seed.navidrome?.url).toBe('http://env-only:4533');
    expect(seed.navidrome?.username).toBe('envuser');
    expect(seed.navidrome?.password).toBe('envpass');
  });

  it('pre-fills working radio + lyrics defaults on first run (no store, no env)', () => {
    process.env['NAVIDROME_URL'] = 'http://env:4533';
    const seed = buildFormSeed();
    // The fields that gate radio/lyrics ON get sensible defaults so a fresh
    // install works without hunting for values.
    expect(seed.features?.radioBrowserUserAgent).toBe('Navidrome-MCP');
    expect(seed.features?.lyricsProvider).toBe('lrclib');
    expect(seed.features?.lrclibUserAgent).toBe('Navidrome-MCP');
    expect(seed.features?.lrclibBase).toBe('https://lrclib.net');
    // Radio base stays blank → SRV auto mirror selection (not pinned).
    expect(seed.features?.radioBrowserBase ?? null).toBeNull();
  });

  it('lets env override the pre-filled radio/lyrics defaults', () => {
    process.env['NAVIDROME_URL'] = 'http://env:4533';
    process.env['RADIO_BROWSER_USER_AGENT'] = 'MyAgent';
    process.env['LRCLIB_BASE'] = 'https://lrclib.example';
    const seed = buildFormSeed();
    expect(seed.features?.radioBrowserUserAgent).toBe('MyAgent');
    expect(seed.features?.lrclibBase).toBe('https://lrclib.example');
  });

  it('defaults the transport to stdio when no env is set', () => {
    process.env['NAVIDROME_URL'] = 'http://env:4533';
    const seed = buildFormSeed();
    expect(seed.transport?.type).toBe('stdio');
    expect(seed.transport?.port).toBe(3000);
    expect(seed.transport?.host ?? null).toBeNull();
  });

  it('imports the http transport from env vars', () => {
    process.env['NAVIDROME_URL'] = 'http://env:4533';
    process.env['MCP_TRANSPORT'] = 'http';
    process.env['MCP_HTTP_HOST'] = '0.0.0.0';
    process.env['MCP_HTTP_PORT'] = '8080';
    const seed = buildFormSeed();
    expect(seed.transport?.type).toBe('http');
    expect(seed.transport?.host).toBe('0.0.0.0');
    expect(seed.transport?.port).toBe(8080);
  });

  it('ignores an unrecognized MCP_TRANSPORT value (falls back to stdio)', () => {
    process.env['NAVIDROME_URL'] = 'http://env:4533';
    process.env['MCP_TRANSPORT'] = 'bogus';
    expect(buildFormSeed().transport?.type).toBe('stdio');
  });

  it('coerces typed env vars (port int, expose/debug bool)', () => {
    process.env['NAVIDROME_URL'] = 'http://env:4533';
    process.env['WEBUI_PORT'] = '9100';
    process.env['WEBUI_EXPOSE'] = 'true';
    process.env['DEBUG'] = 'true';
    const seed = buildFormSeed();
    expect(seed.webui?.port).toBe(9100);
    expect(seed.webui?.expose).toBe(true);
    expect(seed.advanced?.debug).toBe(true);
  });
});
