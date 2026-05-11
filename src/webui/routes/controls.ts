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
import {
  next,
  pause,
  playQueueIndex,
  previous,
  resume,
  seek,
  setVolume,
} from '../../tools/playback.js';
import { readJsonBody, writeError, writeJson } from '../http-helpers.js';

/**
 * Wrap a no-arg playback action so all control routes share consistent
 * error-to-status mapping. Errors from the engine (mpv not reachable,
 * validation failures from the reused Zod schemas) flow through here as 500
 * with their message preserved.
 */
async function runAction(
  res: ServerResponse,
  action: () => Promise<unknown>,
): Promise<void> {
  try {
    const result = await action();
    writeJson(res, 200, result);
  } catch (err) {
    writeError(res, 500, err instanceof Error ? err.message : 'unknown error');
  }
}

export function handlePause(res: ServerResponse): Promise<void> {
  return runAction(res, () => pause({}));
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

/**
 * POST /api/controls/seek — Body `{seconds: number, mode?: 'absolute'|'relative'}`.
 * Validation is delegated to the existing Zod schema inside the seek impl
 * (re-used as-is so the UI cannot drift from the MCP shape).
 */
export async function handleSeek(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    writeError(res, 400, err instanceof Error ? err.message : 'invalid JSON body');
    return;
  }
  return runAction(res, () => seek(body));
}

/**
 * POST /api/controls/volume — Body `{level: number}`. Forwards to set_volume,
 * which clamps to [0, 100] inside the engine.
 */
export async function handleVolume(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    writeError(res, 400, err instanceof Error ? err.message : 'invalid JSON body');
    return;
  }
  return runAction(res, () => setVolume(body));
}

/**
 * POST /api/controls/play-index — Body `{index: number}`. Jumps the play
 * head to that queue entry without mutating queue contents. The frontend's
 * "click a queue row to play it" affordance is the only caller today;
 * keeping the route generic so curl/clients can drive it too.
 */
export async function handlePlayQueueIndex(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    writeError(res, 400, err instanceof Error ? err.message : 'invalid JSON body');
    return;
  }
  return runAction(res, () => playQueueIndex(body));
}
