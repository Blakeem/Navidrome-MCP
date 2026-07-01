/**
 * Unit tests for config resolution: store → flat Config mapping (the four
 * round-trip edge cases), loadConfig, and resolveConfigState branching.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, resolveConfigState } from '../../../src/config.js';

// process.execPath (the node binary) is guaranteed to exist and be executable —
// a stable stand-in for "a valid mpv path" that doesn't depend on mpv install.
const EXEC = process.execPath;

const BASE = {
  navidrome: { url: 'http://h:4533', username: 'u', password: 'p' },
};

describe('config resolution', () => {
  let dir: string;
  let savedCfg: string | undefined;
  let file: string;

  beforeEach(() => {
    savedCfg = process.env['NAVIDROME_CONFIG_PATH'];
    dir = mkdtempSync(join(tmpdir(), 'nd-cfg-'));
    file = join(dir, 'settings.json');
    process.env['NAVIDROME_CONFIG_PATH'] = file;
  });

  afterEach(() => {
    if (savedCfg === undefined) delete process.env['NAVIDROME_CONFIG_PATH'];
    else process.env['NAVIDROME_CONFIG_PATH'] = savedCfg;
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (obj: unknown): void => writeFileSync(file, JSON.stringify(obj));

  describe('loadConfig mapping', () => {
    it('maps the core required fields', async () => {
      write(BASE);
      const c = await loadConfig();
      expect(c.navidromeUrl).toBe('http://h:4533');
      expect(c.navidromeUsername).toBe('u');
      expect(c.navidromePassword).toBe('p');
    });

    it('treats an empty defaultLibraryIds as undefined (all libraries)', async () => {
      write({ ...BASE, library: { defaultLibraryIds: [] } });
      expect((await loadConfig()).defaultLibraryIds).toBeUndefined();
    });

    it('passes a non-empty defaultLibraryIds through', async () => {
      write({ ...BASE, library: { defaultLibraryIds: [1, 2] } });
      expect((await loadConfig()).defaultLibraryIds).toEqual([1, 2]);
    });

    it('leaves radioBrowserBaseOverride undefined for null (SRV resolution)', async () => {
      write({ ...BASE, features: { radioBrowserBase: null } });
      expect((await loadConfig()).radioBrowserBaseOverride).toBeUndefined();
    });

    it('sets radioBrowserBaseOverride for an explicit URL', async () => {
      write({ ...BASE, features: { radioBrowserBase: 'https://mirror.example/api' } });
      expect((await loadConfig()).radioBrowserBaseOverride).toBe('https://mirror.example/api');
    });

    it('falls back to the lrclib default when lrclibBase is null', async () => {
      write({ ...BASE, features: { lrclibBase: null } });
      expect((await loadConfig()).lrclibBase).toBe('https://lrclib.net');
    });

    it('derives playback OFF + omits mpvPath for a non-executable path', async () => {
      write({ ...BASE, playback: { mpvPath: '/no/such/mpv' } });
      const c = await loadConfig();
      expect(c.features.playback).toBe(false);
      expect(c.mpvPath).toBeUndefined();
    });

    it('derives playback ON + keeps mpvPath for an executable path', async () => {
      write({ ...BASE, playback: { mpvPath: EXEC } });
      const c = await loadConfig();
      expect(c.features.playback).toBe(true);
      expect(c.mpvPath).toBe(EXEC);
    });

    it('flips host to 0.0.0.0 when expose is set and no explicit host', async () => {
      write({ ...BASE, webui: { expose: true } });
      expect((await loadConfig()).webui.host).toBe('0.0.0.0');
    });

    it('lets an explicit host win over expose', async () => {
      write({ ...BASE, webui: { expose: true, host: '127.0.0.1' } });
      expect((await loadConfig()).webui.host).toBe('127.0.0.1');
    });

    it('defaults the transport to stdio on loopback:3000 when unset', async () => {
      write(BASE);
      const c = await loadConfig();
      expect(c.transport).toEqual({ type: 'stdio', host: '127.0.0.1', port: 3000, expose: false });
    });

    it('maps an explicit http transport block', async () => {
      write({ ...BASE, transport: { type: 'http', host: '10.0.0.5', port: 9000 } });
      const c = await loadConfig();
      expect(c.transport).toEqual({ type: 'http', host: '10.0.0.5', port: 9000, expose: false });
    });

    it('stays on loopback when host is blank and expose is unset', async () => {
      write({ ...BASE, transport: { type: 'http', host: '   ' } });
      const c = await loadConfig();
      expect(c.transport.host).toBe('127.0.0.1');
      expect(c.transport.port).toBe(3000);
    });

    it('flips the bind to 0.0.0.0 when expose is set and no explicit host', async () => {
      write({ ...BASE, transport: { type: 'http', expose: true } });
      const c = await loadConfig();
      expect(c.transport.host).toBe('0.0.0.0');
      expect(c.transport.expose).toBe(true);
    });

    it('lets an explicit transport host win over expose', async () => {
      write({ ...BASE, transport: { type: 'http', expose: true, host: '127.0.0.1' } });
      expect((await loadConfig()).transport.host).toBe('127.0.0.1');
      write({ ...BASE, transport: { type: 'http', expose: false, host: '1.2.3.4' } });
      expect((await loadConfig()).transport.host).toBe('1.2.3.4');
    });

    it('maps a non-empty transport authToken through, blank → undefined', async () => {
      write({ ...BASE, transport: { type: 'http', authToken: '  secret-token  ' } });
      expect((await loadConfig()).transport.authToken).toBe('secret-token');
      write({ ...BASE, transport: { type: 'http', authToken: '   ' } });
      expect((await loadConfig()).transport.authToken).toBeUndefined();
    });

    it('rejects an unknown transport type', async () => {
      write({ ...BASE, transport: { type: 'websocket' } });
      // SettingsFileSchema rejects the bad enum → store reads as unconfigured.
      expect(await resolveConfigState()).toEqual({ configured: false });
    });

    it('requires BOTH provider and user agent to enable lyrics', async () => {
      write({ ...BASE, features: { lyricsProvider: 'lrclib' } });
      expect((await loadConfig()).features.lyrics).toBe(false);

      write({ ...BASE, features: { lyricsProvider: 'lrclib', lrclibUserAgent: 'UA/1.0' } });
      expect((await loadConfig()).features.lyrics).toBe(true);
    });

    it('derives lastfm + radioBrowser from key/UA presence', async () => {
      write({ ...BASE, features: { lastFmApiKey: 'k', radioBrowserUserAgent: 'UA/1.0' } });
      const c = await loadConfig();
      expect(c.features.lastfm).toBe(true);
      expect(c.features.radioBrowser).toBe(true);
    });
  });

  describe('loadConfig errors', () => {
    it('throws when no store exists', async () => {
      await expect(loadConfig()).rejects.toThrow();
    });

    it('throws when the URL is missing', async () => {
      write({ navidrome: { username: 'u', password: 'p' } });
      await expect(loadConfig()).rejects.toThrow();
    });
  });

  describe('resolveConfigState', () => {
    it('is configured for a valid store', async () => {
      write(BASE);
      expect(await resolveConfigState()).toEqual({ configured: true, config: expect.any(Object) });
    });

    it('is unconfigured when the store is absent', async () => {
      expect(await resolveConfigState()).toEqual({ configured: false });
    });

    it('is unconfigured when the URL is blank', async () => {
      write({ navidrome: { url: '   ', username: 'u', password: 'p' } });
      expect(await resolveConfigState()).toEqual({ configured: false });
    });

    it('is unconfigured for corrupt JSON', async () => {
      writeFileSync(file, '{ broken');
      expect(await resolveConfigState()).toEqual({ configured: false });
    });

    it('is unconfigured when present-but-invalid (bad URL)', async () => {
      write({ navidrome: { url: 'not-a-url', username: 'u', password: 'p' } });
      expect(await resolveConfigState()).toEqual({ configured: false });
    });
  });
});
