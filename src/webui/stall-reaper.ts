/**
 * Navidrome MCP Server - Stalled SSE stream reaper
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { ServerResponse } from 'node:http';
import { logger } from '../utils/logger.js';

/**
 * A peer that stops reading never errors, so a backlog with no 'drain' across an entire heartbeat
 * interval marks it stalled. The caller runs `reapIfStalled` once per heartbeat.
 */
export class StallReaper {
  private readonly backloggedAtHeartbeat = new WeakSet<ServerResponse>();

  /** Destroys the stream and returns true when it stayed backlogged since the previous heartbeat. */
  reapIfStalled(res: ServerResponse): boolean {
    if (!res.writableNeedDrain) {
      this.backloggedAtHeartbeat.delete(res);
      return false;
    }
    if (!this.backloggedAtHeartbeat.has(res)) {
      this.backloggedAtHeartbeat.add(res);
      return false;
    }
    logger.debug('webui: SSE client drained nothing for a heartbeat interval, dropping it');
    res.destroy();
    return true;
  }

  markDrained(res: ServerResponse): void {
    this.backloggedAtHeartbeat.delete(res);
  }
}
