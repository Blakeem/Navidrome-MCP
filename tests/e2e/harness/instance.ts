/**
 * Navidrome MCP Server - e2e navidrome-web instance
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * The instance is the compiled dist/web/main.js on its own port, store and mpv pipe, so a run never
 * touches the user's player on its port or the mpv it shares with any MCP server.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, posix } from 'node:path';

import { MAX_AUTH_RATE_LIMIT_WAIT_MS } from '../../../src/constants/timeouts.js';
import { getDefaultIpcPath } from '../../../src/services/playback/mpv-process.js';

const DIST_WEB_MAIN = join(process.cwd(), 'dist', 'web', 'main.js');

/** The child logs in to Navidrome at startup, which may wait out one rate limit. */
const STARTUP_TIMEOUT_MS = MAX_AUTH_RATE_LIMIT_WAIT_MS + 10_000;
const EXIT_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 250;
const LOG_TAIL_LINES = 20;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The OS picks a port no other process holds, which a random port cannot promise. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, () => {
      const address = server.address();
      server.close(() => {
        if (address === null || typeof address === 'string') reject(new Error('e2e: the OS returned no TCP port'));
        else resolve(address.port);
      });
    });
  });
}

/**
 * `getDefaultIpcPath` builds the pipe name from USERNAME on Windows and places the socket under
 * XDG_RUNTIME_DIR elsewhere, so overriding that variable in the child gives it a private pipe.
 */
export function privateIpcEnv(runDir: string, runId: string): NodeJS.ProcessEnv {
  if (process.platform === 'win32') return { USERNAME: `ndmcp-e2e-${runId}` };
  const userRuntimeDir = process.env['XDG_RUNTIME_DIR'];
  // The child's mpv inherits this env, and PipeWire and libpulse look for their sockets under XDG_RUNTIME_DIR.
  if (userRuntimeDir === undefined || userRuntimeDir.trim() === '') {
    if (process.platform === 'linux') {
      throw new Error(
        'e2e: XDG_RUNTIME_DIR is not set. The harness moves it for the instance\'s private mpv pipe and points ' +
        'PipeWire and PulseAudio at yours, so it needs yours. Set it to your runtime folder, such as /run/user/$(id -u).',
      );
    }
    return { XDG_RUNTIME_DIR: runDir };
  }
  return {
    XDG_RUNTIME_DIR: runDir,
    PIPEWIRE_RUNTIME_DIR: process.env['PIPEWIRE_RUNTIME_DIR'] ?? userRuntimeDir,
    PULSE_RUNTIME_PATH: process.env['PULSE_RUNTIME_PATH'] ?? posix.join(userRuntimeDir, 'pulse'),
  };
}

/** Runs the product's own path rule under the child's env, so the harness reads the pipe the child opens. */
export function ipcPathUnder(env: NodeJS.ProcessEnv): string {
  const saved = new Map(Object.keys(env).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, env);
    return getDefaultIpcPath();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

export function assertPrivatePipe(ipcPath: string): void {
  const defaultPath = getDefaultIpcPath();
  if (ipcPath === defaultPath) {
    throw new Error(`e2e: the instance mpv pipe ${ipcPath} equals the default pipe, so the run would control the user's mpv.`);
  }
}

export function spawnInstance(storePath: string, extraEnv: NodeJS.ProcessEnv): ChildProcess {
  if (!existsSync(DIST_WEB_MAIN)) {
    throw new Error(`e2e: ${DIST_WEB_MAIN} is missing. Run \`pnpm build\` (pnpm test:e2e builds first).`);
  }
  return spawn(process.execPath, [DIST_WEB_MAIN], {
    env: { ...process.env, NAVIDROME_CONFIG_PATH: storePath, NAVIDROME_WEB_AUTO_OPEN: '0', ...extraEnv },
    stdio: 'ignore',
  });
}

function logTail(logPath: string): string {
  if (!existsSync(logPath)) return `(no log at ${logPath})`;
  return readFileSync(logPath, 'utf8').trimEnd().split(/\r?\n/).slice(-LOG_TAIL_LINES).join('\n');
}

async function answersHealthz(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/healthz`);
    return res.ok;
  } catch {
    return false;
  }
}

/** Fails with the child's log tail, since a failed start writes its reason there and not to a pipe. */
export async function waitForHealthy(baseUrl: string, child: ChildProcess, logPath: string): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      const exit = child.signalCode === null ? `with code ${String(child.exitCode)}` : `on signal ${child.signalCode}`;
      throw new Error(`e2e: navidrome-web exited ${exit} during startup. Log tail:\n${logTail(logPath)}`);
    }
    if (await answersHealthz(baseUrl)) return;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`e2e: navidrome-web did not answer ${baseUrl}/healthz within ${String(STARTUP_TIMEOUT_MS)} ms. Log tail:\n${logTail(logPath)}`);
}

/** Resolves true when the child has exited, or false at the timeout. */
export function waitForExit(child: ChildProcess, timeoutMs = EXIT_TIMEOUT_MS): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}
