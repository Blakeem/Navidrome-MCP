/**
 * Navidrome MCP Server - Guest additions to the play queue
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {
  holdsRadioStream,
  playbackEngine,
  QueueEntryStartedError,
  RadioQueueRefusedError,
  REPLACE_GENERATION_PROPERTY,
  REPLACE_PENDING_PROPERTY,
  type QueueEntry,
  type QueueTrackMetadata,
} from '../../services/playback/playback-engine.js';
import { logger } from '../../utils/logger.js';
import { getGuestQueueLimit } from '../../web/player-runtime.js';
import { TokenBuckets } from '../auth/token-bucket.js';
import { GuestLedger, type GuestSong } from './guest-ledger.js';

const MINUTE_MS = 60_000;
const GUEST_SEARCHES_PER_MINUTE = 30;
const GUEST_ADD_INTERVAL_MS = 5_000;
// Only these changes can start an entry, drop one from the playlist, or end a song replace.
const LEDGER_PROPERTIES: ReadonlySet<string> = new Set([
  'pause',
  'playlist-pos',
  'playlist-count',
  REPLACE_PENDING_PROPERTY,
  REPLACE_GENERATION_PROPERTY,
]);

type GuestQueueEngine = Pick<
  typeof playbackEngine,
  | 'enqueue'
  | 'getQueue'
  | 'isRunning'
  | 'onStateChange'
  | 'readPaused'
  | 'readReplaceGeneration'
  | 'readReplaceMarks'
  | 'removeQueueEntryById'
>;

interface QueueingGuest {
  sessionId: string;
  /** Read when the song is recorded, since a rename can land while the add awaits its turn. */
  currentLabel: () => string;
  /** Read again after the queue reads, since a ban or sign-out can land while an add or removal awaits them. */
  isLive: () => boolean;
}

type AddResult =
  | { kind: 'added'; entryId: number; remaining: number }
  | { kind: 'radio' }
  | { kind: 'limit'; limit: number }
  | { kind: 'duplicate' }
  | { kind: 'wait'; waitMs: number }
  | { kind: 'untracked' }
  | { kind: 'signed-out' };

type RemoveResult = { kind: 'removed'; remaining: number } | { kind: 'not-found' } | { kind: 'started' } | { kind: 'signed-out' };

/** `guestLabel` names the guest who added the removed song, or is null for a host song. */
type HostRemoveResult = { kind: 'removed'; guestLabel: string | null } | { kind: 'not-found' } | { kind: 'started' };

/** `stayed` counts the queued songs left in place because no mpv was attached. */
interface GuestSongRemoval {
  removed: number;
  stayed: number;
}

/** `stayed` marks an entry left in place because no mpv was attached, and `skipped` one that started or that mpv no longer holds. */
type UnstartedRemoval = 'removed' | 'stayed' | 'skipped';

/** Owns the guest ledger and the per-session rate limits of the guest search and add routes. */
export class GuestQueue {
  readonly ledger = new GuestLedger();
  readonly searches = new TokenBuckets(GUEST_SEARCHES_PER_MINUTE, MINUTE_MS);
  private readonly adds = new TokenBuckets(1, GUEST_ADD_INTERVAL_MS);
  private onChange: () => void = () => undefined;
  private addChain: Promise<unknown> = Promise.resolve();
  private refreshing = false;
  private refreshAgain = false;

  constructor(
    private readonly engine: GuestQueueEngine = playbackEngine,
    private readonly limit: () => number = getGuestQueueLimit,
    private readonly now: () => number = Date.now,
  ) {}

  /** Follows mpv, so a guest song that starts while no page is open still frees its slot. */
  watch(onChange: () => void): void {
    this.onChange = onChange;
    this.engine.onStateChange((event) => {
      if (event.kind === 'queue' || (event.kind === 'property' && LEDGER_PROPERTIES.has(event.name))) this.scheduleRefresh();
    });
  }

