/**
 * Navidrome MCP Server - Jukebox Remote shortcut writer tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Every path the writer touches points into a temp folder, and the cscript and gio runs are stubs,
// so no test writes to the real Desktop or Start Menu.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  // The real module, since the node:os mock below waits on this fixture.
  const { tmpdir } = await vi.importActual<typeof import('node:os')>('node:os');
  const path = await import('node:path');
  const root = mkdtempSync(path.join(tmpdir(), 'ndmcp-shortcut-'));
  return {
    root,
    desktop: path.join(root, 'Desktop'),
    startMenu: path.join(root, 'StartMenu'),
    runner: path.join(root, 'runner'),
    playerMain: path.join(root, 'dist', 'web', 'main.js'),
  };
});

const { readSettingsMock, runCommandMock } = vi.hoisted(() => ({
  readSettingsMock: vi.fn(),
  runCommandMock: vi.fn(),
}));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  const { root } = await fixture;
  return { ...actual, homedir: () => root };
});

vi.mock('../../../src/shortcut/paths.js', async () => {
  const dirs = await fixture;
  return {
    APP_NAME: 'Jukebox Remote',
    PLAYER_MAIN_JS: dirs.playerMain,
    ICON_PNG: join(dirs.root, 'assets', 'missing.png'),
    ICON_ICO: join(dirs.root, 'assets', 'missing.ico'),
    ICON_ICNS: join(dirs.root, 'assets', 'missing.icns'),
    desktopDir: () => Promise.resolve(dirs.desktop),
    windowsStartMenuDir: () => dirs.startMenu,
    windowsRunnerDir: () => dirs.runner,
  };
});

vi.mock('../../../src/shortcut/run-command.js', () => ({ runCommand: runCommandMock }));
vi.mock('../../../src/config/store.js', () => ({ readSettings: readSettingsMock }));

const { createJukeboxShortcut } = await import('../../../src/shortcut/create.js');
const dirs = await fixture;

const realPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

/** Stands in for WScript.Shell: a run writes the .lnk that the temp script names. */
function cscriptWritesShortcut(_command: string, args: readonly string[]): Promise<{ status: number; stdout: string }> {
  const script = readFileSync(args[2] ?? '', 'utf8');
  const lnkPath = /CreateShortcut\("([^"]+)"\)/.exec(script)?.[1] ?? '';
  writeFileSync(lnkPath, 'lnk');
  return Promise.resolve({ status: 0, stdout: '' });
}

beforeEach(() => {
  mkdirSync(dirs.desktop, { recursive: true });
  mkdirSync(join(dirs.root, 'dist', 'web'), { recursive: true });
  writeFileSync(dirs.playerMain, '// player');
  readSettingsMock.mockReturnValue({ navidrome: { url: 'http://music:4533' } });
  runCommandMock.mockResolvedValue({ status: 0, stdout: '' });
});

afterEach(() => {
  setPlatform(realPlatform);
  vi.clearAllMocks();
  vi.restoreAllMocks();
  for (const entry of ['Desktop', 'StartMenu', 'runner', 'dist', '.local']) {
    rmSync(join(dirs.root, entry), { recursive: true, force: true });
  }
});

afterAll(() => {
  rmSync(dirs.root, { recursive: true, force: true });
});

describe('createJukeboxShortcut', () => {
  it('rejects with the build hint when the player is not built', async () => {
    rmSync(dirs.playerMain);

    await expect(createJukeboxShortcut()).rejects.toThrow(`Built player not found at ${dirs.playerMain}. Build it first with: pnpm build`);
  });

  it('rejects a platform with no shortcut format', async () => {
    setPlatform('aix');

    await expect(createJukeboxShortcut()).rejects.toThrow('Unsupported platform: aix.');
  });

  it('returns the written Linux entries, the old cleanup and the configured state, and writes nothing to stdout', async () => {
    setPlatform('linux');
    const oldEntry = join(dirs.desktop, 'navidrome-player.desktop');
    writeFileSync(oldEntry, '[Desktop Entry]\nName=Navidrome Player\n');
    const stdout = vi.spyOn(process.stdout, 'write');

    const result = await createJukeboxShortcut();

    const appsEntry = join(dirs.root, '.local', 'share', 'applications', 'jukebox-remote.desktop');
    const desktopEntry = join(dirs.desktop, 'jukebox-remote.desktop');
    expect(result).toEqual({
      written: [appsEntry, desktopEntry],
      runner: null,
      oldCleanup: { removed: [oldEntry], kept: [] },
      unconfigured: false,
    });
    expect(readFileSync(desktopEntry, 'utf8')).toContain(`Exec="${process.execPath}" "${dirs.playerMain}"`);
    expect(existsSync(oldEntry)).toBe(false);
    expect(runCommandMock).toHaveBeenCalledWith('gio', ['set', desktopEntry, 'metadata::trusted', 'true']);
    expect(stdout).not.toHaveBeenCalled();
  });

  it.each([
    ['no settings.json', null],
    ['a blank URL', { navidrome: { url: ' ' } }],
    ['the example URL', { navidrome: { url: 'http://your-server:4533' } }],
  ])('reports unconfigured with %s', async (_label, settings) => {
    setPlatform('linux');
    readSettingsMock.mockReturnValue(settings);

    expect((await createJukeboxShortcut()).unconfigured).toBe(true);
  });

  it('writes a Windows shortcut to the Desktop and the Start Menu and names the runner', async () => {
    setPlatform('win32');
    runCommandMock.mockImplementation(cscriptWritesShortcut);

    const result = await createJukeboxShortcut();

    const runner = join(dirs.runner, 'Jukebox Remote.vbs');
    expect(result.written).toEqual([join(dirs.desktop, 'Jukebox Remote.lnk'), join(dirs.startMenu, 'Jukebox Remote.lnk')]);
    expect(result.runner).toBe(runner);
    expect(readFileSync(runner, 'utf8')).toContain(`sh.Run """${process.execPath}"" ""${dirs.playerMain}""", 0, False`);
    expect(runCommandMock).toHaveBeenCalledWith('cscript', ['//nologo', '//B', expect.stringMatching(/nd-shortcut-.+\.vbs$/)]);
  });

  it('falls back to a runner copy in each folder when cscript fails', async () => {
    setPlatform('win32');
    runCommandMock.mockResolvedValue({ status: null, stdout: '' });

    const result = await createJukeboxShortcut();

    const copies = [join(dirs.desktop, 'Jukebox Remote.vbs'), join(dirs.startMenu, 'Jukebox Remote.vbs')];
    expect(result.written).toEqual(copies);
    expect(result.runner).toBeNull();
    for (const copy of copies) expect(readFileSync(copy, 'utf8')).toContain('sh.Run');
  });
});
