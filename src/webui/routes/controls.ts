/**
 * Navidrome MCP Server - Web UI Control Routes
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

import type { IncomingMessage, ServerResponse } from 'node:http';
import { PlayQueueIndexSchema, SeekSchema, SetVolumeSchema } from '../../schemas/index.js';
import {
  clearPlayQueue,
  next,
  pause,
  playQueueIndex,
  previous,
  resume,
  seek,
  setVolume,
  shuffleQueueFromTop,
} from '../../tools/playback.js';
import { readValidBody, runAction } from '../http-helpers.js';

export function handlePause(res: ServerResponse): Promise<void> {
  return runAction(res, () => pause({}));
}

/**
 * POST /api/controls/clear empties the live queue and stops audio (mpv `stop`).
 * mpv has no stop-but-keep-queue, so stop and clear are one operation, exposed once as clear.
 */
export function handleClear(res: ServerResponse): Promise<void> {
  return runAction(res, () => clearPlayQueue({}));
}

/**
 * POST /api/controls/shuffle: shuffle the queue and restart from the new top
 * track. Unlike the MCP `shuffle_play_queue`, the playing track does not stay on top.
 */
export function handleShuffle(res: ServerResponse): Promise<void> {
  return runAction(res, () => shuffleQueueFromTop({}));
}

export function handleResume(res: ServerResponse): Promise<void> {
  return runAction(res, () => resume({}));
}

export function handleNext(res: ServerResponse): Promise<void> {
  return runAction(res, () => next({}));
}

export function handlePrevious(res: ServerResponse): Promise<void> {
  return runAction(res, () => previous({}));
}

// POST /api/controls/seek. Body `{seconds: number, mode?: 'absolute'|'relative'}`.
export async function handleSeek(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readValidBody(req, res, SeekSchema);
  if (body === null) return;
  return runAction(res, () => seek(body));
}

/**
 * POST /api/controls/volume. Body `{level: number}`. Forwards to set_volume,
 * which clamps to [0, 100] inside the engine.
 */
export async function handleVolume(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readValidBody(req, res, SetVolumeSchema);
  if (body === null) return;
  return runAction(res, () => setVolume(body));
}

/**
 * POST /api/controls/play-index. Body `{index: number}`. Jumps the play
 * head to that queue entry without mutating queue contents. The route stays
 * generic so curl and other clients can drive it too.
 */
export async function handlePlayQueueIndex(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readValidBody(req, res, PlayQueueIndexSchema);
  if (body === null) return;
  return runAction(res, () => playQueueIndex(body));
}
