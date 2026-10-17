/**
 * Navidrome MCP Server - Multi-process coordination test helpers
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Port-as-lock and the MCP exit paths need real processes, so these spawn the compiled
 * dist/web/main.js. They touch local ports and mpv, never Navidrome data.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe } from 'vitest';

import { getSettingsStorePath } from '../../../src/config/store-path.js';
import { MAX_AUTH_RATE_LIMIT_WAIT_MS } from '../../../src/constants/timeouts.js';
import { getDefaultIpcPath } from '../../../src/services/playback/mpv-process.js';
import { shouldSkipLiveTests } from '../../helpers/env-detection.js';

const DIST_WEB_MAIN = join(process.cwd(), 'dist', 'web', 'main.js');

/** Back-to-back player logins exceed Navidrome's login rate limit, so a startup wait must outlast
 * one Retry-After wait plus the startup itself. */
export const PLAYER_STARTUP_TIMEOUT_MS = MAX_AUTH_RATE_LIMIT_WAIT_MS + 10_000;
const IPC_PARENT_HARNESS = join(
  process.cwd(),
  'tests',
  'integration',
  'coordination',
  'fixtures',
  'ipc-parent.mjs',
);
const LEASE_HOLDER_HARNESS = join(process.cwd(), 'tests', 'integration', 'coordination', 'fixtures', 'lease-holder.mjs');

function buildMissing(): boolean {
  return !existsSync(DIST_WEB_MAIN);
}

function skipReason(): string {
  if (buildMissing()) return 'run `pnpm build` first (coordination tests run dist/)';
  return 'live tests disabled (no Navidrome config or CI without server)';
}

export function describeCoordination(name: string, fn: () => void): void {
  if (shouldSkipLiveTests() || buildMissing()) {
    describe.skip(`${name} (skipped: ${skipReason()})`, fn);
  } else {
    describe(name, fn);
  }
}

// The random base avoids collisions with concurrent runs. The offset keeps every port unique within
// this fork, since an earlier test's port may not be released yet.
const PORT_BASE = 20000 + Math.floor(Math.random() * 10000);
let portOffset = 0;
const usedPorts: number[] = [];

/** Tracked so teardown can shut down a server left on it, including a detached grandchild. */
export function randomPort(): number {
  portOffset += 1;
  const port = PORT_BASE + portOffset;
  usedPorts.push(port);
  return port;
}

// Each store copies the real credentials, so teardown removes every one.
const tempStoreDirs: string[] = [];

/** Clones the seeded test store, so the children get working credentials on an isolated port. */
export function makeTempStore(port: number, webuiOverrides: Record<string, unknown> = {}): string {
  const base = JSON.parse(readFileSync(getSettingsStorePath(), 'utf8')) as Record<string, unknown>;
  base['webui'] = {
    ...((base['webui'] as Record<string, unknown> | undefined) ?? {}),
    enabled: true,
    port,
    expose: false,
    autoOpenBrowser: false,
    ...webuiOverrides,
  };
  const dir = mkdtempSync(join(tmpdir(), 'ndmcp-coord-'));
  tempStoreDirs.push(dir);
  const path = join(dir, 'settings.json');
  writeFileSync(path, JSON.stringify(base));
  return path;
}

/**
 * Killing the returned harness simulates the MCP server exiting. `exitAfterSpawn` exits it during
 * the child's startup.
 */
export function spawnIpcParent(
  storePath: string,
  { exitAfterSpawn = false }: { exitAfterSpawn?: boolean } = {},
): ChildProcess {
  const args = [IPC_PARENT_HARNESS, DIST_WEB_MAIN, storePath];
  if (exitAfterSpawn) args.push('exit-after-spawn');
  const child = spawn(process.execPath, args, { stdio: 'ignore' });
  children.push(child);
  return child;
}

/** Resolves once the harness holds a lease, or null when it exits first. */
export function spawnLeaseHolder(storePath: string): Promise<ChildProcess | null> {
  const child = spawn(process.execPath, [LEASE_HOLDER_HARNESS, DIST_WEB_MAIN, storePath], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  children.push(child);
  return new Promise((resolve) => {
    child.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('lease-held')) resolve(child);
    });
    child.once('exit', () => resolve(null));
  });
}

