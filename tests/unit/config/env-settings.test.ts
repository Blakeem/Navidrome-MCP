/**
 * process.env wins over a legacy project .env, so a value set through process.env holds either way.
 * The default-value assertions assume no project .env sets the same keys.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildEnvRuntimeSettings, buildFormSeed, readEnvAdminPassword } from '../../../src/config/env-settings.js';
import { logger } from '../../../src/utils/logger.js';

const ENV_KEYS = [
  'NAVIDROME_URL', 'NAVIDROME_USERNAME', 'NAVIDROME_PASSWORD',
  'WEBUI_PORT', 'WEBUI_EXPOSE', 'DEBUG', 'LASTFM_API_KEY',
  'RADIO_BROWSER_USER_AGENT', 'RADIO_BROWSER_BASE',
  'LYRICS_PROVIDER', 'LRCLIB_USER_AGENT', 'LRCLIB_BASE',
  'MCP_TRANSPORT', 'MCP_HTTP_HOST', 'MCP_HTTP_PORT', 'MCP_HTTP_EXPOSE',
  'MCP_HTTP_AUTH_TOKEN', 'WEBUI_ENABLED', 'WEBUI_PUBLIC_URL', 'WEBUI_TLS_CERT', 'WEBUI_TLS_KEY', 'WEBUI_AUTH_MODE', 'WEBUI_ADMIN_ACCESS', 'WEBUI_ADMIN_PASSWORD', 'NAVIDROME_DEFAULT_LIBRARIES', 'PLAYBACK_AUDIO_DEVICE', 'JUKEBOX_GUEST_QUEUE_LIMIT',
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

  it('imports the web remote TLS pair from WEBUI_TLS_CERT and WEBUI_TLS_KEY', () => {
    process.env['WEBUI_TLS_CERT'] = '/etc/ssl/full.pem';
    process.env['WEBUI_TLS_KEY'] = '/etc/ssl/key.pem';
    expect(buildFormSeed().webui?.tls).toEqual({ certPath: '/etc/ssl/full.pem', keyPath: '/etc/ssl/key.pem' });
  });

  it('imports the public URL from WEBUI_PUBLIC_URL, and null when unset', () => {
    expect(buildEnvRuntimeSettings().webui?.publicUrl).toBeNull();
    process.env['WEBUI_PUBLIC_URL'] = 'https://jukebox.example.org:8808';
    expect(buildEnvRuntimeSettings().webui?.publicUrl).toBe('https://jukebox.example.org:8808');
  });

  it('imports the guest song limit from JUKEBOX_GUEST_QUEUE_LIMIT, and 3 when unset or not an integer', () => {
    expect(buildEnvRuntimeSettings().jukebox?.guestQueueLimit).toBe(3);
    process.env['JUKEBOX_GUEST_QUEUE_LIMIT'] = '5';
    expect(buildEnvRuntimeSettings().jukebox?.guestQueueLimit).toBe(5);
    process.env['JUKEBOX_GUEST_QUEUE_LIMIT'] = 'many';
    expect(buildEnvRuntimeSettings().jukebox?.guestQueueLimit).toBe(3);
  });

  it('defaults the access mode to none and the admin access level to localhost', () => {
    expect(buildEnvRuntimeSettings().webui?.auth).toEqual({ mode: 'none', adminPasswordHash: null, adminAccess: 'localhost' });
  });

  it('imports WEBUI_AUTH_MODE and WEBUI_ADMIN_ACCESS, and never a hash', () => {
    process.env['WEBUI_AUTH_MODE'] = 'jukebox';
    process.env['WEBUI_ADMIN_ACCESS'] = 'lan';
    process.env['WEBUI_ADMIN_PASSWORD'] = 'correct horse battery';
    expect(buildEnvRuntimeSettings().webui?.auth).toEqual({ mode: 'jukebox', adminPasswordHash: null, adminAccess: 'lan' });
    expect(JSON.stringify(buildFormSeed())).not.toContain('correct horse battery');
  });

  it('falls back to password and localhost for unknown values and warns', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    process.env['WEBUI_AUTH_MODE'] = 'protected';
    process.env['WEBUI_ADMIN_ACCESS'] = 'everyone';
    try {
      expect(buildEnvRuntimeSettings().webui?.auth).toMatchObject({ mode: 'password', adminAccess: 'localhost' });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('WEBUI_AUTH_MODE="protected" is not supported (use one of none, password, jukebox), so password is used.'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('WEBUI_ADMIN_ACCESS="everyone" is not supported'));
    } finally {
      warn.mockRestore();
    }
  });

  it('reads WEBUI_ADMIN_PASSWORD verbatim and treats an empty value as unset', () => {
    expect(readEnvAdminPassword()).toBeNull();
    process.env['WEBUI_ADMIN_PASSWORD'] = ' padded password ';
    expect(readEnvAdminPassword()).toBe(' padded password ');
    process.env['WEBUI_ADMIN_PASSWORD'] = '';
    expect(readEnvAdminPassword()).toBeNull();
  });

  it('imports PLAYBACK_AUDIO_DEVICE as a device id with no name', () => {
    process.env['PLAYBACK_AUDIO_DEVICE'] = 'openal';
    expect(buildFormSeed().playback?.audioDevice).toEqual({ id: 'openal', name: null });
  });

  it.each([undefined, '  '])('leaves the audio device null for PLAYBACK_AUDIO_DEVICE %j', (value) => {
    if (value !== undefined) process.env['PLAYBACK_AUDIO_DEVICE'] = value;
    expect(buildFormSeed().playback?.audioDevice).toBeNull();
  });

  it('pre-fills working radio + lyrics defaults on first run (no store, no env)', () => {
    process.env['NAVIDROME_URL'] = 'http://env:4533';
    const seed = buildFormSeed();
    // Pre-filled gate fields let a fresh install enable radio and lyrics without looking up values.
    expect(seed.features?.radioBrowserUserAgent).toBe('Navidrome-MCP');
    expect(seed.features?.lyricsProvider).toBe('lrclib');
    expect(seed.features?.lrclibUserAgent).toBe('Navidrome-MCP');
    expect(seed.features?.lrclibBase).toBe('https://lrclib.net');
    // A blank radio base selects a mirror by SRV lookup.
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

  it('defaults the transport to stdio (unexposed) when no env is set', () => {
    process.env['NAVIDROME_URL'] = 'http://env:4533';
    const seed = buildFormSeed();
    expect(seed.transport?.type).toBe('stdio');
    expect(seed.transport?.port).toBe(3000);
    expect(seed.transport?.host ?? null).toBeNull();
    expect(seed.transport?.expose).toBe(false);
  });

  it('imports the http transport from env vars', () => {
    process.env['NAVIDROME_URL'] = 'http://env:4533';
    process.env['MCP_TRANSPORT'] = 'http';
    process.env['MCP_HTTP_HOST'] = '10.0.0.5';
    process.env['MCP_HTTP_PORT'] = '8080';
    process.env['MCP_HTTP_EXPOSE'] = 'true';
    process.env['MCP_HTTP_AUTH_TOKEN'] = 'tok-123';
    const seed = buildFormSeed();
    expect(seed.transport?.type).toBe('http');
    expect(seed.transport?.host).toBe('10.0.0.5');
    expect(seed.transport?.port).toBe(8080);
    expect(seed.transport?.expose).toBe(true);
    expect(seed.transport?.authToken).toBe('tok-123');
  });

  it('ignores an unrecognized MCP_TRANSPORT value (falls back to stdio) and warns', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    process.env['NAVIDROME_URL'] = 'http://env:4533';
    process.env['MCP_TRANSPORT'] = 'HTTP';
    try {
      expect(buildFormSeed().transport?.type).toBe('stdio');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('MCP_TRANSPORT="HTTP" is not supported'));
    } finally {
      warn.mockRestore();
    }
  });

  it('warns and keeps the default for a non-numeric integer env var', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    process.env['NAVIDROME_URL'] = 'http://env:4533';
    process.env['WEBUI_PORT'] = 'eighty';
    try {
      expect(buildFormSeed().webui?.port).toBe(8808);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('WEBUI_PORT="eighty" is not an integer'));
    } finally {
      warn.mockRestore();
    }
  });

  it('warns and keeps the default for a boolean env var that is not true or false', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    process.env['NAVIDROME_URL'] = 'http://env:4533';
    process.env['WEBUI_ENABLED'] = 'FALSE';
    process.env['MCP_HTTP_EXPOSE'] = '1';
    try {
      const seed = buildFormSeed();
      expect(seed.webui?.enabled).toBe(true);
      expect(seed.transport?.expose).toBe(false);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('WEBUI_ENABLED="FALSE" is not true or false'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('MCP_HTTP_EXPOSE="1" is not true or false'));
    } finally {
      warn.mockRestore();
    }
  });

  it('keeps numeric library IDs and warns naming each rejected token', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    process.env['NAVIDROME_URL'] = 'http://env:4533';
    process.env['NAVIDROME_DEFAULT_LIBRARIES'] = '1, Music,2 3,';
    try {
      expect(buildFormSeed().library?.defaultLibraryIds).toEqual([1]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('NAVIDROME_DEFAULT_LIBRARIES ignores "Music", "2 3"'));
    } finally {
      warn.mockRestore();
    }
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
