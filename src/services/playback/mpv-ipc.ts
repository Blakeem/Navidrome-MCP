/**
 * Navidrome MCP Server - mpv JSON-IPC Client
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

import { createConnection, type Socket } from 'node:net';
import {
  MPV_COMMAND_TIMEOUT_LOAD_MS,
  MPV_COMMAND_TIMEOUT_QUICK_MS,
  MPV_IPC_CONNECT_DELAY_MS,
  MPV_IPC_CONNECT_RETRIES,
  MPV_LOAD_COMMANDS,
} from '../../constants/timeouts.js';
import { logger } from '../../utils/logger.js';

/**
 * Allowed primitive arg types for mpv command parameters.
 */
type IpcArg = string | number | boolean | null;

/**
 * Generic mpv event payload. Property-change events have additional fields
 * (`id`, `name`, `data`) which callers can read off the index signature.
 */
interface IpcEvent {
  event: string;
  [key: string]: unknown;
}

/**
 * Property-change event from mpv. Emitted after an `observe_property` call.
 */
interface PropertyChangeEvent {
  /** observe_property numeric id */
  id: number;
  /** property name */
  name: string;
  /** current value (any JSON type, including null) */
  data: unknown;
}

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
}

interface IpcResponse {
  request_id?: number;
  error?: string;
  data?: unknown;
}

/**
 * Hard cap for partial-frame buffering on the IPC socket. mpv responses are
 * newline-delimited JSON; most responses fit in a few KB, but `get_property
 * 'playlist'` (and similar queue-scaled reads) serialize the full playlist
 * as a single JSON array on one line — ~400 bytes per entry × queue length.
 * A 583-track stress test landed at ~150–250 KB on a single frame, so the
 * cap has to comfortably exceed that.
 *
 * 16 MB covers ~40,000-track queues at typical entry size — well past any
 * realistic music-server scenario. The buffer is allocation-on-demand
 * (Node string growth) so the only cost of the higher cap is the worst-case
 * RAM ceiling if a frame ever runs away. mpv IPC is a local-only trust
 * boundary (Unix socket / named pipe), so framing DoS is not a real threat;
 * the cap remains as a sanity guard against true corruption.
 */
const MAX_IPC_BUFFER_BYTES = 16 * 1024 * 1024;

/**
 * mpv JSON-IPC client.
 *
 * Wraps a single net socket connection to mpv's `--input-ipc-server` endpoint,
 * handles newline-delimited JSON framing, correlates command requests with
 * responses by `request_id`, and dispatches unsolicited events to listener
 * callbacks.
 *
 * On Linux/macOS the path is a Unix domain socket; on Windows it is a named
 * pipe (`\\.\pipe\...`). Node's `net` module handles both transparently.
 */
export class MpvIpc {
  private socket: Socket | null = null;
  private buffer = '';
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly eventHandlers: Array<(evt: IpcEvent) => void> = [];
  private readonly propertyHandlers: Array<(evt: PropertyChangeEvent) => void> = [];
  private readonly disconnectHandlers: Array<() => void> = [];
  private closed = false;

