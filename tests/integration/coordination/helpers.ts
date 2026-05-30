/**
 * Navidrome MCP Server - Multi-process coordination test helpers
 * Copyright (C) 2025
 *
 * These tests spawn REAL child processes (`navidrome-web`, and optionally the
 * MCP server) to exercise behaviors the single-process unit suite cannot:
 * port-as-lock ownership, attach-not-bind, and survive-MCP-close (spec §4.10).
 *
 * Gated like the live playback suite: skipped when Navidrome is unreachable
 * (the children call `createRuntime` which authenticates) or when the build
 * artifact is missing (these run the COMPILED `dist/web/main.js` — the prod
 * path). They manipulate only local ports + mpv, never Navidrome data.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe } from 'vitest';

import { getSettingsStorePath } from '../../../src/config/store-path.js';
import { getDefaultIpcPath } from '../../../src/services/playback/mpv-process.js';
import { shouldSkipLiveTests } from '../../helpers/env-detection.js';

const DIST_WEB_MAIN = join(process.cwd(), 'dist', 'web', 'main.js');
const IPC_PARENT_HARNESS = join(
  process.cwd(),
  'tests',
  'integration',
  'coordination',
  'fixtures',
  'ipc-parent.mjs',
);

function buildMissing(): boolean {
  return !existsSync(DIST_WEB_MAIN);
}

function skipReason(): string {
  if (buildMissing()) return 'run `pnpm build` first (coordination tests run dist/)';
  return 'live tests disabled (no Navidrome config or CI without server)';
}

/** describe wrapper: skip unless Navidrome is reachable AND the build exists. */
export function describeCoordination(name: string, fn: () => void): void {
  if (shouldSkipLiveTests() || buildMissing()) {
    describe.skip(`${name} (skipped: ${skipReason()})`, fn);
  } else {
    describe(name, fn);
  }
}

// A random base (avoids collisions across concurrent runs/machines) plus a
// monotonic offset (guarantees no two calls in THIS process — across files in
// the same fork — ever return the same port, even if an earlier server's port
// hasn't been released yet). Math.random is fine in test code.
const PORT_BASE = 20000 + Math.floor(Math.random() * 10000);
let portOffset = 0;
const usedPorts: number[] = [];

/** A unique high port for a test server. Tracked so afterEach can tear down any
 * server (incl. a detached grandchild) left on it. */
export function randomPort(): number {
  portOffset += 1;
  const port = PORT_BASE + portOffset;
  usedPorts.push(port);
  return port;
}

/**
 * Write a throwaway settings.json cloned from the test's seeded store (so
 * credentials work) but with an isolated webui port. Children read it via
 * `NAVIDROME_CONFIG_PATH`.
 */
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
  const path = join(dir, 'settings.json');
  writeFileSync(path, JSON.stringify(base));
  return path;
}

/**
 * Spawn the IPC-parent harness (mimics MCP): it spawns `navidrome-web` over an
 * IPC channel and stays alive until killed. Killing the harness is how we
 * simulate "the MCP server exited" so the web child's disconnect path runs.
 */
export function spawnIpcParent(storePath: string): ChildProcess {
  const child = spawn(process.execPath, [IPC_PARENT_HARNESS, DIST_WEB_MAIN, storePath], {
    stdio: 'ignore',
  });
  children.push(child);
  return child;
}

const children: ChildProcess[] = [];

/** Spawn a compiled `navidrome-web` child pointed at `storePath`. Tracked for
 * teardown. Not detached so the test can reliably kill it. */
export function spawnWeb(storePath: string, extraEnv: NodeJS.ProcessEnv = {}): ChildProcess {
  const child = spawn(process.execPath, [DIST_WEB_MAIN], {
    env: { ...process.env, NAVIDROME_CONFIG_PATH: storePath, NAVIDROME_WEB_AUTO_OPEN: '0', ...extraEnv },
    stdio: 'ignore',
  });
  children.push(child);
  return child;
}

/** Tear down everything a test started. Call in afterEach. Robust against
 * detached grandchildren (which we can't kill by handle) and orphaned mpv:
 * (1) ask any web server on a used port to shut down via its loopback power
 * endpoint (this also quits mpv), (2) SIGKILL tracked harness/owner processes,
 * (3) quit any mpv still lingering. Keeps each test self-contained. */
export async function killAllChildren(): Promise<void> {
  for (const port of usedPorts.splice(0)) {
    await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST' }).catch(() => undefined);
  }
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }
  await delay(400);
  // Orphan safety: a web server we couldn't reach may have left mpv playing.
  if (await mpvAlive()) {
    await quitMpvForTests();
    await delay(200);
  }
  // Space tests out so child auth logins don't burst (Navidrome rate-limits
  // logins) and OS ports fully release before the next test spawns.
  await delay(1500);
}

/** One-shot mpv quit over its IPC socket (best-effort), for test teardown. */
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
    const timer = setTimeout(() => { try { sock.destroy(); } catch { /* */ } done(); }, 800);
    timer.unref();
    sock.once('connect', () => { try { sock.end('{ "command": ["quit"] }\n'); } catch { /* */ } });
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

/** Probe /healthz on loopback. Returns the parsed signature, or null if not up. */
export async function healthz(port: number): Promise<HealthSignature | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    if (!res.ok) return null;
    return (await res.json()) as HealthSignature;
  } catch {
    return null;
  }
}

/** Poll `predicate` until it resolves truthy or the timeout elapses. Default
 * timeout is generous because these tests spawn real authenticating child
 * processes whose startup (Navidrome login + filter-cache load) slows under the
 * load of several siblings in one fork. */
export async function waitFor(
  predicate: () => Promise<boolean>,
  { timeoutMs = 30000, intervalMs = 250 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true;
    await delay(intervalMs);
  }
  return false;
}

/** Whether an mpv is listening on the user-scoped IPC socket (one-shot connect). */
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

/** Resolve with the child's exit code (or null on timeout). */
export function waitForExit(child: ChildProcess, timeoutMs = 20000): Promise<number | null> {
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