  /** A lowered limit can leave a guest above it, and its songs stay, so `remaining` stops at 0. */
  counts(sessionId: string): { limit: number; remaining: number } {
    const limit = this.limit();
    return { limit, remaining: Math.max(0, limit - this.unplayedCount(sessionId)) };
  }

  /**
   * Adds run one at a time, so two adds never both pass the limit or the duplicate check before
   * either records its song. An append never starts or resumes playback.
   */
  add(guest: QueueingGuest, song: QueueTrackMetadata): Promise<AddResult> {
    const run = this.addChain.then(() => this.addNow(guest, song));
    this.addChain = run.catch(() => undefined);
    return run;
  }

  private async addNow(guest: QueueingGuest, song: QueueTrackMetadata): Promise<AddResult> {
    if (!guest.isLive()) return { kind: 'signed-out' };
    let queue = await this.refresh();
    // Restored first, so the songs a replace removed keep their place ahead of this one.
    if (await this.restoreReplaced()) queue = await this.refresh();
    if (!guest.isLive()) return { kind: 'signed-out' };
    if (holdsRadioStream(queue)) return { kind: 'radio' };
    const limit = this.limit();
    if (this.unplayedCount(guest.sessionId) >= limit) return { kind: 'limit', limit };
    if (this.ledger.isWaitingInQueue(queue, song.songId)) return { kind: 'duplicate' };
    // The token is spent only once the append lands, so a failed add leaves the retry its cause.
    const waitMs = this.adds.waitMs(guest.sessionId);
    if (waitMs > 0) return { kind: 'wait', waitMs };

    let entryIds: number[];
    try {
      ({ entryIds } = await this.engine.enqueue([song.songId], 'append', [song], { refuseRadioQueue: true }));
    } catch (err) {
      // A radio stream another client started after the check above.
      if (err instanceof RadioQueueRefusedError) return { kind: 'radio' };
      throw err;
    }
    this.adds.take(guest.sessionId);
    const [entryId] = entryIds;
    if (entryId === undefined) return { kind: 'untracked' };
    this.ledger.record(entryId, { sessionId: guest.sessionId, song, guestLabel: guest.currentLabel(), addedAt: this.now() });
    this.onChange();
    return { kind: 'added', entryId, remaining: this.counts(guest.sessionId).remaining };
  }

  /**
   * A started song is the host's to skip, so a guest removes only its songs that have not started.
   * A stopped mpv holds none of the ledger's entries, so a guest removal never starts it.
   */
  async remove(guest: Pick<QueueingGuest, 'sessionId' | 'isLive'>, entryId: number): Promise<RemoveResult> {
    const { sessionId } = guest;
    if (this.ledger.ownerOf(entryId) !== sessionId) return { kind: 'not-found' };
    await this.refresh();
    if (!guest.isLive()) return { kind: 'signed-out' };
    const songId = this.ledger.songIdOf(entryId);
    if (songId === null || this.ledger.ownerOf(entryId) !== sessionId || !this.engine.isRunning()) return { kind: 'not-found' };
    if (this.ledger.isStarted(entryId)) return { kind: 'started' };

    let removed: boolean;
    try {
      // The engine checks again inside its lock, since the song can start after the refresh above.
      removed = await this.engine.removeQueueEntryById(entryId, { songId, refuseStarted: true });
    } catch (err) {
      if (err instanceof QueueEntryStartedError) return { kind: 'started' };
      throw err;
    }
    // An mpv connection that dropped after the check above still holds the entry, so the record stays.
    if (removed || this.engine.isRunning()) {
      this.ledger.forget(entryId);
      this.onChange();
    }
    return removed ? { kind: 'removed', remaining: this.counts(sessionId).remaining } : { kind: 'not-found' };
  }

