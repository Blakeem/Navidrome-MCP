/**
 * Navidrome MCP Server - Paths for the Jukebox Remote shortcut generator
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_NAME = 'Jukebox Remote';

// src/shortcut and dist/shortcut both sit two levels below the package root, which holds dist/ and
// assets/ in a dev clone and in an `npm install -g` layout.
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const PACKAGE_INDEX_JS = join(PACKAGE_ROOT, 'dist', 'index.js');
// The shortcut runs the player module directly, so it needs no subcommand argument.
export const PLAYER_MAIN_JS = join(PACKAGE_ROOT, 'dist', 'web', 'main.js');

// A missing icon file falls back to a theme icon on Linux and to no custom icon elsewhere.
export const ICON_PNG = join(PACKAGE_ROOT, 'assets', 'jukebox-remote.png');
export const ICON_ICO = join(PACKAGE_ROOT, 'assets', 'jukebox-remote.ico');
export const ICON_ICNS = join(PACKAGE_ROOT, 'assets', 'jukebox-remote.icns');

// Windows can redirect the Desktop to OneDrive and XDG can localize it, so ~/Desktop is a fallback.
// PowerShell 5.1 writes redirected stdout in the OEM code page, which mangles a non-ASCII path.
const WIN_DESKTOP_QUERY = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; [Environment]::GetFolderPath('Desktop')";
const DESKTOP_QUERIES: Partial<Record<NodeJS.Platform, { command: string; args: string[] }>> = {
  win32: { command: 'powershell', args: ['-NoProfile', '-Command', WIN_DESKTOP_QUERY] },
  linux: { command: 'xdg-user-dir', args: ['DESKTOP'] },
};

function queryPlatformDesktop(): string | null {
  const query = DESKTOP_QUERIES[process.platform];
  if (query === undefined) return null;
  const res = spawnSync(query.command, query.args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (res.status !== 0 || typeof res.stdout !== 'string') return null;
  const reported = res.stdout.trim();
  // xdg-user-dir reports the home dir when no Desktop is configured.
  if (reported === '' || reported === homedir() || !existsSync(reported)) return null;
  return reported;
}

export function desktopDir(): string {
  const reported = queryPlatformDesktop();
  if (reported !== null) return reported;
  const candidate = join(homedir(), 'Desktop');
  return existsSync(candidate) ? candidate : homedir();
}

export function windowsStartMenuDir(): string | null {
  const appData = process.env['APPDATA'];
  if (appData === undefined || appData.trim() === '') return null;
  return join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
}

/** Both the runner and the old runner of the previous generator sit here, so the cleanup reads it too. */
export function windowsRunnerDir(): string {
  const base = process.env['LOCALAPPDATA'] ?? process.env['APPDATA'] ?? '';
  return base.trim() !== '' ? join(base, 'navidrome-mcp') : PACKAGE_ROOT;
}