const children: ChildProcess[] = [];

/** Not detached, so teardown can kill it by handle. */
export function spawnWeb(storePath: string, extraEnv: NodeJS.ProcessEnv = {}): ChildProcess {
  const child = spawn(process.execPath, [DIST_WEB_MAIN], {
    env: { ...process.env, NAVIDROME_CONFIG_PATH: storePath, NAVIDROME_WEB_AUTO_OPEN: '0', ...extraEnv },
    stdio: 'ignore',
  });
  children.push(child);
  return child;
}

/** Untracked, since setup mode never binds the web port or touches mpv. Its test owns teardown. */
export function spawnUnconfiguredWeb(storePath: string): ChildProcess {
  const env: NodeJS.ProcessEnv = { ...process.env, NAVIDROME_CONFIG_PATH: storePath, NAVIDROME_WEB_AUTO_OPEN: '0' };
  // The env fallback would configure the child from these and skip setup mode.
  delete env['NAVIDROME_URL'];
  delete env['NAVIDROME_USERNAME'];
  delete env['NAVIDROME_PASSWORD'];
  return spawn(process.execPath, [DIST_WEB_MAIN], { env, stdio: ['ignore', 'pipe', 'ignore'] });
}

/** A detached grandchild cannot be killed by handle, so each used port also gets a power request,
 * which quits mpv too. */
export async function killAllChildren(): Promise<void> {
  for (const port of usedPorts.splice(0)) {
    await fetch(`http://127.0.0.1:${port}/api/shutdown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => undefined);
  }
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }
  await delay(400);
  // A web server that missed the shutdown request may have left mpv playing.
  if (await mpvAlive()) {
    await quitMpvForTests();
    await delay(200);
  }
  for (const dir of tempStoreDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // A child still holding the file must not fail the teardown.
    }
  }
  // The gap keeps child logins under Navidrome's login rate limit and lets OS ports release.
  await delay(1500);
}

function quitMpvForTests(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (): void => { if (!settled) { settled = true; resolve(); } };
    let sock: ReturnType<typeof createConnection>;
    try {
      sock = createConnection({ path: getDefaultIpcPath() });
    } catch {
      done();
      return;
    }
    const timer = setTimeout(() => { try { sock.destroy(); } catch { /* best-effort */ } done(); }, 800);
    timer.unref();
    sock.once('connect', () => { try { sock.end('{ "command": ["quit"] }\n'); } catch { /* best-effort */ } });
    sock.once('close', () => { clearTimeout(timer); done(); });
    sock.once('error', () => { clearTimeout(timer); done(); });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface HealthSignature {
  app?: string;
  version?: string;
}

export async function healthz(port: number): Promise<HealthSignature | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    if (!res.ok) return null;
    return (await res.json()) as HealthSignature;
  } catch {
    return null;
  }
}

export async function waitFor(
  predicate: () => Promise<boolean>,
  { timeoutMs = PLAYER_STARTUP_TIMEOUT_MS, intervalMs = 250 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true;
    await delay(intervalMs);
  }
  return false;
}

export function mpvAlive(timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: boolean): void => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    let sock: ReturnType<typeof createConnection>;
    try {
      sock = createConnection({ path: getDefaultIpcPath() });
    } catch {
      done(false);
      return;
    }
    const timer = setTimeout(() => {
      try { sock.destroy(); } catch { /* noop */ }
      done(false);
    }, timeoutMs);
    timer.unref();
    sock.once('connect', () => {
      clearTimeout(timer);
      try { sock.destroy(); } catch { /* noop */ }
      done(true);
    });
    sock.once('error', () => {
      clearTimeout(timer);
      done(false);
    });
  });
}

/** Resolves null on timeout. */
export function waitForExit(child: ChildProcess, timeoutMs = PLAYER_STARTUP_TIMEOUT_MS): Promise<number | null> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode);
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, timeoutMs);
    child.once('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(code);
      }
    });
  });
}
