/**
 * Navidrome MCP Server - Guest stream snapshot
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { WebuiTheme } from '../constants/defaults.js';
import type { QueueEntry } from '../services/playback/playback-engine.js';
import type { nowPlaying } from '../tools/playback.js';
import type { GuestJukebox } from './auth/auth-service.js';

type NowPlayingResult = Awaited<ReturnType<typeof nowPlaying>>;

interface GuestNowPlaying {
  engineRunning: boolean;
  queueIndex?: number;
  queueLength?: number;
  paused?: boolean;
  position?: number;
  duration?: number;
  songId?: string;
  title?: string;
  artist?: string;
  album?: string;
  isRadio?: boolean;
}

interface GuestQueueItem {
  index: number;
  entryId: number | null;
  songId: string | null;
  title?: string;
  artist?: string;
  duration?: number;
  isCurrent: boolean;
  /** This session added the song from the guest page and it has not started, so it counts toward the limit and the session may remove it. */
  mine: boolean;
  /** The song waits to play, so the server refuses another copy of it. */
  waiting: boolean;
  /** The guest, host nickname or `Host` the queue names as the adder of a labeled song. */
  addedBy?: string;
}

type GuestQueue = { items: GuestQueueItem[]; length: number } | null;

/** `remaining` is how many more songs this guest may add now. */
export type GuestJukeboxView = GuestJukebox & { limit: number; remaining: number };

/**
 * `visualizer` says only whether the visualizer feed runs, so the guest page shows it under the host's
 * choice. `theme` is the host's forced theme, which every device follows. An absent `queue` means the
 * queue matches the last one this client received.
 */
export interface GuestSnapshot {
  nowPlaying: GuestNowPlaying | null;
  queue?: GuestQueue;
  visualizer: boolean;
  theme: WebuiTheme | null;
  jukebox: GuestJukeboxView;
}

/** Fields are copied one by one, so a field later added to the host snapshot never reaches a guest unreviewed. */
export function toGuestNowPlaying(np: NowPlayingResult | null): GuestNowPlaying | null {
  if (np === null) return null;
  const out: GuestNowPlaying = { engineRunning: np.engineRunning };
  if (np.queueIndex !== undefined) out.queueIndex = np.queueIndex;
  if (np.queueLength !== undefined) out.queueLength = np.queueLength;
  if (np.paused !== undefined) out.paused = np.paused;
  if (np.position !== undefined) out.position = np.position;
  if (np.duration !== undefined) out.duration = np.duration;
  if (np.songId !== undefined) out.songId = np.songId;
  if (np.title !== undefined) out.title = np.title;
  if (np.artist !== undefined) out.artist = np.artist;
  if (np.album !== undefined) out.album = np.album;
  if (np.isRadio !== undefined) out.isRadio = np.isRadio;
  return out;
}

/** The guest ledger's reads the guest queue needs. */
interface GuestQueueLedger {
  addedByOf(entryId: number): string | null;
  waitingRule(queue: readonly QueueEntry[]): (queued: QueueEntry) => boolean;
}

export function toGuestQueue(entries: QueueEntry[] | null, mine: ReadonlySet<number>, ledger: GuestQueueLedger): GuestQueue {
  if (entries === null) return null;
  const isWaiting = ledger.waitingRule(entries);
  const items = entries.map((entry): GuestQueueItem => {
    const item: GuestQueueItem = {
      index: entry.index,
      entryId: entry.entryId ?? null,
      songId: entry.songId,
      isCurrent: entry.isCurrent,
      mine: entry.entryId !== undefined && mine.has(entry.entryId),
      waiting: isWaiting(entry),
    };
    if (entry.title !== undefined) item.title = entry.title;
    if (entry.artist !== undefined) item.artist = entry.artist;
    if (entry.duration !== undefined) item.duration = entry.duration;
    const addedBy = entry.entryId === undefined ? null : ledger.addedByOf(entry.entryId);
    if (addedBy !== null) item.addedBy = addedBy;
    return item;
  });
  return { items, length: items.length };
}
