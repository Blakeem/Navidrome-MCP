/**
 * Navidrome MCP Server - Claude Desktop config file writer for `navidrome-mcp connect`
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { copyFileSync, existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { nonEmpty } from '../config/non-empty.js';
import { isJsonObject, type JsonObject } from '../config/settings-file-checks.js';
import { writePrivateFileAtomic } from '../config/store.js';
import { errorMessage } from '../utils/error-formatter.js';

export const SERVER_NAME = 'navidrome';

const CONFIG_FILE_NAME = 'claude_desktop_config.json';
const BACKUP_SUFFIX = '.bak';
const STORE_PACKAGE_PREFIX = 'Claude_';
const BOM = '\uFEFF';

export interface McpServerEntry {
  command: string;
  args: string[];
}

interface EntryOptions {
  absolute: boolean;
  platform: NodeJS.Platform;
  nodePath: string;
  indexJsPath: string;
}

interface ConfigPathOptions {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
}

export interface MergeResult {
  configPath: string;
  /** Null when the file did not exist or was left untouched. */
  backupPath: string | null;
  replaced: boolean;
  /** True when the file already held this command and args, so nothing was written. */
  unchanged: boolean;
}

export function buildServerEntry(options: EntryOptions): McpServerEntry {
  if (options.absolute) {
    return { command: options.nodePath, args: [options.indexJsPath] };
  }
  if (options.platform === 'win32') {
    return { command: 'cmd', args: ['/c', 'npx', 'navidrome-mcp'] };
  }
  return { command: 'npx', args: ['navidrome-mcp'] };
}

interface DefaultPaths {
  storeCandidates: string[];
  defaultPath: string;
}

function windowsPaths(env: NodeJS.ProcessEnv, home: string): DefaultPaths {
  const localAppData = nonEmpty(env['LOCALAPPDATA']) ?? join(home, 'AppData', 'Local');
  const roaming = nonEmpty(env['APPDATA']) ?? join(home, 'AppData', 'Roaming');
  return {
    storeCandidates: listStorePackages(join(localAppData, 'Packages')).map((packageDir) =>
      join(packageDir, 'LocalCache', 'Roaming', 'Claude', CONFIG_FILE_NAME),
    ),
    defaultPath: join(roaming, 'Claude', CONFIG_FILE_NAME),
  };
}

function unixPaths(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): DefaultPaths {
  const configHome = nonEmpty(env['XDG_CONFIG_HOME']) ?? join(home, '.config');
  const defaultPath =
    platform === 'darwin'
      ? join(home, 'Library', 'Application Support', 'Claude', CONFIG_FILE_NAME)
      : join(configHome, 'Claude', CONFIG_FILE_NAME);
  return { storeCandidates: [], defaultPath };
}

/** On Windows the Microsoft Store build of Claude Desktop keeps its config under its package folder, so those paths come first. */
export function claudeDesktopConfigPath(options: ConfigPathOptions): string {
  const { platform, env, home } = options;
  const { storeCandidates, defaultPath } =
    platform === 'win32' ? windowsPaths(env, home) : unixPaths(platform, env, home);

  const existing = [...storeCandidates, defaultPath].find((candidate) => existsSync(candidate));
  return existing ?? storeCandidates[0] ?? defaultPath;
}

function listStorePackages(packagesDir: string): string[] {
  try {
    return readdirSync(packagesDir)
      .filter((name) => name.startsWith(STORE_PACKAGE_PREFIX))
      .sort()
      .map((name) => join(packagesDir, name));
  } catch {
    return [];
  }
}

function readConfigObject(configPath: string): JsonObject {
  const raw = readFileSync(configPath, 'utf8');
  const text = raw.startsWith(BOM) ? raw.slice(1) : raw;
  if (text.trim() === '') return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `${configPath} is not valid JSON (${errorMessage(err)}). Nothing was changed. Fix the file or move it aside, then run navidrome-mcp connect again.`,
    );
  }
  if (!isJsonObject(parsed)) {
    throw new Error(
      `${configPath} must hold a JSON object at the top level. Nothing was changed. Fix the file or move it aside, then run navidrome-mcp connect again.`,
    );
  }
  return parsed;
}

function readServers(configPath: string, config: JsonObject): JsonObject {
  const servers = config['mcpServers'];
  if (servers === undefined) return {};
  if (!isJsonObject(servers)) {
    throw new Error(
      `The "mcpServers" key in ${configPath} must be a JSON object. Nothing was changed. Fix the key or move the file aside, then run navidrome-mcp connect again.`,
    );
  }
  return servers;
}

/** The file a write must land on. A symlinked config keeps its link, since the atomic write renames over the path it is given. */
function writeTarget(configPath: string): string {
  return lstatSync(configPath).isSymbolicLink() ? realpathSync(configPath) : configPath;
}

function sameLaunch(stored: unknown, entry: McpServerEntry): boolean {
  return (
    isJsonObject(stored) &&
    stored['command'] === entry.command &&
    JSON.stringify(stored['args']) === JSON.stringify(entry.args)
  );
}

/**
 * Adds or replaces `mcpServers.navidrome` and keeps every other key, including the other keys of a stored
 * navidrome entry such as `env`. The old file is copied to `.bak` first.
 */
export function mergeServerEntry(configPath: string, entry: McpServerEntry): MergeResult {
  const fileExists = existsSync(configPath);
  const targetPath = fileExists ? writeTarget(configPath) : configPath;
  const config = fileExists ? readConfigObject(targetPath) : {};
  const servers = readServers(targetPath, config);
  const replaced = Object.hasOwn(servers, SERVER_NAME);
  const storedEntry = servers[SERVER_NAME];
  const storedKeys = isJsonObject(storedEntry) ? storedEntry : {};
  const merged = {
    ...config,
    mcpServers: { ...servers, [SERVER_NAME]: { ...storedKeys, command: entry.command, args: entry.args } },
  };
  let backupPath: string | null = null;

  // A rerun that changes nothing must not overwrite the .bak, which then holds the file as the person had it.
  if (sameLaunch(storedEntry, entry)) {
    return { configPath, backupPath, replaced, unchanged: true };
  }

  if (fileExists) {
    backupPath = `${targetPath}${BACKUP_SUFFIX}`;
    copyFileSync(targetPath, backupPath);
  }
  writePrivateFileAtomic(targetPath, `${JSON.stringify(merged, null, 2)}\n`);
  return { configPath, backupPath, replaced, unchanged: false };
}
