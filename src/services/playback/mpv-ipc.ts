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
  async connect(path: string, retries = 50, delayMs = 100): Promise<void> {
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

    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket?.write(payload, (err) => {
        if (err !== null && err !== undefined) {
          this.pending.delete(id);
          reject(err);
        }
      });
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
          if (!this.closed) {
            logger.debug('mpv IPC socket closed by peer');
            this.closed = true;
            this.socket = null;
            this.rejectAllPending(new Error('mpv IPC socket closed unexpectedly'));
            for (const handler of this.disconnectHandlers) {
              try { handler(); } catch (e) { logger.error('disconnect handler error:', e); }
            }
          }
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
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
