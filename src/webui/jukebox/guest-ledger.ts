/**
 * Navidrome MCP Server - Guest song ledger
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { QueueEntry, QueueTrackMetadata, ReplaceMarks } from '../../services/playback/playback-engine.js';

interface LedgerEntry {
  sessionId: string;
  /** Kept whole, so a song re-added after a replace still shows its title. */
  song: QueueTrackMetadata;
  /** The guest's current nickname or label, kept so the host still sees it after a sign-out. */
  guestLabel: string;
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
 * it, and the guest songs stay queued as plain songs.
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

  ownerOf(entryId: number): string | null {
    return this.entries.get(entryId)?.sessionId ?? null;
  }

  songIdOf(entryId: number): string | null {
    return this.entries.get(entryId)?.song.songId ?? null;
  }

  isStarted(entryId: number): boolean {
    return this.entries.get(entryId)?.started === true;
  }

  guestLabelOf(entryId: number): string | null {
    return this.entries.get(entryId)?.guestLabel ?? null;
  }

  /** Renames the guest's songs, held ones included, so a changed nickname shows on songs already queued. */
  relabel(sessionId: string, guestLabel: string): void {
    const heldEntries = this.held.map((held) => held.entry);
    for (const entry of [...this.entries.values(), ...heldEntries, ...this.restoring]) {
      if (entry.sessionId === sessionId) entry.guestLabel = guestLabel;
    }
  }

  /**
   * Drops the entries mpv no longer holds and starts the current entry while mpv plays, so an entry
   * selected paused stays unplayed. An unknown pause state starts nothing. An unplayed entry that a
   * song replace removed is held instead, and dropped once that replace fails. Returns true on a change.
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
        if (replaced && !entry.started) this.held.push({ entry, generationBefore });
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
   * A guest song waits until it starts, and a held one waits to return. Any other entry waits while
   * it sits after the current entry.
   */
  isWaitingInQueue(queue: readonly QueueEntry[], songId: string): boolean {
    if (this.held.some((held) => held.entry.song.songId === songId)) return true;
    const currentIndex = queue.findIndex((queued) => queued.isCurrent);
    return queue.some((queued) => {
      if (queued.songId !== songId) return false;
      const entry = queued.entryId === undefined ? undefined : this.entries.get(queued.entryId);
      if (entry !== undefined) return !entry.started;
      return currentIndex >= 0 && queued.index > currentIndex;
    });
  }
}
