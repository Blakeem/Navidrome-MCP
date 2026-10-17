#!/usr/bin/env node
/**
 * Navidrome MCP Server - Desktop launcher generator for the standalone web player
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// The launcher bakes in absolute node and dist/web/main.js paths, so neither resolves through PATH.
// Plain ESM JS, because it ships as a published bin that runs with no build step or dependencies.

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP_NAME = 'Navidrome Player';

const scriptDir = dirname(fileURLToPath(import.meta.url));
// scripts/ sits next to dist/ and assets/ in both a dev clone and a published install.
const packageRoot = join(scriptDir, '..');
const mainJs = join(packageRoot, 'dist', 'web', 'main.js');

// A missing icon file falls back to a theme icon on Linux and to no custom icon elsewhere.
const iconPng = join(packageRoot, 'assets', 'navidrome-player.png');
const iconIco = join(packageRoot, 'assets', 'navidrome-player.ico');
const iconIcns = join(packageRoot, 'assets', 'navidrome-player.icns');

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

/** An unconfigured player opens the settings page, so this warns before the first launch. */
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
        /* An unreadable or malformed store counts as unconfigured. */
      }
    }
    if (!configured) {
      info('');
      info('⚠  Navidrome is not configured yet. The first launch opens the settings page.');
      info('   Save there, then launch the shortcut again. Or configure it now:');
      info('       navidrome-config');
      info(`   (or: node "${join(packageRoot, 'dist', 'config-app', 'main.js')}")`);
    }
  } catch {
    /* The check is advisory, so a failed store-path import must not stop the launcher. */
  }
}

// Windows can redirect the Desktop to OneDrive and XDG can localize it, so ~/Desktop is a fallback.
// PowerShell 5.1 writes redirected stdout in the OEM code page, which mangles a non-ASCII path.
const WIN_DESKTOP_QUERY = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; [Environment]::GetFolderPath('Desktop')";
const DESKTOP_QUERIES = {
  win32: { command: 'powershell', args: ['-NoProfile', '-Command', WIN_DESKTOP_QUERY] },
  linux: { command: 'xdg-user-dir', args: ['DESKTOP'] },
};

