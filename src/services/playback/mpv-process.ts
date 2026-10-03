/**
 * Navidrome MCP Server - mpv Process Management
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

import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { logger } from '../../utils/logger.js';

/**
 * The path is per-user rather than per-PID, so a restarted server re-attaches to the running mpv.
 * XDG_RUNTIME_DIR (mode 0700) is preferred because mpv IPC has no auth.
 */
export function getDefaultIpcPath(): string {
  if (process.platform === 'win32') {
    const user = (process.env['USERNAME'] ?? 'default').replace(/[^A-Za-z0-9_-]/g, '_');
    return `\\\\.\\pipe\\navidrome-mcp-mpv-${user}`;
  }
  // USER is caller-controlled and lands in a filesystem path.
  const userKey = process.getuid?.() ?? (process.env['USER'] ?? 'default').replace(/[^A-Za-z0-9_-]/g, '_');

  const xdgRuntime = process.env['XDG_RUNTIME_DIR'];
  if (xdgRuntime !== undefined && xdgRuntime.trim() !== '') {
    // The user suffix stays so a shared XDG_RUNTIME_DIR still separates users.
    return `${xdgRuntime.replace(/\/+$/, '')}/navidrome-mcp-mpv-${userKey}.sock`;
  }
  return `/tmp/navidrome-mcp-mpv-${userKey}.sock`;
}

/** Find mpv on PATH, returning null when none is found. */
function detectMpvBinary(): string | null {
  if (process.platform === 'win32') {
    return findMpvExeOnPath();
  }

  try {
    const stdout = execSync('command -v mpv', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const firstLine = stdout.split(/\r?\n/).map(s => s.trim()).find(s => s !== '');
    if (firstLine !== undefined && isExecutable(firstLine)) {
      return firstLine;
    }
  } catch {
    // command -v exits non-zero when mpv is not on PATH.
  }

  return null;
}

/**
 * Scans PATH in-process, since `where mpv` lists the mpv.com wrapper first (killing it orphans mpv.exe)
 * and decodes non-ASCII paths in the console code page.
 */
function findMpvExeOnPath(): string | null {
  const pathDirs = (process.env['PATH'] ?? '').split(delimiter);
  for (const rawDir of pathDirs) {
    const dir = rawDir.trim().replace(/^"(.*)"$/, '$1');
    if (dir === '') continue;
    const candidate = join(dir, 'mpv.exe');
    if (isExecutable(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Resolve the mpv binary from the configured value.
 *
 * `explicitPath` is playback.mpvPath, supplied by settings.json or, on the env fallback, by MPV_PATH.
 *   - An explicit path wins. A stale or non-executable path returns `null` (and
 *     warns) so playback is disabled with a clear reason rather than silently
 *     failing on first play.
 *   - `null`/empty means auto-detect through `detectMpvBinary()`.
 */
export function resolveMpvBinary(explicitPath: string | null | undefined): string | null {
  if (explicitPath !== undefined && explicitPath !== null && explicitPath.trim() !== '') {
    const trimmed = explicitPath.trim();
    if (isExecutable(trimmed)) {
      return trimmed;
    }
    logger.warn(`Configured mpv path is not executable, disabling playback: ${trimmed}`);
    return null;
  }
  return detectMpvBinary();
}

/**
 * Windows does not enforce X_OK, so F_OK stands in there.
 * A directory passes accessSync, so the path must also be a regular file.
 */
function isExecutable(path: string): boolean {
  try {
    const mode = process.platform === 'win32' ? constants.F_OK : constants.X_OK;
    accessSync(path, mode);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function buildMpvArgs(ipcPath: string): string[] {
  return [
    '--idle=yes',
    '--no-video',
    '--no-terminal',
    '--no-config',
    '--load-scripts=no',
    '--gapless-audio=weak',
    '--prefetch-playlist=yes',
    // mpv's 1s cache defaults underrun on a streamed source at track change.
    // Audio bitrates make a 30s prebuffer cheap.
    '--cache=yes',
    '--cache-secs=30',
    '--demuxer-readahead-secs=20',
    `--input-ipc-server=${ipcPath}`,
    '--volume=80',
    '--audio-display=no',
    '--ytdl=no',
    '--vo=null',
  ];
}

/**
 * Spawn an mpv child process using the standardized launch flags.
 *
 * Returns the {@link ChildProcess} handle. The caller owns the lifecycle.
 */
export function spawnMpv(binaryPath: string, ipcPath: string): ChildProcess {
  const args = buildMpvArgs(ipcPath);

  logger.debug(`Spawning mpv: ${binaryPath} ${args.join(' ')}`);

  // detached keeps mpv alive across MCP restarts and out of the server's SIGINT.
  // windowsHide stops a console window flashing.
  const child = spawn(binaryPath, args, {
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
  });
  child.unref();

  child.on('exit', (code, signal) => {
    logger.debug(`mpv process exited code=${code ?? 'null'} signal=${signal ?? 'null'}`);
  });

  child.on('error', (err) => {
    logger.error('mpv process error:', err.message);
  });

  return child;
}
