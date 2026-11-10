/**
 * Navidrome MCP Server - Subcommand dispatch tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildHelpText, COMMANDS, runCli, type CliIo } from '../../../src/cli/dispatch.js';
import { getSettingsStorePath } from '../../../src/config/store-path.js';
import { jukeboxLogPath } from '../../../src/web/log-path.js';

// Each target runs its own main() on import, so a mock records the load and starts nothing.
const loaded = vi.hoisted(() => ({ modules: [] as string[] }));

/** doMock again before each test, since a mocked module's factory runs once until it is re-registered. */
function mockTargets(): void {
  const targets: Record<string, string> = {
    '../../../src/mcp-server.js': 'mcp-server',
    '../../../src/web/main.js': 'jukebox',
    '../../../src/config-app/main.js': 'settings',
    '../../../src/shortcut/main.js': 'shortcut',
    '../../../src/connect/main.js': 'connect',
  };
  for (const [path, name] of Object.entries(targets)) {
    vi.doMock(path, () => {
      loaded.modules.push(name);
      return {};
    });
  }
}

interface Captured {
  io: CliIo;
  stdout: string[];
  stderr: string[];
}

function captureIo(stdinIsTTY: boolean): Captured {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: CliIo = {
    stdinIsTTY: () => stdinIsTTY,
    stdout: (text) => { stdout.push(text); },
    stderr: (text) => { stderr.push(text); },
  };
  return { io, stdout, stderr };
}

describe('help text', () => {
  it('lists the bare command and every command the dispatch table holds', () => {
    const help = buildHelpText();

    expect(help).toContain('navidrome-mcp            MCP server. Your MCP client starts it.');
    for (const command of COMMANDS) {
      expect(help).toContain(`navidrome-mcp ${command.name}`);
    }
  });

  it('aligns every description in one column and indents continuation lines under it', () => {
    const help = buildHelpText();

    expect(help).toContain('navidrome-mcp settings   Open the settings page.');
    expect(help).toContain(
      'navidrome-mcp connect    Add Navidrome MCP to Claude Desktop.\n' +
        '                         Add --absolute to write the full paths of node and the server.\n',
    );
    expect(help).toContain(
      'navidrome-mcp jukebox    Start the Jukebox Remote and open it in your browser.\n' +
        '                         Started here, it keeps running after your AI client closes.\n' +
        '                         Stop it with Ctrl+C or Shut down player in the gear menu.\n',
    );
  });

  it('ends with the resolved settings file and log paths', () => {
    const help = buildHelpText();

    expect(help.endsWith(
      `\nSettings file: ${getSettingsStorePath()}\nJukebox Remote log: ${jukeboxLogPath()}\n`,
    )).toBe(true);
    expect(jukeboxLogPath().endsWith('jukebox-remote.log')).toBe(true);
  });
});

describe('runCli', () => {
  beforeEach(() => {
    loaded.modules.length = 0;
    vi.resetModules();
    mockTargets();
  });

  it.each([['help'], ['--help'], ['-h']])('prints the help to stdout and exits 0 for %s', async (arg) => {
    const { io, stdout, stderr } = captureIo(false);

    const code = await runCli([arg], io);

    expect(code).toBe(0);
    expect(stdout.join('')).toBe(buildHelpText());
    expect(stderr).toEqual([]);
    expect(loaded.modules).toEqual([]);
  });

  it('exits 1 with the unknown command and the help on stderr', async () => {
    const { io, stdout, stderr } = captureIo(false);

    const code = await runCli(['frobnicate'], io);

    expect(code).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join('')).toBe(`Unknown command: frobnicate\n\n${buildHelpText()}`);
    expect(loaded.modules).toEqual([]);
  });

  it.each([
    ['serve', 'mcp-server'],
    ['jukebox', 'jukebox'],
    ['settings', 'settings'],
    ['shortcut', 'shortcut'],
    ['connect', 'connect'],
  ])('loads only the %s target', async (arg, moduleName) => {
    const { io, stdout } = captureIo(false);

    const code = await runCli([arg], io);

    expect(code).toBe(0);
    expect(loaded.modules).toEqual([moduleName]);
    expect(stdout).toEqual([]);
  });

  it('serve starts the MCP server even when stdin is a terminal', async () => {
    const { io, stdout } = captureIo(true);

    await runCli(['serve'], io);

    expect(loaded.modules).toEqual(['mcp-server']);
    expect(stdout).toEqual([]);
  });

  it('starts the MCP server with no argument and piped stdin', async () => {
    const { io, stdout } = captureIo(false);

    const code = await runCli([], io);

    expect(code).toBe(0);
    expect(loaded.modules).toEqual(['mcp-server']);
    expect(stdout).toEqual([]);
  });

  it('prints the help with no argument and a terminal stdin', async () => {
    const { io, stdout } = captureIo(true);

    const code = await runCli([], io);

    expect(code).toBe(0);
    expect(stdout.join('')).toBe(buildHelpText());
    expect(loaded.modules).toEqual([]);
  });

  it('never reads stdin when a command is named', async () => {
    const { io } = captureIo(true);
    const stdinIsTTY = vi.fn(() => true);

    await runCli(['help'], { ...io, stdinIsTTY });

    expect(stdinIsTTY).not.toHaveBeenCalled();
  });
});
