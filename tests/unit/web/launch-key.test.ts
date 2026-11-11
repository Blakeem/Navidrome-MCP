/**
 * Navidrome MCP Server - Jukebox Remote launch key tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../../../src/utils/logger.js';
import { createLaunchKey, getLaunchKeyPath, readLaunchKey, withLaunchKey, writeLaunchKey } from '../../../src/web/launch-key.js';

const PORT = 8808;
const ADMIN_URL = 'http://127.0.0.1:8808/admin';

let dir: string;
let savedPath: string | undefined;

beforeEach(() => {
  savedPath = process.env['NAVIDROME_CONFIG_PATH'];
  dir = mkdtempSync(join(tmpdir(), 'nd-launch-key-'));
  process.env['NAVIDROME_CONFIG_PATH'] = join(dir, 'settings.json');
});

afterEach(() => {
  if (savedPath === undefined) delete process.env['NAVIDROME_CONFIG_PATH'];
  else process.env['NAVIDROME_CONFIG_PATH'] = savedPath;
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('launch key file', () => {
  it('writes the key beside settings.json, per port, with mode 0600, and reads it back', () => {
    const key = createLaunchKey();

    writeLaunchKey(PORT, key);

    expect(getLaunchKeyPath(PORT)).toBe(join(dir, `jukebox-launch-key-${String(PORT)}`));
    expect(readFileSync(getLaunchKeyPath(PORT), 'utf8')).toBe(key);
    expect(readLaunchKey(PORT)).toBe(key);
    expect(readLaunchKey(PORT + 1)).toBeNull();
    if (process.platform !== 'win32') expect(statSync(getLaunchKeyPath(PORT)).mode & 0o777).toBe(0o600);
  });

  it('makes a new 43-character base64url key at each call', () => {
    const first = createLaunchKey();
    const second = createLaunchKey();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
  });

  it('reads a missing file as no key, without a warning', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    expect(readLaunchKey(PORT)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['empty', ''],
    ['too short', 'abc'],
    ['holding a character a launcher would read', `${'a'.repeat(42)}&`],
    ['ending in a newline', `${'a'.repeat(43)}\n`],
  ])('reads a %s file as no key', (_label, text) => {
    writeFileSync(getLaunchKeyPath(PORT), text);

    expect(readLaunchKey(PORT)).toBeNull();
  });

  it('warns and reads no key when the path is not a readable file', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    mkdirSync(getLaunchKeyPath(PORT));

    expect(readLaunchKey(PORT)).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`the launch key file ${getLaunchKeyPath(PORT)} is unreadable`));
  });

  it('logs a failed write without the key and does not throw, so the player still starts', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const key = createLaunchKey();
    writeFileSync(join(dir, 'not-a-folder'), '');
    process.env['NAVIDROME_CONFIG_PATH'] = join(dir, 'not-a-folder', 'settings.json');

    expect(() => writeLaunchKey(PORT, key)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('so a later launcher on this computer cannot skip the admin login'));
    expect(JSON.stringify(warn.mock.calls)).not.toContain(key);
  });
});

describe('withLaunchKey', () => {
  it('adds the key as the launch query parameter', () => {
    const key = createLaunchKey();

    expect(withLaunchKey(ADMIN_URL, key)).toBe(`${ADMIN_URL}?launch=${key}`);
    expect(withLaunchKey('https://127.0.0.1:9911/admin', key)).toBe(`https://127.0.0.1:9911/admin?launch=${key}`);
  });

  it('keeps the plain address when no key file was found', () => {
    expect(withLaunchKey(ADMIN_URL, null)).toBe(ADMIN_URL);
  });
});
