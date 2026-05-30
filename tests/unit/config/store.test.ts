/**
 * Unit tests for the settings store reader/writer (read / atomic write).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSettings, writeSettings, type SettingsFile } from '../../../src/config/store.js';

describe('settings store read/write', () => {
  let dir: string;
  let savedCfg: string | undefined;

  beforeEach(() => {
    savedCfg = process.env['NAVIDROME_CONFIG_PATH'];
    dir = mkdtempSync(join(tmpdir(), 'nd-store-'));
    process.env['NAVIDROME_CONFIG_PATH'] = join(dir, 'settings.json');
  });

  afterEach(() => {
    if (savedCfg === undefined) delete process.env['NAVIDROME_CONFIG_PATH'];
    else process.env['NAVIDROME_CONFIG_PATH'] = savedCfg;
    rmSync(dir, { recursive: true, force: true });
  });

  describe('readSettings', () => {
    it('returns null when the file is absent', () => {
      expect(readSettings()).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      writeFileSync(process.env['NAVIDROME_CONFIG_PATH']!, '{ not json ');
      expect(readSettings()).toBeNull();
    });

    it('returns null when the schema is violated', () => {
      // webui.port must be an integer in range; a string fails validation.
      writeFileSync(process.env['NAVIDROME_CONFIG_PATH']!, JSON.stringify({ webui: { port: 'nope' } }));
      expect(readSettings()).toBeNull();
    });

    it('parses a valid (partial) store', () => {
      writeFileSync(
        process.env['NAVIDROME_CONFIG_PATH']!,
        JSON.stringify({ navidrome: { url: 'http://x:4533' } }),
      );
      expect(readSettings()?.navidrome?.url).toBe('http://x:4533');
    });
  });

  describe('writeSettings', () => {
    const sample: SettingsFile = {
      navidrome: { url: 'http://h:4533', username: 'u', password: 'p' },
      webui: { port: 9001 },
    };

    it('round-trips through readSettings', () => {
      writeSettings(sample);
      const back = readSettings();
      expect(back?.navidrome?.url).toBe('http://h:4533');
      expect(back?.navidrome?.password).toBe('p');
      expect(back?.webui?.port).toBe(9001);
    });

    it('creates missing parent directories', () => {
      const nested = join(dir, 'a', 'b', 'settings.json');
      process.env['NAVIDROME_CONFIG_PATH'] = nested;
      writeSettings(sample);
      expect(readSettings()?.navidrome?.username).toBe('u');
    });

    it('writes owner-only (0600) permissions on POSIX', () => {
      if (process.platform === 'win32') return; // mode bits are a no-op on Windows
      writeSettings(sample);
      const mode = statSync(process.env['NAVIDROME_CONFIG_PATH']!).mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it('atomically overwrites an existing store and leaves no temp files', () => {
      writeSettings(sample);
      writeSettings({ ...sample, navidrome: { ...sample.navidrome, username: 'updated' } });
      expect(readSettings()?.navidrome?.username).toBe('updated');
      // No leftover *.tmp siblings from the temp-then-rename.
      const leftovers = readdirSync(dir).filter((f) => f.endsWith('.tmp'));
      expect(leftovers).toEqual([]);
    });
  });
});
