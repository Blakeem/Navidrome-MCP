/**
 * Navidrome MCP Server - Headless mpv runner
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { spawn } from 'node:child_process';

/** `failure` is set when the run timed out or never started, and then `code` means nothing. */
export interface MpvRun {
  code: number | null;
  output: string;
  failure: string | null;
}

export function runMpv(mpvBinary: string, args: readonly string[], timeoutMs: number): Promise<MpvRun> {
  return new Promise((resolve) => {
    let output = '';
    const child = spawn(mpvBinary, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: null, output, failure: `mpv did not finish in ${timeoutMs} ms` });
    }, timeoutMs);
    const collect = (chunk: Buffer): void => { output += chunk.toString('utf8'); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: null, output, failure: err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output, failure: null });
    });
  });
}
