/**
 * Navidrome MCP Server - Guest song ledger
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { QueueEntry, QueueTrackMetadata, ReplaceMarks } from '../../services/playback/playback-engine.js';
import type { QueuedNames } from './jukebox-names.js';

interface LedgerEntry {
  /** The guest or host session that added the song from the guest page, or null for a song the admin page added. */
  sessionId: string | null;
  /** Kept whole, so a song re-added after a replace still shows its title. */
  song: QueueTrackMetadata;
  /** The adder's current nickname or label, which the queue shows as Added by. It stays after a sign-out. */
  addedBy: string;
  /** The host added the song from either page. The name checks read it to tell host names from guest names, and a log line never names the host by its nickname. */
  byHost: boolean;
  addedAt: number;
  started: boolean;
  /** Orders this record against a queue read, see `recordSequence`. */
  sequence: number;
}

export type GuestSong = Omit<LedgerEntry, 'started' | 'sequence'>;

/** The replace marks read after a queue read, and the generation read before it. */
export interface ReplaceReads extends ReplaceMarks {
  generationBeforeRead: number;
}

interface HeldEntry {
  entry: LedgerEntry;
  /** The replace generation the ledger last read before a replace removed the song. */
  generationBefore: number;
}

/**
 * Keyed by mpv entry id, which survives a move. It lives in memory, so a web player restart forgets
 * it, and the labeled songs stay queued as plain songs. Only a guest page song counts toward a limit,
 * waits for its adder and returns after a replace. An admin page song only carries its label.
 */
export class GuestLedger {
  private readonly entries = new Map<number, LedgerEntry>();
  // Unplayed songs a song replace removed. They wait for that replace to complete, then return.
  private held: HeldEntry[] = [];
  // Songs `takeRestorable` handed out and `finishRestore` has not returned, so a rename during the append still reaches them.
  private restoring: LedgerEntry[] = [];
  // The generation read before the last queue read, so a rise that read missed still counts next time.
  // Null until a reconcile reads one.
  private replaceGeneration: number | null = null;
  // The generation read after the last queue read. A held song returns once it differs from the song's.
  private latestGeneration = 0;
  private recordCount = 0;

  record(entryId: number, entry: GuestSong): void {
    this.recordCount++;
    this.entries.set(entryId, { ...entry, started: false, sequence: this.recordCount });
  }

  /** Taken before a queue read, so `reconcile` leaves alone the entries recorded after that read began. */
  recordSequence(): number {
    return this.recordCount;
  }

  forget(entryId: number): void {
    this.entries.delete(entryId);
  }

  isEmpty(): boolean {
    return this.entries.size === 0 && this.held.length === 0;
  }

  /** Admin page songs count toward no limit, so only guest page songs need the queue read on every mpv event. */
  tracksGuestPageSongs(): boolean {
    return this.held.length > 0 || this.restoring.length > 0 || [...this.entries.values()].some(isGuestPageEntry);
  }

  ownerOf(entryId: number): string | null {
    return this.entries.get(entryId)?.sessionId ?? null;
  }

  songIdOf(entryId: number): string | null {
    return this.entries.get(entryId)?.song.songId ?? null;
  }

  isStarted(entryId: number): boolean {
    return this.entries.get(entryId)?.started === true;
  }

  addedByOf(entryId: number): string | null {
    return this.entries.get(entryId)?.addedBy ?? null;
  }

  /** Null for a song the host added, so only a guest's song names its adder. */
  guestLabelOf(entryId: number): string | null {
    const entry = this.entries.get(entryId);
    return entry === undefined || entry.byHost ? null : entry.addedBy;
  }

  isFromGuestPage(entryId: number): boolean {
    return isGuestPageEntry(this.entries.get(entryId));
  }

  /** Renames the session's songs, held ones included, so a changed nickname shows on songs already queued. */
  relabel(sessionId: string, addedBy: string): void {
    for (const entry of this.everyEntry()) {
      if (entry.sessionId === sessionId) entry.addedBy = addedBy;
    }
  }

  /** Held songs count, since they return to the queue still showing their name. A library play adds one Host per song, so names repeat. */
  addedByNames(): QueuedNames {
    const host = new Set<string>();
    const guest = new Set<string>();
    for (const entry of this.everyEntry()) (entry.byHost ? host : guest).add(entry.addedBy);
    return { host: [...host], guest: [...guest] };
  }

  private everyEntry(): LedgerEntry[] {
    return [...this.entries.values(), ...this.held.map((held) => held.entry), ...this.restoring];
  }

