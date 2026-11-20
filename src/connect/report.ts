/**
 * Navidrome MCP Server - Output text for `navidrome-mcp connect`
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { ABSOLUTE_FLAG, REINSTALL_HINT } from '../cli/texts.js';
import { SERVER_NAME, type McpServerEntry, type MergeResult } from './claude-desktop.js';

/** Quotes whitespace, quote marks, ^ & | < > ( ) and the backslash for a line pasted into PowerShell, cmd or Git Bash, so the common line stays bare. A backslash is quoted because Git Bash drops it unquoted. */
function shellQuote(text: string): string {
  return /[\s"'&|<>()^\\]/.test(text) ? `"${text.replaceAll('"', '\\"')}"` : text;
}

export function claudeCodeCommand(entry: McpServerEntry): string {
  return `claude mcp add ${SERVER_NAME} -- ${[entry.command, ...entry.args].map(shellQuote).join(' ')}`;
}

function claudeCodeLines(entry: McpServerEntry, platform: NodeJS.Platform): string[] {
  const command = claudeCodeCommand(entry);
  if (platform !== 'win32' || !entry.args.some((arg) => arg.startsWith('/'))) {
    return ['For Claude Code, run this line.', command];
  }
  return [
    'For Claude Code in PowerShell or cmd, run this line.',
    command,
    '',
    'For Claude Code in Git Bash, run this line.',
    // MSYS rewrites a bare /c to C:/ even when quoted, so Git Bash needs its path conversion off.
    `MSYS_NO_PATHCONV=1 ${command}`,
  ];
}

export function buildConnectReport(result: MergeResult, entry: McpServerEntry, absolute: boolean, platform: NodeJS.Platform): string {
  const lines: string[] = [];
  const json = JSON.stringify({ mcpServers: { [SERVER_NAME]: entry } }, null, 2);

  if (result.unchanged) {
    lines.push(`Claude Desktop already has this ${SERVER_NAME} entry, so ${result.configPath} is unchanged.`);
  } else {
    lines.push(`${result.replaced ? 'Replaced the existing' : 'Added the'} ${SERVER_NAME} entry in ${result.configPath}`);
    if (result.backupPath !== null) lines.push(`The old file is saved as ${result.backupPath}`);
  }
  if (absolute) {
    lines.push(
      `${ABSOLUTE_FLAG} pins this install. If it is a global install, update it with npm update -g navidrome-mcp.`,
      `Run navidrome-mcp connect ${ABSOLUTE_FLAG} again ${REINSTALL_HINT}`,
    );
  }
  lines.push(
    '',
    'Quit Claude Desktop fully and open it again.',
    '',
    ...claudeCodeLines(entry, platform),
    '',
    'Other MCP clients take this JSON.',
    json,
  );
  return `${lines.map((line) => (line === '' ? line : `  ${line.replaceAll('\n', '\n  ')}`)).join('\n')}\n`;
}
