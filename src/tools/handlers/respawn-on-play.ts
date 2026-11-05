/**
 * Navidrome MCP Server - Respawn-on-play
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { ensureWebForPlayback } from '../../web/spawn.js';

/**
 * Brings the web player back up before a play, since the user may have powered it off. A failure is
 * swallowed, because this MCP process can drive mpv without the web player.
 */
export async function respawnWebForPlay(config: Config): Promise<void> {
  try {
    await ensureWebForPlayback(config);
  } catch (err) {
    logger.warn('respawn-on-play: ensureWebForPlayback failed, continuing with playback:', err);
  }
}
