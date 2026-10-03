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
import { accessSync, constants } from 'node:fs';
import { logger } from '../../utils/logger.js';

/**
 * Default IPC socket / named pipe path for the engine.
 *
 * Path is scoped to the user (uid on POSIX, username on Windows) rather than
 * the process PID, so that:
 *   - A fresh MCP server started after a restart can attach to the existing
 *     mpv instance and resume control without interrupting playback.
 *   - Multiple users on the same host don't collide on a shared path.
 *
 * Multiple MCP servers for the same user will share the same mpv — which is
 * the right behavior, since otherwise the AIs would fight over audio output.
 *
 * On POSIX we prefer `XDG_RUNTIME_DIR` (typically `/run/user/<uid>`, mode 0700
 * per the XDG spec) so a sibling user on a shared host cannot connect to the
 * socket and drive mpv. mpv's IPC has no auth — possession of the socket is
 * full control. We fall back to `/tmp/...` only when XDG_RUNTIME_DIR is unset
 * or blank (e.g. headless / non-systemd Linux, some BSDs); on a single-user
 * machine that's the same blast radius the project always had.
 */
export function getDefaultIpcPath(): string {
  if (process.platform === 'win32') {
    const user = (process.env['USERNAME'] ?? 'default').replace(/[^A-Za-z0-9_-]/g, '_');
    return `\\\\.\\pipe\\navidrome-mcp-mpv-${user}`;
  }
  // POSIX: prefer numeric uid for stability; fall back to USER env if unavailable
  const uidFn = (process as unknown as { getuid?: () => number }).getuid;
  // The numeric getuid() path is inherently safe; the USER env fallback is
  // attacker-influenceable and gets interpolated into filesystem paths below,
  // so scrub it to the same character set as the Windows USERNAME branch.
  const uid =
    typeof uidFn === 'function'
      ? uidFn()
      : (process.env['USER'] ?? 'default').replace(/[^A-Za-z0-9_-]/g, '_');

  const xdgRuntime = process.env['XDG_RUNTIME_DIR'];
  if (xdgRuntime !== undefined && xdgRuntime.trim() !== '') {
    // XDG dirs are conventionally mode 0700 — sufficient isolation that we
    // don't need a username/uid suffix in the filename, but we keep it for
    // parity with the /tmp path so a misconfigured system that points
    // XDG_RUNTIME_DIR at a shared dir still doesn't collide between users.
    return `${xdgRuntime.replace(/\/+$/, '')}/navidrome-mcp-mpv-${uid}.sock`;
  }
  return `/tmp/navidrome-mcp-mpv-${uid}.sock`;
}

