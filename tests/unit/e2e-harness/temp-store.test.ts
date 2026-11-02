/**
 * Navidrome MCP Server - e2e temp settings store unit tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeTempStore } from '../../e2e/harness/temp-store.js';
import { writeSettings } from '../../../src/config/store.js';
import { resolveMpvBinary } from '../../../src/services/playback/mpv-process.js';

// CI has no mpv binary, so each test picks what the lookup returns.
vi.mock('../../../src/services/playback/mpv-process.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/services/playback/mpv-process.js')>();
  return { ...actual, resolveMpvBinary: vi.fn(() => '/usr/bin/mpv') };
});

const LOGIN = { url: 'http://navidrome.test', username: 'tester', password: 'secret' };
const PORT = 18_808;
const ADMIN_HASH = '$argon2id$test';

describe('writeTempStore', () => {
  let dir: string;
  let savedStorePath: string | undefined;

  beforeEach(() => {
    savedStorePath = process.env['NAVIDROME_CONFIG_PATH'];
    dir = mkdtempSync(join(tmpdir(), 'ndmcp-e2e-store-'));
    process.env['NAVIDROME_CONFIG_PATH'] = join(dir, 'user-settings.json');
  });

  afterEach(() => {
    if (savedStorePath === undefined) delete process.env['NAVIDROME_CONFIG_PATH'];
    else process.env['NAVIDROME_CONFIG_PATH'] = savedStorePath;
    rmSync(dir, { recursive: true, force: true });
    vi.mocked(resolveMpvBinary).mockClear();
  });

  function write(): string {
    return writeTempStore({ runDir: dir, port: PORT, adminPasswordHash: ADMIN_HASH });
  }

  it('copies only the login and the mpv path, and writes the jukebox web remote', () => {
    writeSettings({
      navidrome: LOGIN,
      features: { lastFmApiKey: 'key', lyricsProvider: 'lrclib' },
      playback: { mpvPath: '/opt/mpv', audioDevice: { id: 'wasapi/speakers' } },
      webui: { port: 8808, theme: 'dark', auth: { mode: 'password', adminAccess: 'anywhere' } },
    });

    const storePath = write();

    expect(storePath).toBe(join(dir, 'settings.json'));
    expect(JSON.parse(readFileSync(storePath, 'utf8'))).toEqual({
      navidrome: LOGIN,
      playback: { mpvPath: '/opt/mpv' },
      webui: {
        enabled: true,
        port: PORT,
        expose: true,
        autoOpenBrowser: false,
        auth: { mode: 'jukebox', adminPasswordHash: ADMIN_HASH, adminAccess: 'localhost' },
      },
    });
    expect(resolveMpvBinary).toHaveBeenCalledWith('/opt/mpv');
  });

  it('writes a null mpv path when the user store sets none, so the instance looks mpv up on PATH', () => {
    writeSettings({ navidrome: LOGIN });

    const stored = JSON.parse(readFileSync(write(), 'utf8')) as { playback: unknown };

    expect(stored.playback).toEqual({ mpvPath: null });
    expect(resolveMpvBinary).toHaveBeenCalledWith(null);
  });

  it('fails when the user store is absent', () => {
    expect(write).toThrow('e2e: no Navidrome url, username and password in the settings store');
  });

  it('fails when the login has a blank password', () => {
    writeSettings({ navidrome: { ...LOGIN, password: '' } });

    expect(write).toThrow('e2e: no Navidrome url, username and password in the settings store');
  });

  it('fails with the store problem when the user store is not JSON', () => {
    writeFileSync(join(dir, 'user-settings.json'), '{ not json');

    expect(write).toThrow('e2e: the settings store is unusable: settings.json is not valid JSON');
  });

  it('fails with the store problem when the user store fails the schema', () => {
    writeFileSync(join(dir, 'user-settings.json'), JSON.stringify({ navidrome: LOGIN, webui: { port: 'nope' } }));

    expect(write).toThrow('e2e: the settings store is unusable: settings.json failed validation');
  });

  it('fails when no mpv binary resolves', () => {
    writeSettings({ navidrome: LOGIN });
    vi.mocked(resolveMpvBinary).mockReturnValueOnce(null);

    expect(write).toThrow('e2e: no mpv binary found');
  });
});