function queryPlatformDesktop() {
  const query = DESKTOP_QUERIES[process.platform];
  if (query === undefined) return null;
  const res = spawnSync(query.command, query.args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (res.status !== 0 || typeof res.stdout !== 'string') return null;
  const reported = res.stdout.trim();
  // xdg-user-dir reports the home dir when no Desktop is configured.
  if (reported === '' || reported === homedir() || !existsSync(reported)) return null;
  return reported;
}

function desktopDir() {
  const reported = queryPlatformDesktop();
  if (reported !== null) return reported;
  const candidate = join(homedir(), 'Desktop');
  return existsSync(candidate) ? candidate : homedir();
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function makeLinux() {
  const content = [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    `Name=${APP_NAME}`,
    'GenericName=Music Player',
    'Comment=Standalone Navidrome web player (controls local mpv)',
    // The Exec parser splits on spaces, so both paths are quoted.
    `Exec="${nodePath}" "${mainJs}"`,
    `Icon=${existsSync(iconPng) ? iconPng : 'multimedia-player'}`,
    'Terminal=false',
    'Categories=AudioVideo;Audio;Player;',
    'StartupNotify=false',
    '',
  ].join('\n');

  const written = [];
  const fileName = 'navidrome-player.desktop';

  const appsDir = join(homedir(), '.local', 'share', 'applications');
  ensureDir(appsDir);
  const appsFile = join(appsDir, fileName);
  writeFileSync(appsFile, content, { mode: 0o755 });
  written.push(appsFile);

  const deskFile = join(desktopDir(), fileName);
  writeFileSync(deskFile, content, { mode: 0o755 });
  written.push(deskFile);

  // GNOME opens an untrusted Desktop entry as text. Other desktops ignore these best-effort calls.
  spawnSync('gio', ['set', deskFile, 'metadata::trusted', 'true'], { stdio: 'ignore' });
  chmodSync(deskFile, 0o755);
  spawnSync('update-desktop-database', [appsDir], { stdio: 'ignore' });

  return written;
}

function makeMac() {
  const appDir = join(desktopDir(), `${APP_NAME}.app`);
  const macosDir = join(appDir, 'Contents', 'MacOS');
  ensureDir(macosDir);

  // A copied icon keeps the bundle self-contained, so a moved .app keeps its icon.
  const hasIcon = existsSync(iconIcns);
  if (hasIcon) {
    const resourcesDir = join(appDir, 'Contents', 'Resources');
    ensureDir(resourcesDir);
    copyFileSync(iconIcns, join(resourcesDir, 'navidrome-player.icns'));
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
    '  <string>com.navidrome.mcp.webplayer</string>',
    '  <key>CFBundleVersion</key>',
    '  <string>1.0</string>',
    '  <key>CFBundlePackageType</key>',
    '  <string>APPL</string>',
    '  <key>CFBundleExecutable</key>',
    '  <string>launcher</string>',
    ...(hasIcon
      ? ['  <key>CFBundleIconFile</key>', '  <string>navidrome-player.icns</string>']
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
    `exec "${nodePath}" "${mainJs}"`,
    '',
  ].join('\n');
  const launcherPath = join(macosDir, 'launcher');
  writeFileSync(launcherPath, launcher, { mode: 0o755 });
  chmodSync(launcherPath, 0o755);

  return [appDir];
}

function windowsRunnerDir() {
  const base = process.env['LOCALAPPDATA'] ?? process.env['APPDATA'] ?? '';
  const dir = base.trim() !== '' ? join(base, 'navidrome-mcp') : packageRoot;
  ensureDir(dir);
  return dir;
}

function vbsLiteral(value) {
  return `"${value.replace(/"/g, '""')}"`;
}

/** Node has no writer for the binary .lnk format, so a temp .vbs drives WScript.Shell. */
function createWindowsShortcut({ lnkPath, target, args, icon, description }) {
  const lines = [
    'Set sh = CreateObject("WScript.Shell")',
    `Set lnk = sh.CreateShortcut(${vbsLiteral(lnkPath)})`,
    `lnk.TargetPath = ${vbsLiteral(target)}`,
  ];
  if (args) lines.push(`lnk.Arguments = ${vbsLiteral(args)}`);
  if (icon) lines.push(`lnk.IconLocation = ${vbsLiteral(`${icon}, 0`)}`);
  if (description) lines.push(`lnk.Description = ${vbsLiteral(description)}`);
  lines.push('lnk.WindowStyle = 7', 'lnk.Save', '');

  const tmpVbs = join(tmpdir(), `nd-shortcut-${process.pid}.vbs`);
  try {
    writeFileSync(tmpVbs, lines.join('\r\n'));
    // Batch mode (//B) suppresses script errors and prompts, so a failure cannot block on a dialog.
    const res = spawnSync('cscript', ['//nologo', '//B', tmpVbs], { stdio: 'ignore' });
    return res.status === 0 && existsSync(lnkPath);
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

function makeWindows() {
  // Run takes "<node>" "<mainJs>" as one VBS literal, so each inner quote is doubled.
  // Window style 0 hides the console, and False returns without waiting for the player.
  const vbsArg = `"""${nodePath}"" ""${mainJs}"""`;
  const content = [
    "' Navidrome Player. Launches the standalone web player with no console window.",
    "' Generated by make-launcher; re-run the generator to refresh the baked-in paths.",
    'Set sh = CreateObject("WScript.Shell")',
    `sh.Run ${vbsArg}, 0, False`,
    '',
  ].join('\r\n');

  // Only a .lnk carries a custom icon, so the Desktop and Start Menu get shortcuts to one runner.
  const runnerDir = windowsRunnerDir();
  const runnerVbs = join(runnerDir, `${APP_NAME}.vbs`);
  writeFileSync(runnerVbs, content);

  // An icon copy beside the runner keeps IconLocation valid if the package's assets/ dir goes away.
  let iconPath = existsSync(iconIco) ? iconIco : '';
  if (iconPath) {
    try {
      const localIcon = join(runnerDir, 'navidrome-player.ico');
      copyFileSync(iconIco, localIcon);
      iconPath = localIcon;
    } catch {
      /* fall back to referencing the asset in place */
    }
  }

  // Targeting wscript.exe bypasses the .vbs file association, which a locked-down
  // machine may map to an editor.
  const systemRoot = process.env['SystemRoot'] ?? 'C:\\Windows';
  const wscript = join(systemRoot, 'System32', 'wscript.exe');

  const shortcutDirs = [desktopDir()];
  const appData = process.env['APPDATA'];
  if (appData && appData.trim() !== '') {
    shortcutDirs.push(join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  }

  const written = [];
  let anyShortcut = false;
  for (const dir of shortcutDirs) {
    try {
      ensureDir(dir);
    } catch {
      continue;
    }
    const lnkPath = join(dir, `${APP_NAME}.lnk`);
    const ok = createWindowsShortcut({
      lnkPath,
      target: wscript,
      args: `"${runnerVbs}"`,
      icon: iconPath,
      description: 'Standalone Navidrome web player (controls local mpv)',
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
  if (written.length === 0) written.push(runnerVbs);
  else if (anyShortcut) written.push(`${runnerVbs} (runner)`);

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

  console.log('\n  Double-click it to start the player. Your browser opens to the UI.');
  console.log('  Use the power button in the player to stop it.\n');
}

main().catch((err) => fail(String(err)));
