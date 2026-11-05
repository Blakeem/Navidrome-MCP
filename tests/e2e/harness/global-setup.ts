/**
 * Navidrome MCP Server - e2e global setup and teardown
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * One instance serves the entire run, since Playwright replaces a worker after each failed test and
 * a worker-scoped instance would restart with it. The admin logs in once per run, since the login
 * throttle counts every attempt, successes included.
 */

import type { ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from '@playwright/test';

import { errorMessage } from '../../../src/utils/error-formatter.js';
import { hashPassword } from '../../../src/utils/secrets.js';
import { AdminApi } from './admin-api.js';
import {
  assertPrivatePipe,
  freePort,
  ipcPathUnder,
  privateIpcEnv,
  spawnInstance,
  waitForExit,
  waitForHealthy,
} from './instance.js';
import { MpvProbe } from './mpv-probe.js';
import { loopbackBaseUrl, publishRunEnv } from './run-env.js';
import { writeTempStore } from './temp-store.js';

interface RunState {
  runDir: string;
  baseUrl: string;
  /** Null until the pipe passes `assertPrivatePipe`, so teardown never quits the user's mpv. */
  ipcPath: string | null;
  adminStatePath: string;
  child: ChildProcess | null;
}

/** Each step runs even when an earlier one fails, so a failed teardown never leaves a process or the temp folder. */
export async function teardown(run: RunState): Promise<void> {
  const problems: string[] = [];
  // The shutdown route needs the admin session, which a setup that failed before the login never saved.
  if (run.child !== null && existsSync(run.adminStatePath)) {
    await shutDownInstance(run).catch((err: unknown) => problems.push(`shutdown request: ${errorMessage(err)}`));
    if (!(await waitForExit(run.child))) run.child.kill();
  } else if (run.child !== null) {
    run.child.kill();
  }
  // A child that missed the shutdown request leaves its mpv running on the private pipe.
  if (run.ipcPath !== null) {
    await new MpvProbe(run.ipcPath).quitIfRunning().catch((err: unknown) => problems.push(`mpv quit: ${errorMessage(err)}`));
  }
  try {
    rmSync(run.runDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch (err) {
    problems.push(`remove ${run.runDir}: ${errorMessage(err)}`);
  }
  if (problems.length > 0) throw new Error(`e2e teardown: ${problems.join('; ')}`);
}

/** The shutdown route quits the child's mpv too. On Windows `child.kill()` is a hard kill that skips it. */
async function shutDownInstance(run: RunState): Promise<void> {
  const context = await request.newContext({ baseURL: run.baseUrl, storageState: run.adminStatePath });
  try {
    await new AdminApi(context).post('/api/shutdown');
  } finally {
    await context.dispose();
  }
}

async function logInOnce(run: RunState, adminPassword: string): Promise<void> {
  const context = await request.newContext({ baseURL: run.baseUrl });
  try {
    const response = await context.post('/api/auth/login', { data: { password: adminPassword } });
    if (!response.ok()) {
      throw new Error(`e2e: the admin login answered ${String(response.status())}: ${await response.text()}`);
    }
    await context.storageState({ path: run.adminStatePath });
  } finally {
    await context.dispose();
  }
}

// The config names this file as globalSetup, which the export analysis cannot see.
// ts-unused-exports:disable-next-line
export default async function globalSetup(): Promise<() => Promise<void>> {
  const runDir = mkdtempSync(join(tmpdir(), 'ndmcp-e2e-'));
  const runId = randomBytes(4).toString('hex');
  const run: RunState = {
    runDir,
    baseUrl: '',
    ipcPath: null,
    adminStatePath: join(runDir, 'admin-state.json'),
    child: null,
  };

  try {
    const childEnv = privateIpcEnv(runDir, runId);
    const ipcPath = ipcPathUnder(childEnv);
    assertPrivatePipe(ipcPath);
    run.ipcPath = ipcPath;
    const port = await freePort();
    const adminPassword = randomBytes(18).toString('base64url');
    const storePath = writeTempStore({ runDir, port, adminPasswordHash: await hashPassword(adminPassword) });
    run.baseUrl = loopbackBaseUrl(port);
    run.child = spawnInstance(storePath, childEnv);
    await waitForHealthy(run.baseUrl, run.child, join(runDir, 'navidrome-web.log'));
    await logInOnce(run, adminPassword);
    publishRunEnv({ instance: { port, baseUrl: run.baseUrl, adminPassword, ipcPath }, adminStatePath: run.adminStatePath });
  } catch (err) {
    // Playwright registers the teardown only when setup returns, so a failed setup cleans up here.
    const cleanupProblem = await teardown(run).then(() => null, (teardownErr: unknown) => errorMessage(teardownErr));
    if (cleanupProblem !== null) throw new Error(`${errorMessage(err)}\n${cleanupProblem}`, { cause: err });
    throw err;
  }
  return () => teardown(run);
}
