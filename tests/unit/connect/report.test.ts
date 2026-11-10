/**
 * Navidrome MCP Server - `navidrome-mcp connect` report tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';

import type { McpServerEntry, MergeResult } from '../../../src/connect/claude-desktop.js';
import { buildConnectReport, claudeCodeCommand } from '../../../src/connect/report.js';

const ENTRY: McpServerEntry = { command: 'npx', args: ['navidrome-mcp'] };
const ADDED: MergeResult = { configPath: '/c/config.json', backupPath: '/c/config.json.bak', replaced: false, unchanged: false };

describe('claudeCodeCommand', () => {
  it('prints the npx entry bare', () => {
    expect(claudeCodeCommand(ENTRY)).toBe('claude mcp add navidrome -- npx navidrome-mcp');
  });

  it('prints the Windows entry', () => {
    expect(claudeCodeCommand({ command: 'cmd', args: ['/c', 'npx', 'navidrome-mcp'] })).toBe(
      'claude mcp add navidrome -- cmd /c npx navidrome-mcp',
    );
  });

  it('quotes a path that holds a space', () => {
    expect(claudeCodeCommand({ command: 'C:\\Program Files\\nodejs\\node.exe', args: ['C:\\pkg\\dist\\index.js'] })).toBe(
      'claude mcp add navidrome -- "C:\\Program Files\\nodejs\\node.exe" "C:\\pkg\\dist\\index.js"',
    );
  });

  it('quotes a backslash path with no space so Git Bash keeps the backslashes', () => {
    expect(claudeCodeCommand({ command: 'C:\\nvm4w\\nodejs\\node.exe', args: ['E:\\pkg\\dist\\index.js'] })).toBe(
      'claude mcp add navidrome -- "C:\\nvm4w\\nodejs\\node.exe" "E:\\pkg\\dist\\index.js"',
    );
  });
});

describe('buildConnectReport', () => {
  it('names the file, the backup, the restart step, the Claude Code line and the JSON in order', () => {
    const report = buildConnectReport(ADDED, ENTRY, false);

    const order = [
      'Added the navidrome entry in /c/config.json',
      'The old file is saved as /c/config.json.bak',
      'Quit Claude Desktop fully and open it again.',
      'claude mcp add navidrome -- npx navidrome-mcp',
      '"mcpServers"',
    ].map((text) => report.indexOf(text));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(report).not.toContain('--absolute');
  });

  it('says a replaced entry was replaced', () => {
    expect(buildConnectReport({ ...ADDED, replaced: true }, ENTRY, false)).toContain(
      'Replaced the existing navidrome entry in /c/config.json',
    );
  });

  it('says an identical entry left the file unchanged and names no backup', () => {
    const unchanged: MergeResult = { configPath: '/c/config.json', backupPath: null, replaced: true, unchanged: true };

    const report = buildConnectReport(unchanged, ENTRY, false);

    expect(report).toContain('already has this navidrome entry, so /c/config.json is unchanged.');
    expect(report).not.toContain('saved as');
  });

  it('omits the backup line for a new file', () => {
    expect(buildConnectReport({ ...ADDED, backupPath: null }, ENTRY, false)).not.toContain('saved as');
  });

  it('says --absolute pins the install and how to update', () => {
    const report = buildConnectReport(ADDED, { command: '/usr/bin/node', args: ['/pkg/dist/index.js'] }, true);

    expect(report).toContain('--absolute pins this install.');
    expect(report).toContain('If it is a global install, update it with npm update -g navidrome-mcp.');
    expect(report).toContain('navidrome-mcp connect --absolute again after you move or reinstall navidrome-mcp.');
    expect(report).toContain('claude mcp add navidrome -- /usr/bin/node /pkg/dist/index.js');
  });
});