  /**
   * The host removes any entry but the playing one. A guest song passes the song id read after the
   * refresh, so an entry that changes song before the engine's lock stays. Its removal frees the guest's slot.
   */
  async removeForHost(entryId: number): Promise<HostRemoveResult> {
    // A record from an earlier mpv instance drops on the refresh, so its song id never guards a new entry.
    if (this.ledger.songIdOf(entryId) !== null) await this.refresh();
    const songId = this.ledger.songIdOf(entryId);
    const guestLabel = this.ledger.guestLabelOf(entryId);
    const options = songId === null ? { refuseStarted: true } : { songId, refuseStarted: true };
    let removed: boolean;
    try {
      removed = await this.engine.removeQueueEntryById(entryId, options);
    } catch (err) {
      if (err instanceof QueueEntryStartedError) return { kind: 'started' };
      throw err;
    }
    // With no mpv attached the record stays, since an mpv re-attached after a dropped connection still holds the entry.
    if (songId !== null && (removed || this.engine.isRunning())) {
      this.ledger.forget(entryId);
      this.onChange();
    }
    return removed ? { kind: 'removed', guestLabel } : { kind: 'not-found' };
  }

  /**
   * Removes a banned guest's songs that have not started, held ones included. It runs behind the adds
   * already queued, so their songs leave too, and an add queued later finds the session gone.
   */
  removeGuestSongs(sessionId: string): Promise<GuestSongRemoval> {
    const run = this.addChain.then(() => this.removeGuestSongsNow(sessionId));
    this.addChain = run.catch(() => undefined);
    return run;
  }

  /**
   * A song that started meanwhile is the host's, so it stays. With no mpv attached the queued songs
   * stay too, since an mpv re-attached after a dropped connection still holds them. The held songs
   * drop either way, so a later replace never restores them.
   */
  private async removeGuestSongsNow(sessionId: string): Promise<GuestSongRemoval> {
    await this.refresh();
    const attached = this.engine.isRunning();
    const entryIds = this.ledger.unplayedEntryIds(sessionId);
    let removed = this.ledger.dropHeld(sessionId);
    let stayed = attached ? 0 : entryIds.length;
    if (attached) {
      for (const entryId of entryIds) {
        const outcome = await this.removeUnstarted(entryId);
        if (outcome === 'removed') removed++;
        if (outcome === 'stayed') stayed++;
      }
    }
    if (removed > 0) this.onChange();
    return { removed, stayed };
  }

  /**
   * Forgets the entry unless it started, so a gone entry stops counting. An mpv that detached during the
   * removal keeps the record, since an mpv re-attached after a dropped connection still holds the entry.
   */
  private async removeUnstarted(entryId: number): Promise<UnstartedRemoval> {
    const songId = this.ledger.songIdOf(entryId);
    if (songId === null) return 'skipped';
    try {
      const removed = await this.engine.removeQueueEntryById(entryId, { songId, refuseStarted: true });
      if (!removed && !this.engine.isRunning()) return 'stayed';
      this.ledger.forget(entryId);
      return removed ? 'removed' : 'skipped';
    } catch (err) {
      if (err instanceof QueueEntryStartedError) return 'skipped';
      throw err;
    }
  }

  /** Also lets the broadcast carry the guest's new nickname to every open page. */
  relabel(sessionId: string, guestLabel: string): void {
    this.ledger.relabel(sessionId, guestLabel);
    this.onChange();
  }

  prune(): void {
    this.searches.prune();
    this.adds.prune();
  }

  /** Lists what `unplayedCount` counts, so the host's guest list and the guest's own count agree. */
  unplayedSongs(sessionId: string): QueueTrackMetadata[] {
    return this.engine.isRunning() ? this.ledger.unplayedSongs(sessionId) : [];
  }

  /**
   * No mpv holds the ledger's entries while none is attached, so none count then. The entries stay,
   * since an mpv re-attached after a dropped connection still holds them.
   */
  private unplayedCount(sessionId: string): number {
    return this.engine.isRunning() ? this.ledger.unplayedCount(sessionId) : 0;
  }

