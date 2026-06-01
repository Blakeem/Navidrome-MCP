#!/usr/bin/env node
/**
 * Navidrome MCP Server - Desktop launcher generator for the standalone web player
 * Copyright (C) 2025
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Generate a double-clickable, no-terminal launcher for the standalone
 * `navidrome-web` player, tailored to THIS machine:
 *   - Linux:   a `.desktop` entry (Desktop + ~/.local/share/applications)
 *   - macOS:   a `Navidrome Player.app` bundle on the Desktop
 *   - Windows: a `.vbs` script (Desktop + Start Menu) that launches with no
 *              console window
 *
 * It bakes in absolute paths to the current `node` (process.execPath) and the
 * built `dist/web/main.js`, so the shortcut works without anything on PATH and
 * without npm being published. Run it again any time to refresh those paths
 * (e.g. after moving the repo).
 *
 *   pnpm make:launcher          # from a dev clone
 *   navidrome-web-shortcut      # after `npm i -g navidrome-mcp`
 *
 * Plain ESM JS on purpose: it ships as a published bin and must run with zero
 * build step and no dependencies beyond Node's stdlib.
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP_NAME = 'Navidrome Player';

const scriptDir = dirname(fileURLToPath(import.meta.url));
// scripts/ sits next to dist/ in both a dev clone and a published install.
const packageRoot = join(scriptDir, '..');
const mainJs = join(packageRoot, 'dist', 'web', 'main.js');

function fail(message) {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

function info(message) {
  console.log(`  ${message}`);
}

if (!existsSync(mainJs)) {
  fail(
    `Built player not found at:\n      ${mainJs}\n` +
      `    Build it first, then re-run this:\n      pnpm build`,
  );
}

const nodePath = process.execPath;

/** Best-effort: warn (don't block) if Navidrome isn't configured yet, since a
 *  freshly launched-but-unconfigured player just logs and exits silently. */
async function warnIfUnconfigured() {
  try {
    const { getSettingsStorePath } = await import(
      pathToFileURL(join(packageRoot, 'dist', 'config', 'store-path.js')).href
    );
    const storePath = getSettingsStorePath();
    let configured = false;
    if (existsSync(storePath)) {
      try {
        const store = JSON.parse(readFileSync(storePath, 'utf8'));
        const url = store?.navidrome?.url;
        configured = typeof url === 'string' && url.trim() !== '' && !url.includes('your-server');
      } catch {
        /* unreadable / malformed store — treat as unconfigured */
      }
    }
    if (!configured) {
      info('');
      info('⚠  Navidrome is not configured yet — the shortcut will start but exit');
      info('   immediately until you set your server URL/credentials. Run:');
      info(process.platform === 'win32' ? '       navidrome-config' : '       npx navidrome-config');
      info(`   (or: node "${join(packageRoot, 'dist', 'config-app', 'main.js')}")`);
    }
  } catch {
    /* store-path module missing (shouldn't happen post-build) — skip the check */
  }
}