  /**
   * Connect to mpv's IPC endpoint. Retries with a short backoff because mpv
   * may take a moment to create the socket after spawn.
   *
   * @throws Error if connection cannot be established within the retry budget.
   */
  async connect(
    path: string,
    retries = MPV_IPC_CONNECT_RETRIES,
    delayMs = MPV_IPC_CONNECT_DELAY_MS,
  ): Promise<void> {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        await this.openSocket(path);
        logger.debug(`mpv IPC connected at ${path}`);
        return;
      } catch (err) {
        if (attempt === retries - 1) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`Could not connect to mpv IPC at ${path}: ${message}`);
        }
        await sleep(delayMs);
      }
    }
  }

  /**
   * Send a command to mpv and resolve with its `data` field on success.
   * Rejects on protocol error or disconnect.
   */
  command(...args: IpcArg[]): Promise<unknown> {
    if (this.socket === null || this.closed) {
      return Promise.reject(new Error('mpv IPC socket is not connected'));
    }
    const id = this.nextRequestId++;
    const payload = `${JSON.stringify({ command: args, request_id: id })}\n`;
    const commandName = typeof args[0] === 'string' ? args[0] : String(args[0]);
    const timeoutMs = MPV_LOAD_COMMANDS.has(commandName)
      ? MPV_COMMAND_TIMEOUT_LOAD_MS
      : MPV_COMMAND_TIMEOUT_QUICK_MS;

    return new Promise<unknown>((resolve, reject) => {
      let settled = false;
      let timer: NodeJS.Timeout | null = null;

      const safeResolve = (data: unknown): void => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        this.pending.delete(id);
        resolve(data);
      };
      const safeReject = (err: Error): void => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      };

      this.pending.set(id, { resolve: safeResolve, reject: safeReject });

      // Per-command timeout. On fire we reject this command AND tear down the
      // socket — a stalled mpv will hang every subsequent command too, so the
      // single recovery path is to disconnect and let the next caller's
      // ensureRunning() re-attach.
      timer = setTimeout(() => {
        if (settled) return;
        const err = new Error(
          `mpv command timeout (${timeoutMs}ms): ${commandName}`,
        );
        safeReject(err);
        this.handleUnexpectedDisconnect(err.message);
      }, timeoutMs);
      timer.unref();

      try {
        this.socket?.write(payload, (writeErr) => {
          if (writeErr !== null && writeErr !== undefined) {
            safeReject(writeErr);
          }
        });
      } catch (err) {
        safeReject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Subscribe to mpv property changes. Pair with {@link onPropertyChange} to
   * receive the change events. The `id` must be a positive integer and is
   * used by mpv to tag subsequent change events.
   */
  async observeProperty(id: number, name: string): Promise<void> {
    await this.command('observe_property', id, name);
  }

  /**
   * Register a handler for any non-property-change event (e.g. `start-file`,
   * `end-file`, `playback-restart`).
   */
  onEvent(handler: (evt: IpcEvent) => void): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Register a handler for property-change events. The handler receives the
   * observe id, property name, and current value.
   */
  onPropertyChange(handler: (evt: PropertyChangeEvent) => void): void {
    this.propertyHandlers.push(handler);
  }

  /**
   * Register a handler invoked exactly once when the socket disconnects
   * (whether closed by us or by mpv). Useful for the engine to clear its
   * own references and trigger reconnection logic on the next operation.
   */
  onDisconnect(handler: () => void): void {
    this.disconnectHandlers.push(handler);
  }

  /**
   * Close the IPC socket. Any pending requests are rejected. Idempotent.
   * Disconnect handlers are NOT fired here (they fire only on unexpected
   * disconnects from the peer side); this lets the engine distinguish a
   * deliberate teardown from a hangup it should react to.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.rejectAllPending(new Error('mpv IPC socket closed'));
    try {
      this.socket?.end();
      this.socket?.destroy();
    } catch {
      // ignore; we're tearing down anyway
    }
    this.socket = null;
  }

  /**
   * Whether the socket is currently connected and writable.
   */
  isConnected(): boolean {
    return this.socket !== null && !this.closed;
  }

  // ---------- internals ----------

  private openSocket(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = createConnection({ path });

      const onError = (err: Error): void => {
        sock.removeListener('connect', onConnect);
        sock.destroy();
        reject(err);
      };

      const onConnect = (): void => {
        sock.removeListener('error', onError);
        this.socket = sock;
        sock.setEncoding('utf8');
        sock.on('data', (chunk: string) => this.onData(chunk));
        sock.on('error', (err) => {
          logger.error('mpv IPC socket error:', err.message);
        });
        sock.on('close', () => {
          this.handleUnexpectedDisconnect('mpv IPC socket closed unexpectedly');
        });
        resolve();
      };

      sock.once('connect', onConnect);
      sock.once('error', onError);
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line === '') continue;
      this.handleLine(line);
    }
    // Cap residual partial frame. mpv IPC framing is newline-delimited JSON;
    // anything still in the buffer with no trailing newline is a partial
    // response that's grown larger than any legitimate response we expect.
    // Drop it and tear down: a malformed unbounded frame from mpv means the
    // stream is corrupted; the next ensureRunning() call re-attaches.
    if (this.buffer.length > MAX_IPC_BUFFER_BYTES) {
      const reason = `mpv IPC frame exceeded ${MAX_IPC_BUFFER_BYTES} bytes without a newline; dropping connection`;
      logger.warn(reason);
      this.buffer = '';
      this.handleUnexpectedDisconnect(reason);
    }
  }

  private handleLine(line: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      logger.debug(`mpv IPC: non-JSON line ignored: ${line}`);
      return;
    }
    if (typeof msg !== 'object' || msg === null) return;

    const obj = msg as Record<string, unknown>;

    // Response to a command we sent
    if (typeof obj['request_id'] === 'number') {
      const response = obj as IpcResponse;
      const id = response.request_id;
      if (id === undefined) return;
      const pending = this.pending.get(id);
      if (pending !== undefined) {
        this.pending.delete(id);
        if (response.error === 'success') {
          pending.resolve(response.data);
        } else {
          pending.reject(new Error(`mpv command error: ${response.error ?? 'unknown'}`));
        }
        return;
      }
      // request_id 0 with no pending entry can occur for unsolicited replies; ignore
      return;
    }

    // Unsolicited event
    if (typeof obj['event'] === 'string') {
      const evt = obj as unknown as IpcEvent;
      if (evt.event === 'property-change') {
        const changeId = obj['id'];
        const name = obj['name'];
        if (typeof changeId === 'number' && typeof name === 'string') {
          const change: PropertyChangeEvent = { id: changeId, name, data: obj['data'] };
          for (const h of this.propertyHandlers) {
            try { h(change); } catch (e) { logger.error('property handler error:', e); }
          }
          return;
        }
      }
      for (const h of this.eventHandlers) {
        try { h(evt); } catch (e) { logger.error('event handler error:', e); }
      }
    }
  }

  private rejectAllPending(err: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(err);
    }
    this.pending.clear();
  }

  /**
   * Shared teardown path for unexpected disconnects: peer-initiated socket
   * close and command-timeout (mpv stalled) both route through here. Marks
   * the IPC closed, drops the socket reference, rejects all in-flight
   * commands, and fires `disconnectHandlers` so the engine can null its
   * `this.ipc` reference and re-attach on the next call.
   *
   * Idempotent — second calls are no-ops, so a timeout that races a peer
   * close (or vice-versa) doesn't double-fire handlers.
   */
  private handleUnexpectedDisconnect(reason: string): void {
    if (this.closed) return;
    logger.debug(`mpv IPC unexpectedly disconnected: ${reason}`);
    this.closed = true;
    try {
      this.socket?.destroy();
    } catch {
      // socket already destroyed; ignore
    }
    this.socket = null;
    this.rejectAllPending(new Error(reason));
    for (const handler of this.disconnectHandlers) {
      try {
        handler();
      } catch (e) {
        logger.error('disconnect handler error:', e);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
