/**
 * Navidrome MCP Server - e2e run environment
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Playwright passes values from globalSetup to the workers only through process.env.
 */

export interface Instance {
  port: number;
  /** Loopback, so the admin session counts as local. */
  baseUrl: string;
  adminPassword: string;
  /** The private mpv IPC path of the instance, never the default path that the user's mpv listens on. */
  ipcPath: string;
}

interface RunEnv {
  instance: Instance;
  /** The Playwright storage state that holds the run's one admin login. */
  adminStatePath: string;
}

const KEYS = {
  port: 'NDMCP_E2E_PORT',
  adminPassword: 'NDMCP_E2E_ADMIN_PASSWORD',
  ipcPath: 'NDMCP_E2E_IPC_PATH',
  adminStatePath: 'NDMCP_E2E_ADMIN_STATE',
} as const;

export function loopbackBaseUrl(port: number): string {
  return `http://127.0.0.1:${String(port)}`;
}

export function publishRunEnv(run: RunEnv): void {
  process.env[KEYS.port] = String(run.instance.port);
  process.env[KEYS.adminPassword] = run.instance.adminPassword;
  process.env[KEYS.ipcPath] = run.instance.ipcPath;
  process.env[KEYS.adminStatePath] = run.adminStatePath;
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined || value === '') {
    throw new Error(`${key} is not set. Run the suite with \`pnpm test:e2e\`, whose globalSetup starts the instance.`);
  }
  return value;
}

export function readRunEnv(): RunEnv {
  const port = Number(requireEnv(KEYS.port));
  return {
    instance: {
      port,
      baseUrl: loopbackBaseUrl(port),
      adminPassword: requireEnv(KEYS.adminPassword),
      ipcPath: requireEnv(KEYS.ipcPath),
    },
    adminStatePath: requireEnv(KEYS.adminStatePath),
  };
}