/** Resolve a Desktop directory, falling back to the home dir if none exists. */
function desktopDir() {
  const candidate = join(homedir(), 'Desktop');
  return existsSync(candidate) ? candidate : homedir();
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

// ── Linux: XDG .desktop entry ───────────────────────────────────────────────
function makeLinux() {
  const content = [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    `Name=${APP_NAME}`,
    'GenericName=Music Player',
    'Comment=Standalone Navidrome web player (controls local mpv)',
    // Quote both paths so spaces in either survive the Exec parser.
    `Exec="${nodePath}" "${mainJs}"`,
    'Icon=multimedia-player',
    'Terminal=false',
    'Categories=AudioVideo;Audio;Player;',
    'StartupNotify=false',
    '',
  ].join('\n');

  const written = [];
  const fileName = 'navidrome-player.desktop';

  // 1) App menu (so it shows in the launcher / activities search).
  const appsDir = join(homedir(), '.local', 'share', 'applications');
  ensureDir(appsDir);
  const appsFile = join(appsDir, fileName);
  writeFileSync(appsFile, content, { mode: 0o755 });
  written.push(appsFile);

  // 2) Desktop (so there's a clickable icon). GNOME also needs it marked
  //    trusted before it'll launch instead of opening as text.
  const deskFile = join(desktopDir(), fileName);
  writeFileSync(deskFile, content, { mode: 0o755 });
  written.push(deskFile);

  // Best-effort GNOME "trusted" flag + menu cache refresh; harmless elsewhere.
  spawnSync('gio', ['set', deskFile, 'metadata::trusted', 'true'], { stdio: 'ignore' });
  chmodSync(deskFile, 0o755);
  spawnSync('update-desktop-database', [appsDir], { stdio: 'ignore' });

  return written;
}

// ── macOS: minimal .app bundle ──────────────────────────────────────────────
function makeMac() {
  const appDir = join(desktopDir(), `${APP_NAME}.app`);
  const macosDir = join(appDir, 'Contents', 'MacOS');
  ensureDir(macosDir);

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
    '  <string>com.navidrome.mcp.webplayer</string>',
    '  <key>CFBundleVersion</key>',
    '  <string>1.0</string>',
    '  <key>CFBundlePackageType</key>',
    '  <string>APPL</string>',
    '  <key>CFBundleExecutable</key>',
    '  <string>launcher</string>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
  writeFileSync(join(appDir, 'Contents', 'Info.plist'), plist);

  // The bundle's executable is the long-running player itself: the .app stays
  // "running" (dock icon) until the player exits, and Cmd-Q sends SIGTERM, which
  // main.ts handles as a clean shutdown. No Terminal window is ever shown.
  const launcher = ['#!/bin/bash', `exec "${nodePath}" "${mainJs}"`, ''].join('\n');
  const launcherPath = join(macosDir, 'launcher');
  writeFileSync(launcherPath, launcher, { mode: 0o755 });
  chmodSync(launcherPath, 0o755);

  return [appDir];
}

// ── Windows: hidden-window .vbs ─────────────────────────────────────────────
function makeWindows() {
  // The runtime command line is: "<node>" "<mainJs>". In a VBS string literal,
  // every " is doubled, and the whole literal is wrapped in ". WScript.Shell.Run
  // with intWindowStyle=0 starts it hidden; bWaitOnReturn=False fires and forgets.
  const vbsArg = `"""${nodePath}"" ""${mainJs}"""`;
  const content = [
    "' Navidrome Player — launches the standalone web player with no console window.",
    "' Generated by make-launcher; re-run the generator to refresh the baked-in paths.",
    'Set sh = CreateObject("WScript.Shell")',
    `sh.Run ${vbsArg}, 0, False`,
    '',
  ].join('\r\n');

  const written = [];
  const fileName = `${APP_NAME}.vbs`;

  const deskFile = join(desktopDir(), fileName);
  writeFileSync(deskFile, content);
  written.push(deskFile);

  // Start Menu → Programs, so it shows in the Start search.
  const appData = process.env['APPDATA'];
  if (appData && appData.trim() !== '') {
    const startMenu = join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    try {
      ensureDir(startMenu);
      const startFile = join(startMenu, fileName);
      writeFileSync(startFile, content);
      written.push(startFile);
    } catch {
      /* Start Menu may be locked down; the Desktop copy is enough */
    }
  }

  return written;
}

async function main() {
  console.log(`\n  Creating a "${APP_NAME}" shortcut for this machine…\n`);
  info(`node:    ${nodePath}`);
  info(`player:  ${mainJs}`);

  let written;
  switch (process.platform) {
    case 'linux':
      written = makeLinux();
      break;
    case 'darwin':
      written = makeMac();
      break;
    case 'win32':
      written = makeWindows();
      break;
    default:
      fail(`Unsupported platform: ${process.platform}. Run the player with: node "${mainJs}"`);
  }

  console.log('\n  ✓ Created:');
  for (const p of written) info(`• ${p}`);

  await warnIfUnconfigured();

  console.log('\n  Double-click it to start the player — your browser opens to the UI.');
  console.log('  Use the power button in the player to stop it.\n');
}

main().catch((err) => fail(String(err)));
