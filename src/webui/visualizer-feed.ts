/**
 * Navidrome MCP Server - Visualizer level feed
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

import { VISUALIZER_FEED_RETRY_MS } from '../constants/timeouts.js';
import { MpvIpc } from '../services/playback/mpv-ipc.js';
import { getDefaultIpcPath } from '../services/playback/mpv-process.js';
import { VisualizerLogParser, type LevelRecord } from '../services/playback/visualizer-log.js';
import { logger } from '../utils/logger.js';

/**
 * Reads the visualizer filter's measurements from mpv's log. mpv finishes each write to a client before the
 * next, so a slow log reader would stall commands on its connection, and this feed holds a connection of its own.
 */
export class VisualizerFeed {
  private ipc: MpvIpc | null = null;
  private running = false;
  private connecting = false;
  private retryTimer: NodeJS.Timeout | null = null;
  private readonly parser = new VisualizerLogParser();

  constructor(
    private readonly onRecord: (record: LevelRecord) => void,
    private readonly createIpc: () => MpvIpc = () => new MpvIpc(),
    private readonly ipcPath: string = getDefaultIpcPath(),
  ) {}

  start(): void {
    this.running = true;
    if (this.ipc === null && !this.connecting && this.retryTimer === null) void this.connect();
  }

  stop(): void {
    this.running = false;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.ipc?.close();
    this.ipc = null;
    this.parser.reset();
  }

  private async connect(): Promise<void> {
    this.connecting = true;
    const ipc = this.createIpc();
    try {
      await ipc.connect(this.ipcPath, 1, 0);
      ipc.onEvent((evt) => {
        if (evt.event !== 'log-message') return;
        const record = this.parser.push({ prefix: evt['prefix'], text: evt['text'] });
        if (record !== null) this.onRecord(record);
      });
      ipc.onDisconnect(() => {
        if (this.ipc !== ipc) return;
        this.ipc = null;
        this.parser.reset();
        this.scheduleRetry();
      });
      await ipc.command('request_log_messages', 'v');
    } catch (err) {
      logger.debug(`visualizer feed: mpv is not reachable yet: ${err instanceof Error ? err.message : String(err)}`);
      ipc.close();
      this.connecting = false;
      this.scheduleRetry();
      return;
    }
    this.connecting = false;
    if (!this.running) {
      ipc.close();
      return;
    }
    this.ipc = ipc;
  }

  private scheduleRetry(): void {
    if (!this.running || this.retryTimer !== null) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.running && this.ipc === null && !this.connecting) void this.connect();
    }, VISUALIZER_FEED_RETRY_MS);
    this.retryTimer.unref();
  }
}
