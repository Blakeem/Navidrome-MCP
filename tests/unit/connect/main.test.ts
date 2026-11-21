/**
 * Navidrome MCP Server - `navidrome-mcp connect` command tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Only the path resolver is mocked, so no test reads or writes a real Claude Desktop file.
const resolver = vi.hoisted(() => ({ configPath: '', indexJs: '' }));

vi.mock('../../../src/connect/claude-desktop.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/connect/claude-desktop.js')>()),
  claudeDesktopConfigPath: () => resolver.configPath,
}));

// A fixed path in a temp folder, since dist/index.js does not exist before a build.
vi.mock('../../../src/shortcut/paths.js', () => ({
  get PACKAGE_INDEX_JS(): string {
    return resolver.indexJs;
  },
}));

const originalArgv = process.argv;
let tempDir = '';

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'navidrome-connect-main-'));
  resolver.configPath = join(tempDir, 'claude_desktop_config.json');
  resolver.indexJs = join(tempDir, 'dist', 'index.js');
});

afterEach(() => {
  process.argv = originalArgv;
  vi.restoreAllMocks();
  vi.resetModules();
  rmSync(tempDir, { recursive: true, force: true });
});

interface Run {
  stdout: string;
  stderr: string;
  exitCode: number | undefined;
}

async function runConnect(...options: string[]): Promise<Run> {
  process.argv = ['node', 'index.js', 'connect', ...options];
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

  // The module runs its command on import.
  await import('../../../src/connect/main.js');

  return {
    stdout: stdout.mock.calls.map((call) => String(call[0])).join(''),
    stderr: stderr.mock.calls.map((call) => String(call[0])).join(''),
    exitCode: exit.mock.calls.at(0)?.[0] as number | undefined,
  };
}

describe('navidrome-mcp connect', () => {
  it('writes the entry to the resolved file and prints the report', async () => {
    writeFileSync(resolver.configPath, JSON.stringify({ mcpServers: { other: { command: 'x' } } }));

    const run = await runConnect();

    expect(run.exitCode).toBeUndefined();
    const written = JSON.parse(readFileSync(resolver.configPath, 'utf8')) as { mcpServers: Record<string, unknown> };
    expect(Object.keys(written.mcpServers).sort()).toEqual(['navidrome', 'other']);
    expect(readFileSync(`${resolver.configPath}.bak`, 'utf8')).toContain('"other"');
    expect(run.stdout).toContain(resolver.configPath);
    expect(run.stdout).toContain('Quit Claude Desktop fully and open it again.');
  });

  it('writes the node and index.js paths with --absolute', async () => {
    mkdirSync(dirname(resolver.indexJs));
    writeFileSync(resolver.indexJs, '');

    const run = await runConnect('--absolute');

    const written = JSON.parse(readFileSync(resolver.configPath, 'utf8')) as {
      mcpServers: { navidrome: { command: string; args: string[] } };
    };
    expect(run.exitCode).toBeUndefined();
    expect(written.mcpServers.navidrome.command).toBe(process.execPath);
    expect(written.mcpServers.navidrome.args).toEqual([resolver.indexJs]);
  });

  it('exits 1 with the missing build named for --absolute and writes nothing', async () => {
    const run = await runConnect('--absolute');

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`Built server not found at ${resolver.indexJs}`);
    expect(() => readFileSync(resolver.configPath, 'utf8')).toThrow();
  });

  it('exits 1 with the file named and the file unchanged for invalid JSON', async () => {
    writeFileSync(resolver.configPath, '{ broken');

    const run = await runConnect();

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('Could not connect Claude Desktop');
    expect(run.stderr).toContain(resolver.configPath);
    expect(readFileSync(resolver.configPath, 'utf8')).toBe('{ broken');
    expect(run.stdout).toBe('');
  });

  it('exits 1 for an unknown option and writes nothing', async () => {
    const run = await runConnect('--frobnicate');

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('Unknown option: --frobnicate');
    expect(() => readFileSync(resolver.configPath, 'utf8')).toThrow();
  });
});