  /**
   * A dropped mpv connection reads as an empty queue, which must not drop every guest song. An add
   * can record its entry while this refresh awaits, so the reconcile skips records newer than the read.
   * The replace marks are read after the playlist, so a replace that removed a song already shows its
   * mark. The generation is read before it too, so a replace that lands between the reads counts next time.
   */
  private async refresh(): Promise<readonly QueueEntry[]> {
    const queueReadSequence = this.ledger.recordSequence();
    const generationBeforeQueueRead = this.engine.isRunning() ? await this.engine.readReplaceGeneration() : null;
    const queue = await this.engine.getQueue();
    if (!this.engine.isRunning()) return queue;
    const paused = await this.engine.readPaused();
    const marks = await this.engine.readReplaceMarks();
    // An mpv attached by the queue read gave no earlier generation.
    const generationBeforeRead = generationBeforeQueueRead ?? marks.generation;
    if (this.ledger.reconcile(queue, paused, queueReadSequence, { ...marks, generationBeforeRead })) this.onChange();
    // Queued behind the adds, so a restore never races an add's limit or duplicate check.
    if (this.ledger.hasRestorable()) {
      this.addChain = this.addChain
        .then(() => this.restoreReplaced())
        .catch((err: unknown) => {
          logger.debug(`webui: guest song restore failed: ${err instanceof Error ? err.message : String(err)}`);
        });
    }
    return queue;
  }

  /**
   * Appends the unplayed guest songs a completed song replace removed, under their sessions. A held
   * song the new queue already holds waiting drops, as the add path refuses a second waiting copy.
   * Returns true when it took any song.
   */
  private async restoreReplaced(): Promise<boolean> {
    if (!this.ledger.hasRestorable()) return false;
    // The read re-attaches after a dropped connection, and never spawns mpv.
    const queue = await this.engine.getQueue();
    const taken = this.ledger.takeRestorable();
    if (taken.length === 0) return false;
    try {
      const songs = taken.filter((guestSong) => !this.ledger.isWaitingInQueue(queue, guestSong.song.songId));
      if (songs.length < taken.length) {
        logger.debug(`webui: ${String(taken.length - songs.length)} replaced guest songs already wait in the new queue, so they drop`);
      }
      // With no mpv to re-attach to, the append would spawn an empty one, so the songs drop instead.
      if (songs.length > 0 && this.engine.isRunning()) await this.appendRestored(songs);
    } finally {
      this.ledger.finishRestore(taken);
    }
    this.onChange();
    return true;
  }

  /**
   * When mpv gives any restored song no id, every restored song stays queued as a plain song. A failed
   * append leaves any song it already appended queued as a plain song.
   */
  private async appendRestored(songs: readonly GuestSong[]): Promise<void> {
    try {
      const { entryIds } = await this.engine.enqueue(
        songs.map((guestSong) => guestSong.song.songId),
        'append',
        songs.map((guestSong) => guestSong.song),
        { refuseRadioQueue: true },
      );
      if (entryIds.length !== songs.length) {
        logger.debug(`webui: ${String(songs.length - entryIds.length)} restored guest song ids missing, so none are tracked`);
        return;
      }
      songs.forEach((guestSong, index) => {
        const entryId = entryIds[index];
        if (entryId !== undefined) this.ledger.record(entryId, guestSong);
      });
    } catch (err) {
      // A radio stream started after the replace refuses the append, as a radio replace drops guest songs.
      const message = `webui: guest songs not restored after a replace: ${err instanceof Error ? err.message : String(err)}`;
      if (err instanceof RadioQueueRefusedError) logger.debug(message);
      else logger.warn(message);
    }
  }

  // One refresh at a time, and events during one coalesce into one more.
  private scheduleRefresh(): void {
    if (this.ledger.isEmpty()) return;
    if (this.refreshing) {
      this.refreshAgain = true;
      return;
    }
    this.refreshing = true;
    void this.drainRefreshes();
  }

  private async drainRefreshes(): Promise<void> {
    try {
      let again = true;
      while (again) {
        this.refreshAgain = false;
        await this.refresh();
        again = this.refreshAgain;
      }
    } catch (err) {
      logger.debug(`webui: guest ledger refresh failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.refreshing = false;
    }
  }
}
