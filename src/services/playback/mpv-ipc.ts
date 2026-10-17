/**
 * Navidrome MCP Server - mpv JSON-IPC Client
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { createConnection, type Socket } from 'node:net';
import {
  MPV_COMMAND_TIMEOUT_LOAD_MS,
  MPV_COMMAND_TIMEOUT_QUICK_MS,
  MPV_IPC_CONNECT_DELAY_MS,
  MPV_IPC_CONNECT_RETRIES,
  MPV_IPC_CONNECT_TIMEOUT_MS,
  MPV_LOAD_COMMANDS,
} from '../../constants/timeouts.js';
import { logger } from '../../utils/logger.js';

type IpcArg = string | number | boolean | null;

/** Event-specific fields, such as `reason` on end-file, are read off the index signature. */
interface IpcEvent {
  event: string;
  [key: string]: unknown;
}

interface PropertyChangeEvent {
  id: number;
  name: string;
  data: unknown;
}

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
}

interface IpcResponse {
  error?: string;
  data?: unknown;
}

/** Caps a runaway partial frame. A 583-track playlist frame reached ~250 KB. */
const MAX_IPC_BUFFER_BYTES = 16 * 1024 * 1024;

/**
 * Node's `net` opens a Unix domain socket and a Windows named pipe (`\\.\pipe\...`) alike, so one
 * client serves every platform.
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

  /** Retries, since mpv creates its socket a moment after spawn. */
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

      // A stalled mpv blocks every later command, so a timeout drops the socket to force re-attach.
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

  /** mpv tags each later property-change event for `name` with `id`. */
  async observeProperty(id: number, name: string): Promise<void> {
    await this.command('observe_property', id, name);
  }

  /** A well-formed property-change event goes to the onPropertyChange handlers instead. */
  onEvent(handler: (evt: IpcEvent) => void): void {
    this.eventHandlers.push(handler);
  }

  onPropertyChange(handler: (evt: PropertyChangeEvent) => void): void {
    this.propertyHandlers.push(handler);
  }

  /**
   * Fires once on peer close, command timeout or frame overflow. close() never fires it, so the
   * engine can tell a deliberate teardown from a hangup it must react to.
   */
  onDisconnect(handler: () => void): void {
    this.disconnectHandlers.push(handler);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.rejectAllPending(new Error('mpv IPC socket closed'));
    try {
      this.socket?.end();
      this.socket?.destroy();
    } catch {
      // The socket is being torn down.
    }
    this.socket = null;
  }

  isConnected(): boolean {
    return this.socket !== null && !this.closed;
  }

  private openSocket(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = createConnection({ path });
      let timer: NodeJS.Timeout | null = null;

      const onError = (err: Error): void => {
        if (timer !== null) clearTimeout(timer);
        sock.removeListener('connect', onConnect);
        sock.destroy();
        reject(err);
      };

      const onConnect = (): void => {
        if (timer !== null) clearTimeout(timer);
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

      // Bounds a connect that fires neither connect nor error, so connect() keeps its retry budget.
      timer = setTimeout(() => {
        sock.removeListener('connect', onConnect);
        sock.removeListener('error', onError);
        sock.destroy();
        reject(new Error(`mpv IPC connect timed out after ${MPV_IPC_CONNECT_TIMEOUT_MS}ms`));
      }, MPV_IPC_CONNECT_TIMEOUT_MS);
      timer.unref();

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
    // A frame this large without a newline means a corrupt stream, so drop the connection.
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
    const requestId = obj['request_id'];

    if (typeof requestId === 'number') {
      const response = obj as IpcResponse;
      const pending = this.pending.get(requestId);
      if (pending !== undefined) {
        if (response.error === 'success') {
          pending.resolve(response.data);
        } else {
          pending.reject(new Error(`mpv command error: ${response.error ?? 'unknown'}`));
        }
        return;
      }
      return;
    }

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

  /** Idempotent, so racing triggers fire the disconnect handlers once. */
  private handleUnexpectedDisconnect(reason: string): void {
    if (this.closed) return;
    logger.debug(`mpv IPC unexpectedly disconnected: ${reason}`);
    this.closed = true;
    try {
      this.socket?.destroy();
    } catch {
      // Teardown continues whatever destroy() throws.
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
