/**
 * Navidrome MCP Server - Jukebox Remote first-run setup mode test
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * A first-run desktop-shortcut launch shows no terminal, so the settings page
 * that setup mode hosts is the only visible path to configuration.
 */

import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import {
  describeCoordination,
  healthz,
  killAllChildren,
  PLAYER_STARTUP_TIMEOUT_MS,
  randomPort,
  spawnUnconfiguredWeb,
  testStoreSettings,
  waitFor,
  waitForExit,
} from './helpers.js';

const SETTINGS_URL_LINE = /Open this in your browser to set it up:\s+(\S+)/;
const SETTINGS_URL_TIMEOUT_MS = 20000;

function readSettingsUrl(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    const timer = setTimeout(() => {
      reject(new Error(`no settings URL on stdout within ${SETTINGS_URL_TIMEOUT_MS} ms: ${stdout}`));
    }, SETTINGS_URL_TIMEOUT_MS);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
      const url = SETTINGS_URL_LINE.exec(stdout)?.[1];
      if (url === undefined) return;
      clearTimeout(timer);
      resolve(url);
    });
  });
}

describeCoordination('Jukebox Remote setup mode', () => {
  let storeDir: string | null = null;

  afterEach(async () => {
    await killAllChildren();
    if (storeDir !== null) rmSync(storeDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    storeDir = null;
  });

  it('hosts the settings page when no configuration exists', async () => {
    storeDir = mkdtempSync(join(tmpdir(), 'ndmcp-setup-'));
    const child = spawnUnconfiguredWeb(join(storeDir, 'settings.json'));

    const url = await readSettingsUrl(child);
    const page = await fetch(url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<form');

    child.kill('SIGTERM');
    await waitForExit(child);
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });

  it('starts the player on the saved port after a usable Save, and closes the settings page', async () => {
    storeDir = mkdtempSync(join(tmpdir(), 'ndmcp-setup-'));
    const port = randomPort();
    const child = spawnUnconfiguredWeb(join(storeDir, 'settings.json'));
    const url = await readSettingsUrl(child);

    const res = await fetch(`${url}api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testStoreSettings(port)),
    });
    const reply = (await res.json()) as { pageClosed?: boolean; nextSteps?: { text: string; url?: string }[] };

    expect(reply.pageClosed).toBe(true);
    expect(reply.nextSteps?.[0]?.text).toBe('The Jukebox Remote is starting.');
    expect(reply.nextSteps?.[1]?.url).toBe(`http://127.0.0.1:${String(port)}/admin`);
    expect(await waitFor(async () => (await healthz(port))?.app === 'navidrome-mcp-web')).toBe(true);
    await expect(fetch(url)).rejects.toThrow();
    expect(child.exitCode).toBeNull();
  }, PLAYER_STARTUP_TIMEOUT_MS * 2);
});
