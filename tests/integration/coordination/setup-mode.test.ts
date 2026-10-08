/**
 * Navidrome MCP Server - navidrome-web first-run setup mode test
 * Copyright (C) 2025
 *
 * A first-run desktop-shortcut launch shows no terminal, so the settings page
 * that setup mode hosts is the only visible path to configuration.
 */

import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { describeCoordination, spawnUnconfiguredWeb, waitForExit } from './helpers.js';

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

describeCoordination('navidrome-web setup mode', () => {
  let web: ChildProcess | null = null;
  let storeDir: string | null = null;

  afterEach(() => {
    if (web !== null && web.exitCode === null && web.signalCode === null) web.kill('SIGKILL');
    web = null;
    if (storeDir !== null) rmSync(storeDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    storeDir = null;
  });

  it('hosts the settings page when no configuration exists', async () => {
    storeDir = mkdtempSync(join(tmpdir(), 'ndmcp-setup-'));
    const child = spawnUnconfiguredWeb(join(storeDir, 'settings.json'));
    web = child;

    const url = await readSettingsUrl(child);
    const page = await fetch(url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<form');

    child.kill('SIGTERM');
    await waitForExit(child);
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });
});
