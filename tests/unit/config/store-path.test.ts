/**
 * Unit tests for getSettingsStorePath — OS-aware store location + override.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getSettingsStorePath } from '../../../src/config/store-path.js';

const APP = 'navidrome-mcp';
const FILE = 'settings.json';

describe('getSettingsStorePath', () => {
  const saved: Record<string, string | undefined> = {};
  let origPlatform: NodeJS.Platform;

  beforeEach(() => {
    saved['cfg'] = process.env['NAVIDROME_CONFIG_PATH'];
    saved['xdg'] = process.env['XDG_CONFIG_HOME'];
    saved['appdata'] = process.env['APPDATA'];
    origPlatform = process.platform;
    delete process.env['NAVIDROME_CONFIG_PATH'];
  });

  afterEach(() => {
    restore('NAVIDROME_CONFIG_PATH', saved['cfg']);
    restore('XDG_CONFIG_HOME', saved['xdg']);
    restore('APPDATA', saved['appdata']);
    setPlatform(origPlatform);
  });

  it('honors NAVIDROME_CONFIG_PATH as an exact file-location override', () => {
    process.env['NAVIDROME_CONFIG_PATH'] = '/custom/loc/my-settings.json';
    expect(getSettingsStorePath()).toBe('/custom/loc/my-settings.json');
  });

  it('uses $XDG_CONFIG_HOME on Linux when set (trailing slashes stripped)', () => {
    setPlatform('linux');
    process.env['XDG_CONFIG_HOME'] = '/cfg//';
    expect(getSettingsStorePath()).toBe(join('/cfg', APP, FILE));
  });

  it('falls back to ~/.config on Linux when XDG unset', () => {
    setPlatform('linux');
    delete process.env['XDG_CONFIG_HOME'];
    expect(getSettingsStorePath()).toBe(join(homedir(), '.config', APP, FILE));
  });

  it('uses ~/Library/Application Support on macOS', () => {
    setPlatform('darwin');
    expect(getSettingsStorePath()).toBe(
      join(homedir(), 'Library', 'Application Support', APP, FILE),
    );
  });

  it('uses %APPDATA% on Windows', () => {
    setPlatform('win32');
    process.env['APPDATA'] = '/winroam';
    expect(getSettingsStorePath()).toBe(join('/winroam', APP, FILE));
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}
