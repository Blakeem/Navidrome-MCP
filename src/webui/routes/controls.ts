/**
 * Navidrome MCP Server - Web UI Control Routes
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
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

export function handleClear(res: ServerResponse): Promise<void> {
  return runAction(res, () => clearPlayQueue({}));
}

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

export async function handleSeek(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readValidBody(req, res, SeekSchema);
  if (body === null) return;
  return runAction(res, () => seek(body));
}

export async function handleVolume(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readValidBody(req, res, SetVolumeSchema);
  if (body === null) return;
  return runAction(res, () => setVolume(body));
}

export async function handlePlayQueueIndex(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readValidBody(req, res, PlayQueueIndexSchema);
  if (body === null) return;
  return runAction(res, () => playQueueIndex(body));
}
