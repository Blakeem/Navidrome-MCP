/**
 * Navidrome MCP Server - Shortcut generator child process runner tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';

import { runCommand } from '../../../src/shortcut/run-command.js';

describe('runCommand', () => {
  it('resolves the exit status and the stdout text', async () => {
    const result = await runCommand(process.execPath, ['-e', 'process.stdout.write("Désktop"); process.exitCode = 3']);

    expect(result).toEqual({ status: 3, stdout: 'Désktop' });
  });

  it('resolves a null status for a command that outlives its timeout', async () => {
    const result = await runCommand(process.execPath, ['-e', 'setTimeout(() => undefined, 30000)'], 200);

    expect(result.status).toBeNull();
  });

  it('resolves a null status for a command that cannot start', async () => {
    const result = await runCommand('ndmcp-no-such-command', []);

    expect(result).toEqual({ status: null, stdout: '' });
  });
});
