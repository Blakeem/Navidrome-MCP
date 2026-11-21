/**
 * Navidrome MCP Server - Jukebox Remote desktop shortcut writer
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// The shortcut bakes in absolute node and dist/web/main.js paths, so neither resolves through PATH.
// Nothing here writes to stdout, since the settings server that calls it can run inside the stdio MCP server.

import { randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { readSettings } from '../config/store.js';
import { removeOldShortcuts, type OldShortcutReport } from './old-cleanup.js';
import {
  APP_NAME,
  desktopDir,
  ICON_ICNS,
  ICON_ICO,
  ICON_PNG,
  PLAYER_MAIN_JS,
  windowsRunnerDir,
  windowsStartMenuDir,
} from './paths.js';
import { runCommand } from './run-command.js';

const SHORTCUT_DESCRIPTION = `${APP_NAME} for Navidrome (controls local mpv)`;
const FILE_STEM = 'jukebox-remote';

interface WrittenShortcuts {
  /** The files a user double-clicks. */
  written: string[];
  /** The Windows script the written shortcuts start. Null when no written file is a shortcut to it. */
  runner: string | null;
}

export interface ShortcutResult extends WrittenShortcuts {
  oldCleanup: OldShortcutReport;
  /** An unconfigured player opens the settings page on its first launch. */
  unconfigured: boolean;
}

type ShortcutMaker = (nodePath: string, desktop: string) => Promise<WrittenShortcuts>;

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function isUnconfigured(): boolean {
  const url = readSettings()?.navidrome?.url;
  return url === undefined || url.trim() === '' || url.includes('your-server');
}

async function makeLinux(nodePath: string, desktop: string): Promise<WrittenShortcuts> {
  const content = [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    `Name=${APP_NAME}`,
    'GenericName=Music Player',
    `Comment=${SHORTCUT_DESCRIPTION}`,
    // The Exec parser splits on spaces, so both paths are quoted.
    `Exec="${nodePath}" "${PLAYER_MAIN_JS}"`,
    `Icon=${existsSync(ICON_PNG) ? ICON_PNG : 'multimedia-player'}`,
    'Terminal=false',
    'Categories=AudioVideo;Audio;Player;',
    'StartupNotify=false',
    '',
  ].join('\n');

  const written: string[] = [];
  const fileName = `${FILE_STEM}.desktop`;

  const appsDir = join(homedir(), '.local', 'share', 'applications');
  ensureDir(appsDir);
  const appsFile = join(appsDir, fileName);
  writeFileSync(appsFile, content, { mode: 0o755 });
  written.push(appsFile);

  const deskFile = join(desktop, fileName);
  writeFileSync(deskFile, content, { mode: 0o755 });
  written.push(deskFile);

  // GNOME opens an untrusted Desktop entry as text. Other desktops ignore these best-effort calls.
  await runCommand('gio', ['set', deskFile, 'metadata::trusted', 'true']);
  chmodSync(deskFile, 0o755);
  await runCommand('update-desktop-database', [appsDir]);

  return { written, runner: null };
}

function makeMac(nodePath: string, desktop: string): Promise<WrittenShortcuts> {
  const appDir = join(desktop, `${APP_NAME}.app`);
  const macosDir = join(appDir, 'Contents', 'MacOS');
  ensureDir(macosDir);

  // A copied icon keeps the bundle self-contained, so a moved .app keeps its icon.
  const hasIcon = existsSync(ICON_ICNS);
  if (hasIcon) {
    const resourcesDir = join(appDir, 'Contents', 'Resources');
    ensureDir(resourcesDir);
    copyFileSync(ICON_ICNS, join(resourcesDir, `${FILE_STEM}.icns`));
  }

  const plist = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>CFBundleName</key>',
    `  <string>${APP_NAME}</string>`,
    '  <key>CFBundleDisplayName</key>',
    `  <string>${APP_NAME}</string>`,
    '  <key>CFBundleIdentifier</key>',
    // The bundle id is the app's identity, which the rename leaves unchanged.
    '  <string>com.navidrome.mcp.webplayer</string>',
    '  <key>CFBundleVersion</key>',
    '  <string>1.0</string>',
    '  <key>CFBundlePackageType</key>',
    '  <string>APPL</string>',
    '  <key>CFBundleExecutable</key>',
    '  <string>launcher</string>',
    ...(hasIcon
      ? ['  <key>CFBundleIconFile</key>', `  <string>${FILE_STEM}.icns</string>`]
      : []),
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
  writeFileSync(join(appDir, 'Contents', 'Info.plist'), plist);

  // Finder starts a .app with launchd's PATH, which omits Homebrew, so mpv detection needs it.
  const launcher = [
    '#!/bin/bash',
    'export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"',
    `exec "${nodePath}" "${PLAYER_MAIN_JS}"`,
    '',
  ].join('\n');
  const launcherPath = join(macosDir, 'launcher');
  writeFileSync(launcherPath, launcher, { mode: 0o755 });
  chmodSync(launcherPath, 0o755);

  return Promise.resolve({ written: [appDir], runner: null });
}

