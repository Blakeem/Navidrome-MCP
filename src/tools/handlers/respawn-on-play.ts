/**
 * Navidrome MCP Server - Respawn-on-play
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

import type { Config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { ensureWebForPlayback } from '../../web/spawn.js';

/**
 * Bring the web player back up before a play so it owns and scrobbles the new content.
 * A respawn failure never blocks playback.
 */
export async function respawnWebForPlay(config: Config): Promise<void> {
  try {
    await ensureWebForPlayback(config);
  } catch (err) {
    logger.warn('respawn-on-play: ensureWebForPlayback failed, continuing with playback:', err);
  }
}
