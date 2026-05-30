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
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe } from 'vitest';

import { getSettingsStorePath } from '../../../src/config/store-path.js';
import { shouldSkipLiveTests } from '../../helpers/env-detection.js';

const DIST_WEB_MAIN = join(process.cwd(), 'dist', 'web', 'main.js');

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

/** Pick a high, unlikely-to-collide port. Math.random is fine in test code. */
export function randomPort(): number {
  return 20000 + Math.floor(Math.random() * 15000);
}

/**
 * Write a throwaway settings.json cloned from the test's seeded store (so
 * credentials work) but with an isolated webui port. Children read it via
 * `NAVIDROME_CONFIG_PATH`.
 */
export function makeTempStore(port: number): string {
  const base = JSON.parse(readFileSync(getSettingsStorePath(), 'utf8')) as Record<string, unknown>;
  base['webui'] = {
    ...((base['webui'] as Record<string, unknown> | undefined) ?? {}),
    enabled: true,
    port,
    expose: false,
    autoOpenBrowser: false,
  };
  const dir = mkdtempSync(join(tmpdir(), 'ndmcp-coord-'));
  const path = join(dir, 'settings.json');
  writeFileSync(path, JSON.stringify(base));
  return path;
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

/** Kill every spawned child. Call in afterEach. */
export async function killAllChildren(): Promise<void> {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }
  // Give the OS a moment to release the ports.
  await delay(300);
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

/** Poll `predicate` until it resolves truthy or the timeout elapses. */
export async function waitFor(
  predicate: () => Promise<boolean>,
  { timeoutMs = 20000, intervalMs = 250 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true;
    await delay(intervalMs);
  }
  return false;
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
