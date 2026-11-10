#!/usr/bin/env node
/**
 * Navidrome MCP Server - navidrome-mcp bin
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { runCli } from './cli/dispatch.js';

const exitCode = await runCli(process.argv.slice(2), {
  stdinIsTTY: () => process.stdin.isTTY,
  stdout: (text) => { process.stdout.write(text); },
  stderr: (text) => { process.stderr.write(text); },
});
if (exitCode !== 0) process.exitCode = exitCode;
