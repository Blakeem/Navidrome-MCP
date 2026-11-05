/**
 * Navidrome MCP Server - Web UI Control Routes
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { PlayQueueIndexSchema, QueueEntryRemoveSchema, SeekSchema, SetAudioDeviceSchema, SetVolumeSchema } from '../../schemas/index.js';
import {
  clearPlayQueue,
  listAudioDevices,
  next,
  pause,
  playQueueIndex,
  previous,
  resume,
  seek,
  setAudioDevice,
  setVolume,
  shuffleQueueFromTop,
} from '../../tools/playback.js';
import { logger } from '../../utils/logger.js';
import { readValidBody, runAction, writeError, writeJson } from '../http-helpers.js';
import type { GuestQueue } from '../jukebox/guest-queue.js';

const ENTRY_GONE = 'That song is no longer in the queue.';
const ENTRY_PLAYING = 'That song is playing. Skip it to move on.';

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

export function handleAudioDevices(res: ServerResponse): Promise<void> {
  return runAction(res, () => listAudioDevices({}));
}

export async function handleAudioDevice(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readValidBody(req, res, SetAudioDeviceSchema);
  if (body === null) return;
  return runAction(res, () => setAudioDevice(body));
}

export async function handlePlayQueueIndex(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readValidBody(req, res, PlayQueueIndexSchema);
  if (body === null) return;
  return runAction(res, () => playQueueIndex(body));
}

/** The entry id survives a move, so a queue that shifts between render and tap never loses the wrong song. */
export async function handleQueueRemove(
  req: IncomingMessage,
  res: ServerResponse,
  guests: Pick<GuestQueue, 'removeForHost'>,
): Promise<void> {
  const input = await readValidBody(req, res, QueueEntryRemoveSchema);
  if (input === null) return;

  try {
    const result = await guests.removeForHost(input.entryId);
    switch (result.kind) {
      case 'not-found':
        writeJson(res, 404, { error: ENTRY_GONE, code: 'not-found' });
        return;
      case 'started':
        writeJson(res, 409, { error: ENTRY_PLAYING, code: 'started' });
        return;
      case 'removed':
        if (result.guestLabel !== null) logger.info(`webui: the host removed a song ${result.guestLabel} added from the queue`);
        writeJson(res, 200, { ok: true });
        return;
    }
  } catch (err) {
    writeError(res, 500, err instanceof Error ? err.message : 'unknown error');
  }
}
