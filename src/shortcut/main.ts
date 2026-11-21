/**
 * Navidrome MCP Server - Jukebox Remote desktop shortcut command (`navidrome-mcp shortcut`)
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { GNOME_ALLOW_LAUNCH_HINT, REINSTALL_HINT } from '../cli/texts.js';
import { errorMessage } from '../utils/error-formatter.js';
import { assertPlayerBuilt, createJukeboxShortcut } from './create.js';
import type { OldShortcutReport } from './old-cleanup.js';
import { APP_NAME, PACKAGE_INDEX_JS, PLAYER_MAIN_JS } from './paths.js';

function say(message: string): void {
  process.stdout.write(`${message}\n`);
}

function info(message: string): void {
  say(`  ${message}`);
}

function printUnconfiguredWarning(): void {
  info('');
  info('Warning: Navidrome is not configured yet. The first launch opens the settings page.');
  info('The Jukebox Remote starts after you Save there. Or configure it now:');
  info('    navidrome-mcp settings');
  info(`(or: node "${PACKAGE_INDEX_JS}" settings)`);
}

function printOldCleanup(report: OldShortcutReport): void {
  if (report.removed.length > 0) {
    say('\n  Removed old Navidrome Player shortcut files:');
    for (const path of report.removed) info(`• ${path}`);
  }
  if (report.kept.length > 0) {
    say('\n  Left in place:');
    for (const { path, reason } of report.kept) info(`• ${path} (${reason})`);
  }
}

async function main(): Promise<void> {
  // Before the header, so a missing build prints only the error.
  assertPlayerBuilt();
  say(`\n  Creating a "${APP_NAME}" shortcut for this machine...\n`);
  info(`node:    ${process.execPath}`);
  info(`player:  ${PLAYER_MAIN_JS}`);

  const result = await createJukeboxShortcut();
  say('\n  Created:');
  for (const path of result.written) info(`• ${path}`);
  if (result.runner !== null) info(`• ${result.runner} (runner)`);

  printOldCleanup(result.oldCleanup);
  if (result.unconfigured) printUnconfiguredWarning();

  say(`\n  Double-click it to start the ${APP_NAME}. Your browser opens to it.`);
  say('  Click Shut down player in the gear menu to stop it.');
  say(`  Run navidrome-mcp shortcut again ${REINSTALL_HINT}`);
  if (process.platform === 'linux') {
    say(`  ${GNOME_ALLOW_LAUNCH_HINT}`);
  }
  say('');
}

try {
  await main();
} catch (err) {
  process.stderr.write(`\n  Could not create the shortcut: ${errorMessage(err)}\n\n`);
  process.exit(1);
}
