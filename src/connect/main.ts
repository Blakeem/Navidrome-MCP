/**
 * Navidrome MCP Server - Claude Desktop connect command (`navidrome-mcp connect`)
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

import { ABSOLUTE_FLAG } from '../cli/texts.js';
import { PACKAGE_INDEX_JS } from '../shortcut/paths.js';
import { errorMessage } from '../utils/error-formatter.js';
import { buildServerEntry, claudeDesktopConfigPath, mergeServerEntry } from './claude-desktop.js';
import { buildConnectReport } from './report.js';

// argv is node, the bin, the command name, then the options.
const OPTION_ARGS_START = 3;

function parseAbsoluteFlag(args: readonly string[]): boolean {
  const unknown = args.find((arg) => arg !== ABSOLUTE_FLAG);
  if (unknown !== undefined) {
    throw new Error(`Unknown option: ${unknown}. The only option is ${ABSOLUTE_FLAG}.`);
  }
  return args.includes(ABSOLUTE_FLAG);
}

function main(): void {
  const absolute = parseAbsoluteFlag(process.argv.slice(OPTION_ARGS_START));
  if (absolute && !existsSync(PACKAGE_INDEX_JS)) {
    throw new Error(`Built server not found at ${PACKAGE_INDEX_JS}. Build it first with: pnpm build`);
  }

  const entry = buildServerEntry({
    absolute,
    platform: process.platform,
    nodePath: process.execPath,
    indexJsPath: PACKAGE_INDEX_JS,
  });
  const configPath = claudeDesktopConfigPath({ platform: process.platform, env: process.env, home: homedir() });
  const result = mergeServerEntry(configPath, entry);
  process.stdout.write(`\n${buildConnectReport(result, entry, absolute)}\n`);
}

try {
  main();
} catch (err) {
  process.stderr.write(`\n  Could not connect Claude Desktop: ${errorMessage(err)}\n\n`);
  process.exit(1);
}
