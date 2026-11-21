/**
 * Navidrome MCP Server - Claude Desktop config writer tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildServerEntry,
  claudeDesktopConfigPath,
  mergeServerEntry,
  type McpServerEntry,
} from '../../../src/connect/claude-desktop.js';

const NPX_ENTRY: McpServerEntry = { command: 'npx', args: ['navidrome-mcp'] };
const FILE = 'claude_desktop_config.json';

let tempDir = '';
let configPath = '';

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'navidrome-connect-'));
  configPath = join(tempDir, 'Claude', FILE);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function writeConfig(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/** Windows needs a privilege to link a file, so a link test runs only where the link can be made. */
const SYMLINKS_ALLOWED = ((): boolean => {
  const probeDir = mkdtempSync(join(tmpdir(), 'navidrome-link-probe-'));
  try {
    writeFileSync(join(probeDir, 'target'), '');
    symlinkSync(join(probeDir, 'target'), join(probeDir, 'link'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
})();

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('buildServerEntry', () => {
  const paths = { nodePath: '/usr/bin/node', indexJsPath: '/pkg/dist/index.js' };

  it('uses npx by default', () => {
    expect(buildServerEntry({ ...paths, absolute: false, platform: 'linux' })).toEqual(NPX_ENTRY);
  });

  it('wraps npx in cmd /c on Windows', () => {
    expect(buildServerEntry({ ...paths, absolute: false, platform: 'win32' })).toEqual({
      command: 'cmd',
      args: ['/c', 'npx', 'navidrome-mcp'],
    });
  });

  it.each(['linux', 'win32', 'darwin'] as const)('writes the node and index paths with absolute on %s', (platform) => {
    expect(buildServerEntry({ ...paths, absolute: true, platform })).toEqual({
      command: '/usr/bin/node',
      args: ['/pkg/dist/index.js'],
    });
  });
});

describe('mergeServerEntry', () => {
  it('writes the entry, keeps other servers and other keys, and saves the old file as .bak', () => {
    const original = JSON.stringify({
      globalShortcut: 'Ctrl+Space',
      mcpServers: { other: { command: 'node', args: ['other.js'] } },
    });
    writeConfig(configPath, original);

    const result = mergeServerEntry(configPath, NPX_ENTRY);

    expect(result).toEqual({ configPath, backupPath: `${configPath}.bak`, replaced: false, unchanged: false });
    expect(readJson(configPath)).toEqual({
      globalShortcut: 'Ctrl+Space',
      mcpServers: { other: { command: 'node', args: ['other.js'] }, navidrome: NPX_ENTRY },
    });
    expect(readFileSync(`${configPath}.bak`, 'utf8')).toBe(original);
  });

  it('creates the file and its folder with no backup when none exists', () => {
    const result = mergeServerEntry(configPath, NPX_ENTRY);

    expect(result).toEqual({ configPath, backupPath: null, replaced: false, unchanged: false });
    expect(readJson(configPath)).toEqual({ mcpServers: { navidrome: NPX_ENTRY } });
  });

  it('replaces a different navidrome entry after the backup and reports it', () => {
    const original = JSON.stringify({
      mcpServers: { navidrome: { command: 'node', args: ['old.js'] }, keep: { command: 'x' } },
    });
    writeConfig(configPath, original);

    const result = mergeServerEntry(configPath, NPX_ENTRY);

    expect(result.replaced).toBe(true);
    expect(result.unchanged).toBe(false);
    expect(readJson(configPath)).toEqual({ mcpServers: { navidrome: NPX_ENTRY, keep: { command: 'x' } } });
    expect(readFileSync(`${configPath}.bak`, 'utf8')).toBe(original);
  });

  it('keeps the env block and other keys of the stored navidrome entry', () => {
    const env = { NAVIDROME_URL: 'http://nav', NAVIDROME_USERNAME: 'u', NAVIDROME_PASSWORD: 'p' };
    writeConfig(configPath, JSON.stringify({ mcpServers: { navidrome: { command: 'node', args: ['old.js'], env, cwd: '/x' } } }));

    const result = mergeServerEntry(configPath, NPX_ENTRY);

    expect(result.replaced).toBe(true);
    expect(readJson(configPath)).toEqual({ mcpServers: { navidrome: { ...NPX_ENTRY, env, cwd: '/x' } } });
  });

  it('counts a stored entry with the same command and args as unchanged whatever its key order or extra keys', () => {
    const original = JSON.stringify({ mcpServers: { navidrome: { env: { A: '1' }, args: ['navidrome-mcp'], command: 'npx' } } });
    writeConfig(configPath, original);

    const result = mergeServerEntry(configPath, NPX_ENTRY);

    expect(result.unchanged).toBe(true);
    expect(readFileSync(configPath, 'utf8')).toBe(original);
    expect(() => readFileSync(`${configPath}.bak`, 'utf8')).toThrow();
  });

  it.skipIf(!SYMLINKS_ALLOWED)('writes through a symlinked config file and keeps the link', () => {
    const realPath = join(tempDir, 'dotfiles', FILE);
    writeConfig(realPath, JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
    mkdirSync(dirname(configPath), { recursive: true });
    symlinkSync(realPath, configPath);

    const result = mergeServerEntry(configPath, NPX_ENTRY);

    expect(result.configPath).toBe(configPath);
    expect(lstatSync(configPath).isSymbolicLink()).toBe(true);
    expect(readJson(realPath)).toEqual({ mcpServers: { other: { command: 'x' }, navidrome: NPX_ENTRY } });
    expect(readFileSync(`${realPath}.bak`, 'utf8')).toContain('"other"');
  });

  it('leaves the file and the .bak alone when the entry is already there', () => {
    mergeServerEntry(configPath, NPX_ENTRY);
    writeConfig(`${configPath}.bak`, 'first backup');
    const before = readFileSync(configPath, 'utf8');

    const result = mergeServerEntry(configPath, NPX_ENTRY);

    expect(result).toEqual({ configPath, backupPath: null, replaced: true, unchanged: true });
    expect(readFileSync(configPath, 'utf8')).toBe(before);
    expect(readFileSync(`${configPath}.bak`, 'utf8')).toBe('first backup');
  });

  it('reads a file that starts with a byte order mark', () => {
    writeConfig(configPath, `\uFEFF${JSON.stringify({ mcpServers: { other: { command: 'x' } } })}`);

    mergeServerEntry(configPath, NPX_ENTRY);

    expect(readJson(configPath)).toEqual({ mcpServers: { other: { command: 'x' }, navidrome: NPX_ENTRY } });
  });

  it('keeps a byte order mark character that sits inside a value', () => {
    writeConfig(configPath, JSON.stringify({ globalShortcut: 'a\uFEFFb' }));

    mergeServerEntry(configPath, NPX_ENTRY);

    expect(readJson(configPath)).toEqual({ globalShortcut: 'a\uFEFFb', mcpServers: { navidrome: NPX_ENTRY } });
  });

  it('treats a blank file as an empty config', () => {
    writeConfig(configPath, '  \n');

    mergeServerEntry(configPath, NPX_ENTRY);

    expect(readJson(configPath)).toEqual({ mcpServers: { navidrome: NPX_ENTRY } });
  });

  it.each([
    ['not valid JSON', '{ "mcpServers": ', /is not valid JSON/],
    ['a JSON array', '[]', /must hold a JSON object at the top level/],
    ['a JSON null', 'null', /must hold a JSON object at the top level/],
    ['an mcpServers array', '{"mcpServers": []}', /"mcpServers" key .* must be a JSON object/],
    ['an mcpServers string', '{"mcpServers": "x"}', /"mcpServers" key .* must be a JSON object/],
  ])('refuses a file with %s and leaves it unchanged with no .bak', (_label, content, message) => {
    writeConfig(configPath, content);

    expect(() => mergeServerEntry(configPath, NPX_ENTRY)).toThrow(message);
    expect(() => mergeServerEntry(configPath, NPX_ENTRY)).toThrow(configPath);
    expect(readFileSync(configPath, 'utf8')).toBe(content);
    expect(() => readFileSync(`${configPath}.bak`, 'utf8')).toThrow();
  });
});

describe('claudeDesktopConfigPath', () => {
  it('uses the Library path on macOS', () => {
    expect(claudeDesktopConfigPath({ platform: 'darwin', env: {}, home: '/Users/me' })).toBe(
      join('/Users/me', 'Library', 'Application Support', 'Claude', FILE),
    );
  });

  it('uses XDG_CONFIG_HOME on Linux and falls back to ~/.config', () => {
    expect(claudeDesktopConfigPath({ platform: 'linux', env: { XDG_CONFIG_HOME: '/xdg' }, home: '/home/me' })).toBe(
      join('/xdg', 'Claude', FILE),
    );
    expect(claudeDesktopConfigPath({ platform: 'linux', env: {}, home: '/home/me' })).toBe(
      join('/home/me', '.config', 'Claude', FILE),
    );
  });

  describe('on Windows', () => {
    let appData = '';
    let localAppData = '';
    let storeFile = '';
    let appDataFile = '';

    beforeEach(() => {
      appData = join(tempDir, 'Roaming');
      localAppData = join(tempDir, 'Local');
      storeFile = join(localAppData, 'Packages', 'Claude_abc123', 'LocalCache', 'Roaming', 'Claude', FILE);
      appDataFile = join(appData, 'Claude', FILE);
    });

    const resolve = (): string =>
      claudeDesktopConfigPath({ platform: 'win32', env: { APPDATA: appData, LOCALAPPDATA: localAppData }, home: tempDir });

    it('prefers the Microsoft Store file over the %APPDATA% file when both exist', () => {
      writeConfig(storeFile, '{}');
      writeConfig(appDataFile, '{}');

      expect(resolve()).toBe(storeFile);
    });

    it('uses the %APPDATA% file when only it exists', () => {
      mkdirSync(join(localAppData, 'Packages', 'Claude_abc123'), { recursive: true });
      writeConfig(appDataFile, '{}');

      expect(resolve()).toBe(appDataFile);
    });

    it('targets the Store package folder when the package exists and no file does', () => {
      mkdirSync(join(localAppData, 'Packages', 'Claude_abc123'), { recursive: true });

      expect(resolve()).toBe(storeFile);
    });

    it('ignores other packages and falls back to %APPDATA% when no Claude package exists', () => {
      mkdirSync(join(localAppData, 'Packages', 'Other_xyz'), { recursive: true });

      expect(resolve()).toBe(appDataFile);
    });

    it('looks for the Store package under the user profile when LOCALAPPDATA is unset', () => {
      mkdirSync(join(tempDir, 'AppData', 'Local', 'Packages', 'Claude_abc123'), { recursive: true });
      const profileStoreFile = join(
        tempDir, 'AppData', 'Local', 'Packages', 'Claude_abc123', 'LocalCache', 'Roaming', 'Claude', FILE,
      );

      expect(claudeDesktopConfigPath({ platform: 'win32', env: {}, home: tempDir })).toBe(profileStoreFile);
    });

    it('falls back to the user profile when APPDATA is unset', () => {
      expect(claudeDesktopConfigPath({ platform: 'win32', env: {}, home: tempDir })).toBe(
        join(tempDir, 'AppData', 'Roaming', 'Claude', FILE),
      );
    });
  });
});
