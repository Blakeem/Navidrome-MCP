import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSettings, readSettingsForStartup, writeSettings, type SettingsFile } from '../../../src/config/store.js';
import { logger } from '../../../src/utils/logger.js';

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
      writeFileSync(process.env['NAVIDROME_CONFIG_PATH']!, JSON.stringify({ webui: { port: 'nope' } }));
      expect(readSettings()).toBeNull();
    });

    it('keeps the store when webui.theme is null', () => {
      writeFileSync(process.env['NAVIDROME_CONFIG_PATH']!, JSON.stringify({ webui: { theme: null } }));
      expect(readSettings()).not.toBeNull();
    });

    it('keeps the store when a port is out of range, leaving the range to the runtime schema', () => {
      writeFileSync(process.env['NAVIDROME_CONFIG_PATH']!, JSON.stringify({ webui: { port: 70000 } }));
      expect(readSettings()).not.toBeNull();
    });

    it('parses a valid (partial) store', () => {
      writeFileSync(
        process.env['NAVIDROME_CONFIG_PATH']!,
        JSON.stringify({ navidrome: { url: 'http://x:4533' } }),
      );
      expect(readSettings()?.navidrome?.url).toBe('http://x:4533');
    });

    it('parses a store that starts with a UTF-8 BOM', () => {
      writeFileSync(
        process.env['NAVIDROME_CONFIG_PATH']!,
        `\uFEFF${JSON.stringify({ navidrome: { url: 'http://bom:4533' } })}`,
      );
      expect(readSettings()).toEqual({ navidrome: { url: 'http://bom:4533' } });
    });

    it('warns with the path and code when the store is unreadable, not absent', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      mkdirSync(process.env['NAVIDROME_CONFIG_PATH']!);
      try {
        expect(readSettings()).toBeNull();
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/settings\.json at .+ is unreadable \(EISDIR\)/));
      } finally {
        warn.mockRestore();
      }
    });

    it('stays silent when the store is absent', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      try {
        expect(readSettings()).toBeNull();
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe('readSettingsForStartup', () => {
    const path = (): string => process.env['NAVIDROME_CONFIG_PATH']!;

    it('reports no auth request and no problem for an absent file', () => {
      expect(readSettingsForStartup()).toEqual({ settings: null, requestsWebuiAuth: false, problem: null });
    });

    // A file that cannot be parsed cannot prove it names no auth mode, so the open env config must not replace it.
    it('fails closed on a present file with a JSON syntax error', () => {
      writeFileSync(path(), '{"webui": {"auth": {"mode": "jukebox"}},}');
      const startup = readSettingsForStartup();
      expect(startup.requestsWebuiAuth).toBe(true);
      expect(startup.problem).toMatch(/settings\.json is not valid JSON/);
    });

    it('fails closed on a present file whose read fails', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      mkdirSync(path());
      try {
        const startup = readSettingsForStartup();
        expect(startup.requestsWebuiAuth).toBe(true);
        expect(startup.problem).toMatch(/is unreadable \(EISDIR\)/);
      } finally {
        warn.mockRestore();
      }
    });

    it('names the failing field of a schema-invalid file and keeps its parsed mode', () => {
      writeFileSync(path(), JSON.stringify({ webui: { port: 'nope', auth: { mode: 'none' } } }));
      const startup = readSettingsForStartup();
      expect(startup.requestsWebuiAuth).toBe(false);
      expect(startup.problem).toMatch(/failed validation .*webui\.port/);
    });

    it('reports no problem for a usable file', () => {
      writeFileSync(path(), JSON.stringify({ navidrome: { url: 'http://x:4533' }, webui: { auth: { mode: 'password' } } }));
      expect(readSettingsForStartup()).toMatchObject({ requestsWebuiAuth: true, problem: null });
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
      if (process.platform === 'win32') return; // Windows ignores POSIX mode bits.
      writeSettings(sample);
      const mode = statSync(process.env['NAVIDROME_CONFIG_PATH']!).mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it('atomically overwrites an existing store and leaves no temp files', () => {
      writeSettings(sample);
      writeSettings({ ...sample, navidrome: { ...sample.navidrome, username: 'updated' } });
      expect(readSettings()?.navidrome?.username).toBe('updated');
      const leftovers = readdirSync(dir).filter((f) => f.endsWith('.tmp'));
      expect(leftovers).toEqual([]);
    });

    // renameSync onto a directory throws (EISDIR on POSIX, EPERM on Windows) after the temp file
    // already holds the credentials.
    it('removes the temp file when the final rename fails', () => {
      const occupied = join(dir, 'occupied');
      mkdirSync(occupied);
      process.env['NAVIDROME_CONFIG_PATH'] = occupied;

      expect(() => writeSettings(sample)).toThrow();
      expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    });
  });
});