function vbsLiteral(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

interface WindowsShortcutSpec {
  lnkPath: string;
  target: string;
  args: string;
  icon: string;
  description: string;
}

/** Node has no writer for the binary .lnk format, so a temp .vbs drives WScript.Shell. */
async function createWindowsShortcut(spec: WindowsShortcutSpec): Promise<boolean> {
  const lines = [
    'Set sh = CreateObject("WScript.Shell")',
    `Set lnk = sh.CreateShortcut(${vbsLiteral(spec.lnkPath)})`,
    `lnk.TargetPath = ${vbsLiteral(spec.target)}`,
    `lnk.Arguments = ${vbsLiteral(spec.args)}`,
  ];
  if (spec.icon !== '') lines.push(`lnk.IconLocation = ${vbsLiteral(`${spec.icon}, 0`)}`);
  lines.push(`lnk.Description = ${vbsLiteral(spec.description)}`, 'lnk.WindowStyle = 7', 'lnk.Save', '');

  // A unique name, since two settings page requests in one process can run at once.
  const tmpVbs = join(tmpdir(), `nd-shortcut-${randomUUID()}.vbs`);
  try {
    writeFileSync(tmpVbs, lines.join('\r\n'));
    // Batch mode (//B) suppresses script errors and prompts, so a failure cannot block on a dialog.
    const res = await runCommand('cscript', ['//nologo', '//B', tmpVbs]);
    return res.status === 0 && existsSync(spec.lnkPath);
  } catch {
    return false;
  } finally {
    try {
      unlinkSync(tmpVbs);
    } catch {
      /* temp file already gone */
    }
  }
}

async function makeWindows(nodePath: string, desktop: string): Promise<WrittenShortcuts> {
  // Run takes "<node>" "<mainJs>" as one VBS literal, so each inner quote is doubled.
  // Window style 0 hides the console, and False returns without waiting for the player.
  const vbsArg = `"""${nodePath}"" ""${PLAYER_MAIN_JS}"""`;
  const content = [
    `' ${APP_NAME}. Launches the ${APP_NAME} with no console window.`,
    "' Generated by navidrome-mcp. Create the shortcut again to refresh the baked-in paths.",
    'Set sh = CreateObject("WScript.Shell")',
    `sh.Run ${vbsArg}, 0, False`,
    '',
  ].join('\r\n');

  // Only a .lnk carries a custom icon, so the Desktop and Start Menu get shortcuts to one runner.
  const runnerDir = windowsRunnerDir();
  ensureDir(runnerDir);
  const runnerVbs = join(runnerDir, `${APP_NAME}.vbs`);
  writeFileSync(runnerVbs, content);

  // An icon copy beside the runner keeps IconLocation valid if the package's assets/ dir goes away.
  let iconPath = existsSync(ICON_ICO) ? ICON_ICO : '';
  if (iconPath !== '') {
    try {
      const localIcon = join(runnerDir, `${FILE_STEM}.ico`);
      copyFileSync(ICON_ICO, localIcon);
      iconPath = localIcon;
    } catch {
      /* fall back to referencing the asset in place */
    }
  }

  // Targeting wscript.exe bypasses the .vbs file association, which a locked-down
  // machine may map to an editor.
  const systemRoot = process.env['SystemRoot'] ?? 'C:\\Windows';
  const wscript = join(systemRoot, 'System32', 'wscript.exe');

  const startMenuDir = windowsStartMenuDir();
  const shortcutDirs = startMenuDir === null ? [desktop] : [desktop, startMenuDir];

  const written: string[] = [];
  let anyShortcut = false;
  for (const dir of shortcutDirs) {
    try {
      ensureDir(dir);
    } catch {
      continue;
    }
    const lnkPath = join(dir, `${APP_NAME}.lnk`);
    const ok = await createWindowsShortcut({
      lnkPath,
      target: wscript,
      args: `"${runnerVbs}"`,
      icon: iconPath,
      description: SHORTCUT_DESCRIPTION,
    });
    if (ok) {
      written.push(lnkPath);
      anyShortcut = true;
    } else {
      // When cscript is blocked, an iconless .vbs copy still gives a working launcher.
      const fallback = join(dir, `${APP_NAME}.vbs`);
      try {
        writeFileSync(fallback, content);
        written.push(fallback);
      } catch {
        /* Other locations may still be writable. */
      }
    }
  }

  // With no shortcut or copy written, the runner itself is the file to double-click.
  if (written.length === 0) return { written: [runnerVbs], runner: null };
  return { written, runner: anyShortcut ? runnerVbs : null };
}

function cleanOldShortcuts(desktop: string): OldShortcutReport {
  return removeOldShortcuts({
    platform: process.platform,
    desktopDir: desktop,
    homeDir: homedir(),
    startMenuDir: windowsStartMenuDir(),
    runnerDir: windowsRunnerDir(),
    iconIcoPath: ICON_ICO,
  });
}

const MAKERS_BY_PLATFORM: Partial<Record<NodeJS.Platform, ShortcutMaker>> = {
  linux: makeLinux,
  darwin: makeMac,
  win32: makeWindows,
};

export function assertPlayerBuilt(): void {
  if (!existsSync(PLAYER_MAIN_JS)) {
    throw new Error(`Built player not found at ${PLAYER_MAIN_JS}. Build it first with: pnpm build`);
  }
}

/** Rejects when the player is not built or the platform has no shortcut format. */
export async function createJukeboxShortcut(): Promise<ShortcutResult> {
  assertPlayerBuilt();
  const make = MAKERS_BY_PLATFORM[process.platform];
  if (make === undefined) {
    throw new Error(`Unsupported platform: ${process.platform}. Run the player with: node "${PLAYER_MAIN_JS}"`);
  }

  // One query, since each Windows Desktop lookup starts PowerShell.
  const desktop = await desktopDir();
  const shortcuts = await make(process.execPath, desktop);
  // After the new shortcuts exist, so a failed run never leaves the user with neither.
  const oldCleanup = cleanOldShortcuts(desktop);

  return { ...shortcuts, oldCleanup, unconfigured: isUnconfigured() };
}
