/**
 * Navidrome MCP Server - Subcommand dispatch for the navidrome-mcp bin
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { getSettingsStorePath } from '../config/store-path.js';
import { jukeboxLogPath } from '../web/log-path.js';
import { REINSTALL_HINT, STOP_HINT } from './texts.js';

export interface CliIo {
  /** Read lazily, so a run that names a command never touches process.stdin. */
  stdinIsTTY: () => boolean;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

type CommandAction = { kind: 'help' } | { kind: 'load'; load: () => Promise<unknown> };

interface CliCommand {
  name: string;
  aliases: readonly string[];
  description: readonly string[];
  action: CommandAction;
}

// Each target runs its own main() on import, so help loads none of them.
const loadMcpServer = (): Promise<unknown> => import('../mcp-server.js');

/** The row for a run with no argument. Which action it takes depends on stdin. */
const DEFAULT_DESCRIPTION = ['MCP server. Your MCP client starts it.'];

/** Table order is help order. */
export const COMMANDS: readonly CliCommand[] = [
  {
    name: 'serve',
    aliases: [],
    description: ['Start the MCP server from a terminal, such as for the HTTP transport.'],
    action: { kind: 'load', load: loadMcpServer },
  },
  {
    name: 'jukebox',
    aliases: [],
    description: [
      'Start the Jukebox Remote and open it in your browser.',
      'Started here, it keeps running after your AI client closes.',
      STOP_HINT,
    ],
    action: { kind: 'load', load: () => import('../web/main.js') },
  },
  {
    name: 'settings',
    aliases: [],
    description: ['Open the settings page.'],
    action: { kind: 'load', load: () => import('../config-app/main.js') },
  },
  {
    name: 'shortcut',
    aliases: [],
    description: [
      'Create a Jukebox Remote desktop shortcut.',
      `Run it again ${REINSTALL_HINT}`,
    ],
    action: { kind: 'load', load: () => import('../shortcut/main.js') },
  },
  {
    name: 'help',
    aliases: ['--help', '-h'],
    description: ['Show this help.'],
    action: { kind: 'help' },
  },
];

const BIN_NAME = 'navidrome-mcp';
const COLUMN_GAP = 3;

/** Reads the two paths on each call, since NAVIDROME_CONFIG_PATH can change them. */
export function buildHelpText(): string {
  const rows = [
    { usage: BIN_NAME, description: DEFAULT_DESCRIPTION },
    ...COMMANDS.map((command) => ({ usage: `${BIN_NAME} ${command.name}`, description: command.description })),
  ];
  const usageWidth = Math.max(...rows.map((row) => row.usage.length)) + COLUMN_GAP;
  const lines: string[] = [];
  for (const row of rows) {
    row.description.forEach((text, index) => {
      lines.push((index === 0 ? row.usage : '').padEnd(usageWidth) + text);
    });
  }
  lines.push('', `Settings file: ${getSettingsStorePath()}`, `Jukebox Remote log: ${jukeboxLogPath()}`);
  return `${lines.join('\n')}\n`;
}

/**
 * No argument is the stdio server a client launches, unless a person typed it at a terminal.
 * Returns the exit code, which is 1 for an unknown command.
 */
export async function runCli(args: readonly string[], io: CliIo): Promise<number> {
  const requested = args.at(0);

  if (requested === undefined) {
    if (io.stdinIsTTY()) {
      io.stdout(buildHelpText());
      return 0;
    }
    await loadMcpServer();
    return 0;
  }

  const command = COMMANDS.find((candidate) => candidate.name === requested || candidate.aliases.includes(requested));
  if (command === undefined) {
    io.stderr(`Unknown command: ${requested}\n\n${buildHelpText()}`);
    return 1;
  }

  if (command.action.kind === 'help') {
    io.stdout(buildHelpText());
    return 0;
  }
  await command.action.load();
  return 0;
}
