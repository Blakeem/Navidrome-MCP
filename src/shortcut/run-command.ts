/**
 * Navidrome MCP Server - Child process runner for the Jukebox Remote shortcut generator
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { spawn, type ChildProcess } from 'node:child_process';

/** A hung cscript or desktop query would otherwise hold the settings page's request open forever. */
const COMMAND_TIMEOUT_MS = 30_000;

interface CommandResult {
  /** Null when the command could not start, was killed or timed out. */
  status: number | null;
  stdout: string;
}

/**
 * Async, since the settings server that calls the generator can share its process with the Jukebox
 * Remote or the MCP server. Resolves instead of rejecting, because every caller has a fallback for a
 * missing or failing command.
 */
export function runCommand(command: string, args: readonly string[], timeoutMs = COMMAND_TIMEOUT_MS): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let child: ChildProcess;
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: timeoutMs });
    } catch {
      resolve({ status: null, stdout });
      return;
    }
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.on('error', () => resolve({ status: null, stdout }));
    child.on('close', (status: number | null) => resolve({ status, stdout }));
  });
}