  /**
   * Drops the entries mpv no longer holds and starts the current entry while mpv plays, so an entry
   * selected paused stays unplayed. An unknown pause state starts nothing. An unplayed guest page entry
   * that a song replace removed is held instead, and dropped once that replace fails. Returns true on a change.
   */
  reconcile(queue: readonly QueueEntry[], paused: boolean | null, queueReadSequence: number, marks: ReplaceReads): boolean {
    const queuedById = new Map<number, QueueEntry>();
    for (const queued of queue) {
      if (queued.entryId !== undefined) queuedById.set(queued.entryId, queued);
    }
    let changed = false;

    // A new mpv instance numbers its replaces from 0 again and holds none of the held songs. A
    // re-attach to the same mpv keeps its generation, so it keeps them.
    if (this.replaceGeneration !== null && marks.generation < this.replaceGeneration) {
      changed = this.held.length > 0;
      this.held = [];
      this.replaceGeneration = null;
    }
    const generationBefore = this.replaceGeneration ?? marks.generationBeforeRead;
    const replaced = marks.pending || marks.generation !== generationBefore;
    for (const [entryId, entry] of this.entries) {
      if (entry.sequence > queueReadSequence) continue;
      const queued = queuedById.get(entryId);
      // A new mpv instance numbers its entries from 1 again, so an id naming another song is a different entry.
      if (queued === undefined || queued.songId !== entry.song.songId) {
        this.entries.delete(entryId);
        if (replaced && !entry.started && isGuestPageEntry(entry)) this.held.push({ entry, generationBefore });
        changed = true;
      } else if (!entry.started && queued.isCurrent && paused === false) {
        entry.started = true;
        changed = true;
      }
    }

    // A failed replace clears its pending mark with no rise.
    const heldCount = this.held.length;
    this.held = this.held.filter((held) => marks.pending || marks.generation !== held.generationBefore);
    if (this.held.length !== heldCount) changed = true;
    this.replaceGeneration = marks.generationBeforeRead;
    this.latestGeneration = marks.generation;
    return changed;
  }

  hasRestorable(): boolean {
    return this.held.some((held) => this.isRestorable(held));
  }

  /** Takes the held songs whose replace completed, in their add order. */
  takeRestorable(): GuestSong[] {
    const restorable = this.held.filter((held) => this.isRestorable(held));
    this.held = this.held.filter((held) => !this.isRestorable(held));
    const taken = restorable.sort((a, b) => a.entry.sequence - b.entry.sequence).map((held) => held.entry);
    this.restoring.push(...taken);
    return taken;
  }

  /** Ends the rename tracking of the songs `takeRestorable` returned, once they are recorded or dropped. */
  finishRestore(taken: readonly GuestSong[]): void {
    this.restoring = this.restoring.filter((entry) => !taken.includes(entry));
  }

  private isRestorable(held: HeldEntry): boolean {
    return held.generationBefore !== this.latestGeneration;
  }

  /** A held song keeps its guest's slot until it returns to the queue or drops. */
  unplayedCount(sessionId: string): number {
    const heldCount = this.held.filter((held) => held.entry.sessionId === sessionId).length;
    return this.unplayedEntryIds(sessionId).length + heldCount;
  }

  /** The guest's queued songs that have not started, which it may remove. */
  unplayedEntryIds(sessionId: string): number[] {
    const ids: number[] = [];
    for (const [entryId, entry] of this.entries) {
      if (entry.sessionId === sessionId && !entry.started) ids.push(entryId);
    }
    return ids;
  }

  /** The guest's songs that have not started, held ones included, in their add order. */
  unplayedSongs(sessionId: string): QueueTrackMetadata[] {
    const waiting = [...this.entries.values()].filter((entry) => entry.sessionId === sessionId && !entry.started);
    const held = this.held.map((heldEntry) => heldEntry.entry).filter((entry) => entry.sessionId === sessionId);
    return [...waiting, ...held].sort((a, b) => a.sequence - b.sequence).map((entry) => entry.song);
  }

  /** A completed replace never brings back the held songs this drops. Returns how many it dropped. */
  dropHeld(sessionId: string): number {
    const heldCount = this.held.length;
    this.held = this.held.filter((held) => held.entry.sessionId !== sessionId);
    return heldCount - this.held.length;
  }

  /**
   * Any entry after the current one waits to play, and a guest page song that never started waits wherever
   * it sits. The guest snapshot sends this rule, so the guest page and the duplicate check agree.
   */
  waitingRule(queue: readonly QueueEntry[]): (queued: QueueEntry) => boolean {
    const currentIndex = queue.findIndex((queued) => queued.isCurrent);
    return (queued) => {
      const entry = queued.entryId === undefined ? undefined : this.entries.get(queued.entryId);
      const afterCurrent = currentIndex >= 0 && queued.index > currentIndex;
      return afterCurrent || (isGuestPageEntry(entry) && !entry.started);
    };
  }

  /** A held song also waits, since it returns to the queue. */
  isWaitingInQueue(queue: readonly QueueEntry[], songId: string): boolean {
    if (this.held.some((held) => held.entry.song.songId === songId)) return true;
    const isWaiting = this.waitingRule(queue);
    return queue.some((queued) => queued.songId === songId && isWaiting(queued));
  }
}

function isGuestPageEntry(entry: LedgerEntry | undefined): entry is LedgerEntry {
  return typeof entry?.sessionId === 'string';
}