/** Find mpv on PATH with `command -v` (POSIX) or `where` (Windows), returning null when none is found. */
export function detectMpvBinary(): string | null {
  // PATH lookup
  try {
    const cmd = process.platform === 'win32' ? 'where mpv' : 'command -v mpv';
    const stdout = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const firstLine = stdout.split(/\r?\n/).map(s => s.trim()).find(s => s !== '');
    if (firstLine !== undefined && firstLine !== '' && isExecutable(firstLine)) {
      return firstLine;
    }
  } catch {
    // command not found — fall through
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
 * Check whether a path exists and is executable. On Windows the `X_OK`
 * permission bit is not enforced, but `accessSync(F_OK)` is sufficient.
 */
function isExecutable(path: string): boolean {
  try {
    const mode = process.platform === 'win32' ? constants.F_OK : constants.X_OK;
    accessSync(path, mode);
    return true;
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
    // Network cache. mpv defaults (--cache-secs=1.0, --demuxer-readahead-secs=1.0)
    // are tuned for local files; on a streamed HTTP source they leave a ~1s budget
    // that any network jitter at track-change time blows through, causing the
    // decoder to underrun and stop after a second of playback. Audio bitrates
    // are tiny (30s of FLAC ≈ 6MB, MP3 ≈ 1.2MB), so a generous prebuffer is free.
    '--cache=yes',
    '--cache-secs=30',
    '--demuxer-readahead-secs=20',
    `--input-ipc-server=${ipcPath}`,
    '--volume=80',
    '--audio-display=no',
    '--ytdl=no',
    '--vo=null',
    '--msg-level=all=info',
  ];
}

/**
 * Spawn an mpv child process using the standardized launch flags.
 *
 * stdout and stderr are piped and forwarded to `logger.debug()` line-by-line
 * so they never pollute the MCP stdio channel.
 *
 * Returns the {@link ChildProcess} handle. The caller owns the lifecycle.
 */
export function spawnMpv(binaryPath: string, ipcPath: string): ChildProcess {
  const args = buildMpvArgs(ipcPath);

  logger.debug(`Spawning mpv: ${binaryPath} ${args.join(' ')}`);

  // detached: true puts mpv in its own process group / detached session, so a
  // SIGINT to the MCP server does not propagate to mpv; combined with
  // child.unref() this lets mpv outlive the parent and keep playing across
  // MCP restarts. windowsHide: true prevents a stray console window flashing
  // on Windows — mpv runs headless via --no-terminal regardless.
  const child = spawn(binaryPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    windowsHide: true,
  });
  child.unref();

  attachLineLogger(child.stdout, 'mpv:stdout');
  attachLineLogger(child.stderr, 'mpv:stderr');

  // Unref the piped debug-log streams. child.unref() above only unrefs the
  // ChildProcess handle; the stdout/stderr pipes are separate libuv handles
  // that a 'data' listener puts into flowing/ref'd mode, which would hold the
  // event loop open at shutdown. Data still flows to the attached listeners
  // while the loop stays alive for other reasons (the MCP stdin hold), so
  // debug logging is intact.
  // The piped streams are libuv pipe handles that expose unref() at runtime,
  // but the ChildProcess types only surface them as Readable — narrow to the
  // unref-bearing shape.
  (child.stdout as { unref?: () => void }).unref?.();
  (child.stderr as { unref?: () => void }).unref?.();

  child.on('exit', (code, signal) => {
    logger.debug(`mpv process exited code=${code ?? 'null'} signal=${signal ?? 'null'}`);
  });

  child.on('error', (err) => {
    logger.error('mpv process error:', err.message);
  });

  return child;
}

/**
 * Hard cap for partial-line buffering on mpv stdio streams. mpv usually emits
 * short well-formed status lines, but a stuck DNS lookup or pathological
 * filename could spew a single very long line; without a cap the buffer
 * grows unbounded for the lifetime of the process. 64KB easily covers any
 * legitimate single-line metadata payload while bounding the worst case.
 */
const MAX_LINE_BUFFER_BYTES = 64 * 1024;

/**
 * Forward each line emitted on a mpv stream to logger.debug under the given
 * prefix. Buffers partial lines across chunks, with a 64KB cap to prevent
 * unbounded growth on streams that never emit a newline.
 */
function attachLineLogger(stream: NodeJS.ReadableStream | null, prefix: string): void {
  if (stream === null) return;

  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      if (line !== '') {
        logger.debug(`[${prefix}] ${line}`);
      }
    }
    // Cap residual partial line. We've already drained every complete line,
    // so anything left is a no-newline tail — drop it on overflow with a
    // single warn so the issue surfaces in logs but the process doesn't OOM.
    if (buffer.length > MAX_LINE_BUFFER_BYTES) {
      logger.warn(`[${prefix}] line truncated at ${MAX_LINE_BUFFER_BYTES} bytes; dropping buffer`);
      buffer = '';
    }
  });
  stream.on('end', () => {
    if (buffer !== '') {
      logger.debug(`[${prefix}] ${buffer}`);
      buffer = '';
    }
  });
  // mpv is an external subprocess; a pipe read error (EPIPE/ECONNRESET/EIO,
  // more plausible on the Windows named-pipe path) emitted with no 'error'
  // listener would throw and crash the MCP server. Mirror the socket 'error'
  // guard in mpv-ipc.ts.
  stream.on('error', (err: Error) => {
    logger.error(`[${prefix}] stream error:`, err.message);
  });
}
