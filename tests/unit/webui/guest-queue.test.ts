// A fake engine holds the queue and the pause state, so each case drives the ledger rules alone.

import { describe, expect, it, vi } from 'vitest';
import {
  QueueEntryStartedError,
  RadioQueueRefusedError,
  REPLACE_GENERATION_PROPERTY,
  REPLACE_PENDING_PROPERTY,
  type QueueEntry,
  type ReplaceMarks,
  type StateChangeEvent,
} from '../../../src/services/playback/playback-engine.js';
import { GuestLedger, type ReplaceReads } from '../../../src/webui/jukebox/guest-ledger.js';
import { logger } from '../../../src/utils/logger.js';
import { GuestQueue } from '../../../src/webui/jukebox/guest-queue.js';

interface FakeEngine {
  queue: QueueEntry[];
  paused: boolean | null;
  running: boolean;
  marks: ReplaceMarks;
  /** Entry ids the next enqueue reports, or null to report the next id in sequence. */
  reportIds: number[] | null;
  enqueue: ReturnType<typeof vi.fn>;
  getQueue: ReturnType<typeof vi.fn>;
  isRunning: () => boolean;
  readPaused: ReturnType<typeof vi.fn>;
  readReplaceGeneration: ReturnType<typeof vi.fn>;
  readReplaceMarks: ReturnType<typeof vi.fn>;
  removeQueueEntryById: ReturnType<typeof vi.fn>;
  onStateChange: (handler: (event: StateChangeEvent) => void) => () => void;
  emit: (event: StateChangeEvent) => void;
}

const NO_REPLACE: ReplaceMarks = { generation: 0, pending: false };
const NO_REPLACE_READS: ReplaceReads = { ...NO_REPLACE, generationBeforeRead: 0 };

function entry(entryId: number, songId: string | null, isCurrent = false): QueueEntry {
  return { index: 0, entryId, songId, isCurrent, isPlaying: isCurrent };
}

function reindex(queue: QueueEntry[]): void {
  queue.forEach((queued, index) => { queued.index = index; });
}

function fakeEngine(queue: QueueEntry[] = [], paused: boolean | null = false): FakeEngine {
  let nextId = 100;
  const handlers: Array<(event: StateChangeEvent) => void> = [];
  const engine: FakeEngine = {
    queue,
    paused,
    running: true,
    marks: { ...NO_REPLACE },
    reportIds: null,
    enqueue: vi.fn((songIds: string[]) => {
      const entryIds = songIds.map((songId) => {
        const entryId = nextId++;
        engine.queue.push(entry(entryId, songId));
        return entryId;
      });
      reindex(engine.queue);
      return Promise.resolve({ demoted: false, outputMissing: null, entryIds: engine.reportIds ?? entryIds });
    }),
    getQueue: vi.fn(() => Promise.resolve(engine.queue.map((queued) => ({ ...queued })))),
    isRunning: () => engine.running,
    readPaused: vi.fn(() => Promise.resolve(engine.paused)),
    readReplaceGeneration: vi.fn(() => Promise.resolve(engine.marks.generation)),
    readReplaceMarks: vi.fn(() => Promise.resolve({ ...engine.marks })),
    removeQueueEntryById: vi.fn((entryId: number) => {
      const index = engine.queue.findIndex((queued) => queued.entryId === entryId);
      if (index < 0) return Promise.resolve(false);
      engine.queue.splice(index, 1);
      reindex(engine.queue);
      return Promise.resolve(true);
    }),
    onStateChange: (handler) => {
      handlers.push(handler);
      return () => undefined;
    },
    emit: (event) => { for (const handler of handlers) handler(event); },
  };
  reindex(queue);
  return engine;
}

const ANA = { sessionId: 'session-ana', isHost: false, currentLabel: () => 'Ana', isLive: () => true };
const BO = { sessionId: 'session-bo', isHost: false, currentLabel: () => 'Guest 2', isLive: () => true };

function song(songId: string): { songId: string; title: string } {
  return { songId, title: `Title ${songId}` };
}

function guestQueue(engine: FakeEngine, limit = 3): GuestQueue {
  return new GuestQueue(engine as never, () => limit);
}

describe('GuestLedger', () => {
  const record = (ledger: GuestLedger, entryId: number, songId: string, sessionId = 'session-ana'): void => {
    ledger.record(entryId, { sessionId, song: { songId }, addedBy: 'Ana', byHost: false, addedAt: 0 });
  };

  it('drops an entry mpv no longer holds, and one whose id now names another song', () => {
    const ledger = new GuestLedger();
    record(ledger, 1, 'so-1');
    record(ledger, 2, 'so-2');
    record(ledger, 3, 'so-3');
    const queue = [entry(2, 'so-2'), entry(3, 'so-other')];
    reindex(queue);

    expect(ledger.reconcile(queue, false, ledger.recordSequence(), NO_REPLACE_READS)).toBe(true);

    expect([1, 2, 3].map((id) => ledger.ownerOf(id))).toEqual([null, 'session-ana', null]);
  });

  it.each([
    ['unpaused', false, true],
    ['paused, as an append onto a queue with no current entry selects it', true, false],
    ['in an unknown pause state', null, false],
  ])('starts the current entry only while mpv plays: %s', (_label, paused, started) => {
    const ledger = new GuestLedger();
    record(ledger, 1, 'so-1');

    ledger.reconcile([entry(1, 'so-1', true)], paused, ledger.recordSequence(), NO_REPLACE_READS);

    expect(ledger.isStarted(1)).toBe(started);
    expect(ledger.unplayedEntryIds('session-ana')).toEqual(started ? [] : [1]);
  });

  it('leaves alone an entry recorded after the queue read began', () => {
    const ledger = new GuestLedger();
    record(ledger, 1, 'so-1');
    const queueReadSequence = ledger.recordSequence();
    record(ledger, 2, 'so-2');

    expect(ledger.reconcile([], false, queueReadSequence, NO_REPLACE_READS)).toBe(true);

    expect([1, 2].map((id) => ledger.ownerOf(id))).toEqual([null, 'session-ana']);
  });

  it('keeps a started entry started after it stops being current', () => {
    const ledger = new GuestLedger();
    record(ledger, 1, 'so-1');
    ledger.reconcile([entry(1, 'so-1', true)], false, ledger.recordSequence(), NO_REPLACE_READS);

    const queue = [entry(1, 'so-1'), entry(2, 'so-2', true)];
    reindex(queue);
    expect(ledger.reconcile(queue, true, ledger.recordSequence(), NO_REPLACE_READS)).toBe(false);

    expect(ledger.isStarted(1)).toBe(true);
  });

  it("renames the guest's own songs, held ones included, and no other guest's", () => {
    const ledger = new GuestLedger();
    record(ledger, 1, 'so-1');
    record(ledger, 2, 'so-2');
    record(ledger, 3, 'so-3', 'session-bo');
    const queue = [entry(2, 'so-2'), entry(3, 'so-3')];
    // Entry 1 left the queue under a pending replace, so the ledger holds it.
    ledger.reconcile(queue, false, ledger.recordSequence(), { generation: 0, pending: true, generationBeforeRead: 0 });
    expect(ledger.addedByOf(1)).toBeNull();

    ledger.relabel('session-ana', 'Anna');
    ledger.reconcile(queue, false, ledger.recordSequence(), { generation: 1, pending: false, generationBeforeRead: 1 });

    expect([2, 3].map((id) => ledger.addedByOf(id))).toEqual(['Anna', 'Ana']);
    expect(ledger.takeRestorable().map((held) => [held.song.songId, held.addedBy])).toEqual([['so-1', 'Anna']]);
  });

  it('lists the names on queued and held songs by whether the host or a guest added them', () => {
    const ledger = new GuestLedger();
    record(ledger, 1, 'so-1');
    ledger.record(2, { sessionId: null, song: { songId: 'so-2' }, addedBy: 'Host', byHost: true, addedAt: 0 });
    ledger.reconcile([entry(2, 'so-2')], false, ledger.recordSequence(), { generation: 0, pending: true, generationBeforeRead: 0 });

    expect(ledger.addedByOf(1)).toBeNull();
    expect(ledger.addedByNames()).toEqual({ host: ['Host'], guest: ['Ana'] });
  });

  it('stops renaming the songs takeRestorable returned once finishRestore ends their tracking', () => {
    const ledger = new GuestLedger();
    record(ledger, 1, 'so-1');
    // Entry 1 left the queue under a pending replace, so the ledger holds it.
    ledger.reconcile([], false, ledger.recordSequence(), { generation: 0, pending: true, generationBeforeRead: 0 });
    ledger.reconcile([], false, ledger.recordSequence(), { generation: 1, pending: false, generationBeforeRead: 1 });
    const taken = ledger.takeRestorable();

    ledger.relabel('session-ana', 'Anna');
    expect(taken.map((held) => held.addedBy)).toEqual(['Anna']);

    ledger.finishRestore(taken);
    ledger.relabel('session-ana', 'Ann');
    expect(taken.map((held) => held.addedBy)).toEqual(['Anna']);
  });

  it('reads a host song as waiting only after the current entry, and a guest song until it starts', () => {
    const ledger = new GuestLedger();
    record(ledger, 1, 'guest-current');
    const queue = [entry(9, 'played'), entry(1, 'guest-current', true), entry(10, 'next')];
    reindex(queue);

    expect(ledger.isWaitingInQueue(queue, 'next')).toBe(true);
    expect(ledger.isWaitingInQueue(queue, 'played')).toBe(false);
    expect(ledger.isWaitingInQueue(queue, 'guest-current')).toBe(true);
    ledger.reconcile(queue, false, ledger.recordSequence(), NO_REPLACE_READS);
    expect(ledger.isWaitingInQueue(queue, 'guest-current')).toBe(false);
  });

  it('holds a guest page song a replace removed but drops an admin page song, so only the guest page song returns', () => {
    const ledger = new GuestLedger();
    record(ledger, 1, 'so-1');
    ledger.record(2, { sessionId: null, song: { songId: 'so-2' }, addedBy: 'Host', byHost: true, addedAt: 0 });

    ledger.reconcile([], false, ledger.recordSequence(), { generation: 0, pending: true, generationBeforeRead: 0 });
    ledger.reconcile([], false, ledger.recordSequence(), { generation: 1, pending: false, generationBeforeRead: 1 });

    expect(ledger.takeRestorable().map((held) => held.song.songId)).toEqual(['so-1']);
    expect(ledger.addedByOf(2)).toBeNull();
  });

  it('tells a guest page song from an admin page song, and counts only the guest page song for its session', () => {
    const ledger = new GuestLedger();
    record(ledger, 1, 'so-1');
    ledger.record(2, { sessionId: null, song: { songId: 'so-2' }, addedBy: 'Host', byHost: true, addedAt: 0 });

    expect([1, 2, 3].map((id) => ledger.isFromGuestPage(id))).toEqual([true, false, false]);
    expect(ledger.addedByOf(2)).toBe('Host');
    expect(ledger.unplayedCount('session-ana')).toBe(1);
  });

  it('reads an admin page song as waiting only after the current entry, like an unlabeled song', () => {
    const ledger = new GuestLedger();
    ledger.record(1, { sessionId: null, song: { songId: 'skipped' }, addedBy: 'Host', byHost: true, addedAt: 0 });
    ledger.record(3, { sessionId: null, song: { songId: 'next' }, addedBy: 'Host', byHost: true, addedAt: 0 });
    const queue = [entry(1, 'skipped'), entry(2, 'current', true), entry(3, 'next')];
    reindex(queue);

    expect(ledger.isWaitingInQueue(queue, 'skipped')).toBe(false);
    expect(ledger.isWaitingInQueue(queue, 'next')).toBe(true);
  });

  it('reads a started guest page song as waiting again once the host goes back before it, since it plays again', () => {
    const ledger = new GuestLedger();
    record(ledger, 2, 'guest-song');
    const playing = [entry(1, 'earlier'), entry(2, 'guest-song', true)];
    const wentBack = [entry(1, 'earlier', true), entry(2, 'guest-song')];
    reindex(playing);
    reindex(wentBack);
    ledger.reconcile(playing, false, ledger.recordSequence(), NO_REPLACE_READS);

    expect(ledger.isWaitingInQueue(playing, 'guest-song')).toBe(false);
    expect(ledger.isWaitingInQueue(wentBack, 'guest-song')).toBe(true);
    expect(wentBack.map(ledger.waitingRule(wentBack))).toEqual([false, true]);
    expect(ledger.unplayedCount('session-ana')).toBe(0);
  });
});

describe('GuestQueue.labelAdminPageSongs', () => {
  it('labels each loaded song Host under no session, and tells the pages', () => {
    const guests = guestQueue(fakeEngine([]));
    const onChange = vi.fn();
    guests.watch(onChange);

    guests.labelAdminPageSongs([7, 8], [song('so-1'), song('so-2')]);

    expect([7, 8].map((id) => [guests.ledger.addedByOf(id), guests.ledger.ownerOf(id)])).toEqual([['Host', null], ['Host', null]]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('labels none when mpv gave a song no id, since the ids no longer line up with the songs', () => {
    const guests = guestQueue(fakeEngine([]));

    guests.labelAdminPageSongs([7], [song('so-1'), song('so-2')]);

    expect(guests.ledger.isEmpty()).toBe(true);
  });

  it('drops the admin page songs mpv no longer holds with one queue read, and reads none on an mpv event after that', async () => {
    const engine = fakeEngine([{ ...entry(8, 'so-2'), index: 0 }]);
    const guests = guestQueue(engine);
    guests.labelAdminPageSongs([7], [song('so-1')]);
    guests.labelAdminPageSongs([8], [song('so-2')]);

    await vi.waitFor(() => { expect(guests.ledger.addedByOf(7)).toBeNull(); });
    const reads = engine.getQueue.mock.calls.length;
    engine.emit({ kind: 'queue' });
    await Promise.resolve();

    expect(guests.ledger.addedByOf(8)).toBe('Host');
    expect(engine.getQueue.mock.calls.length).toBe(reads);
  });
});

describe('GuestQueue.add', () => {
  it('appends with the song metadata, records the entry and counts the slot', async () => {
    const engine = fakeEngine([entry(1, 'host-song', true)]);
    const guests = guestQueue(engine);

    const result = await guests.add(ANA, song('so-1'));

    expect(result).toEqual({ kind: 'added', entryId: 100, remaining: 2 });
    expect(engine.enqueue).toHaveBeenCalledWith(['so-1'], 'append', [song('so-1')], { refuseRadioQueue: true });
    expect(guests.ledger.ownerOf(100)).toBe('session-ana');
    expect(guests.ledger.addedByOf(100)).toBe('Ana');
  });

  it('records the label the guest holds when the append lands, not the one it held when the add began', async () => {
    const engine = fakeEngine([entry(1, 'host-song', true)]);
    const guests = guestQueue(engine);
    let label = 'Ana';
    let releaseAppend: (() => void) | undefined;
    engine.enqueue.mockImplementationOnce(() => new Promise((resolve) => {
      releaseAppend = () => resolve({ demoted: false, outputMissing: null, entryIds: [100] });
    }));

    const pending = guests.add({ ...ANA, currentLabel: () => label }, song('so-1'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    label = 'Anna';
    guests.relabel(ANA.sessionId, label);
    releaseAppend?.();
    await pending;

    expect(guests.ledger.addedByOf(100)).toBe('Anna');
  });

  it('refuses while a radio stream plays, before it spends a rate token', async () => {
    const engine = fakeEngine([entry(1, null, true)]);
    const guests = guestQueue(engine);

    expect(await guests.add(ANA, song('so-1'))).toEqual({ kind: 'radio' });
    engine.queue = [];
    expect((await guests.add(ANA, song('so-1'))).kind).toBe('added');
    expect(engine.enqueue).toHaveBeenCalledTimes(1);
  });

  it('answers radio, and records nothing, when a radio stream starts after the check', async () => {
    const engine = fakeEngine([entry(1, 'host-song', true)]);
    engine.enqueue.mockRejectedValueOnce(new RadioQueueRefusedError());
    const guests = guestQueue(engine);

    expect(await guests.add(ANA, song('so-1'))).toEqual({ kind: 'radio' });
    expect(engine.enqueue).toHaveBeenCalledWith(['so-1'], 'append', [song('so-1')], { refuseRadioQueue: true });
    expect(guests.ledger.isEmpty()).toBe(true);
  });

  it('refuses a guest at its limit, while another guest still adds', async () => {
    const engine = fakeEngine([entry(1, 'host-song', true)]);
    const guests = guestQueue(engine, 1);
    await guests.add(ANA, song('so-1'));

    expect(await guests.add(ANA, song('so-2'))).toEqual({ kind: 'limit', limit: 1 });
    expect((await guests.add(BO, song('so-2'))).kind).toBe('added');
  });

  it('refuses a song already waiting in the queue', async () => {
    const engine = fakeEngine([entry(1, 'host-song', true), entry(2, 'so-1')]);
    const guests = guestQueue(engine);

    expect(await guests.add(ANA, song('so-1'))).toEqual({ kind: 'duplicate' });
    expect(engine.enqueue).not.toHaveBeenCalled();
  });

  it('runs adds one at a time, so two guests adding one song at once append it once', async () => {
    const engine = fakeEngine([entry(1, 'host-song', true)]);
    const guests = guestQueue(engine);

    const results = await Promise.all([guests.add(ANA, song('so-1')), guests.add(BO, song('so-1'))]);

    expect(results.map((result) => result.kind)).toEqual(['added', 'duplicate']);
    expect(engine.enqueue).toHaveBeenCalledTimes(1);
  });

  it('allows one add per guest every 5 seconds', async () => {
    const engine = fakeEngine([entry(1, 'host-song', true)]);
    const guests = guestQueue(engine);
    await guests.add(ANA, song('so-1'));

    const second = await guests.add(ANA, song('so-2'));

    expect(second.kind).toBe('wait');
    expect(second.kind === 'wait' && second.waitMs > 0 && second.waitMs <= 5000).toBe(true);
    expect(engine.enqueue).toHaveBeenCalledTimes(1);
  });

  it('keeps the rate token when the append fails, so the retry is not refused', async () => {
    const engine = fakeEngine([entry(1, 'host-song', true)]);
    engine.enqueue.mockRejectedValueOnce(new Error('mpv IPC timeout'));
    const guests = guestQueue(engine);

    await expect(guests.add(ANA, song('so-1'))).rejects.toThrow('mpv IPC timeout');

    expect((await guests.add(ANA, song('so-1'))).kind).toBe('added');
  });

  it('refuses a signed-out guest before it reads the queue or spends a rate token', async () => {
    const engine = fakeEngine([entry(1, 'host-song', true)]);
    const guests = guestQueue(engine);

    expect(await guests.add({ ...ANA, isLive: () => false }, song('so-1'))).toEqual({ kind: 'signed-out' });
    expect(engine.getQueue).not.toHaveBeenCalled();
    expect(engine.enqueue).not.toHaveBeenCalled();
    expect((await guests.add(ANA, song('so-1'))).kind).toBe('added');
  });

  it('refuses a guest whose session ended while the queue was read, so its song never lands', async () => {
    const engine = fakeEngine([entry(1, 'host-song', true)]);
    const guests = guestQueue(engine);
    let live = true;
    engine.getQueue.mockImplementationOnce(() => {
      live = false;
      return Promise.resolve(engine.queue.map((queued) => ({ ...queued })));
    });

    expect(await guests.add({ ...ANA, isLive: () => live }, song('so-1'))).toEqual({ kind: 'signed-out' });
    expect(engine.enqueue).not.toHaveBeenCalled();
    expect(guests.counts(ANA.sessionId).remaining).toBe(3);
  });

  it('records nothing when mpv reports no entry id', async () => {
    const engine = fakeEngine([entry(1, 'host-song', true)]);
    engine.reportIds = [];
    const guests = guestQueue(engine);

    expect(await guests.add(ANA, song('so-1'))).toEqual({ kind: 'untracked' });
    expect(guests.ledger.isEmpty()).toBe(true);
  });

  it('frees the slot once the song is current while mpv plays', async () => {
    const engine = fakeEngine([entry(1, 'host-song', true)]);
    const guests = guestQueue(engine, 1);
    const onChange = vi.fn();
    guests.watch(onChange);
    await guests.add(ANA, song('so-1'));
    expect(guests.counts(ANA.sessionId)).toEqual({ limit: 1, remaining: 0 });

    engine.queue = [entry(1, 'host-song'), entry(100, 'so-1', true)];
    reindex(engine.queue);
    engine.emit({ kind: 'property', name: 'playlist-pos', data: 1 });

    await vi.waitFor(() => { expect(guests.counts(ANA.sessionId).remaining).toBe(1); });
    expect(onChange).toHaveBeenCalled();
  });

  it('frees the slot when another client removes the song', async () => {
    const engine = fakeEngine([entry(1, 'host-song', true)]);
    const guests = guestQueue(engine, 1);
    guests.watch(() => undefined);
    await guests.add(ANA, song('so-1'));

    engine.queue = [entry(1, 'host-song', true)];
    engine.emit({ kind: 'queue' });

    await vi.waitFor(() => { expect(guests.counts(ANA.sessionId).remaining).toBe(1); });
  });

  it('keeps every guest song but counts none while no mpv is attached', async () => {
    const engine = fakeEngine([entry(1, 'host-song', true)]);
    const guests = guestQueue(engine, 1);
    await guests.add(ANA, song('so-1'));
    engine.running = false;
    engine.queue = [];

    expect(guests.counts(ANA.sessionId)).toEqual({ limit: 1, remaining: 1 });
    // The limit check runs before the rate check, so a rate refusal shows the limit passed.
    expect((await guests.add(ANA, song('so-2'))).kind).toBe('wait');
    expect(guests.ledger.ownerOf(100)).toBe(ANA.sessionId);
  });

  it('keeps a song added while a background refresh awaits its pause read', async () => {
    const engine = fakeEngine([entry(1, 'host-song', true)]);
    const guests = guestQueue(engine);
    guests.watch(() => undefined);
    await guests.add(ANA, song('so-1'));
    let releasePause: (paused: boolean) => void = () => undefined;
    engine.readPaused.mockImplementationOnce(() => new Promise<boolean>((resolve) => { releasePause = resolve; }));
    engine.emit({ kind: 'queue' });
    await vi.waitFor(() => { expect(engine.readPaused).toHaveBeenCalledTimes(2); });

    expect(await guests.add(BO, song('so-2'))).toMatchObject({ kind: 'added', entryId: 101 });
    releasePause(false);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(guests.ledger.unplayedEntryIds(BO.sessionId)).toEqual([101]);
    expect(guests.counts(BO.sessionId).remaining).toBe(2);
  });

  it('reports remaining as 0, not below, when the host lowers the limit under a guest count', async () => {
    let limit = 3;
    const engine = fakeEngine([entry(1, 'host-song', true)]);
    const guests = new GuestQueue(engine as never, () => limit);
    await guests.add(ANA, song('so-1'));
    limit = 1;
    guests.ledger.record(7, { sessionId: ANA.sessionId, song: { songId: 'so-7' }, addedBy: 'Ana', byHost: false, addedAt: 0 });

    expect(guests.counts(ANA.sessionId)).toEqual({ limit: 1, remaining: 0 });
  });
});

describe('GuestQueue.remove', () => {
  async function queuedByAna(): Promise<{ engine: FakeEngine; guests: GuestQueue }> {
    const engine = fakeEngine([entry(1, 'host-song', true)]);
    const guests = guestQueue(engine);
    await guests.add(ANA, song('so-1'));
    return { engine, guests };
  }

  it('removes the guest song and frees its slot', async () => {
    const { engine, guests } = await queuedByAna();

    expect(await guests.remove(ANA, 100)).toEqual({ kind: 'removed', remaining: 3 });
    expect(engine.removeQueueEntryById).toHaveBeenCalledWith(100, { songId: 'so-1', refuseStarted: true });
    expect(guests.ledger.ownerOf(100)).toBeNull();
  });

  it("refuses another guest's song without touching mpv", async () => {
    const { engine, guests } = await queuedByAna();

    expect(await guests.remove(BO, 100)).toEqual({ kind: 'not-found' });
    expect(await guests.remove(ANA, 1)).toEqual({ kind: 'not-found' });
    expect(engine.removeQueueEntryById).not.toHaveBeenCalled();
  });

  it('refuses a song that started playing, since removing it would skip it', async () => {
    const { engine, guests } = await queuedByAna();
    engine.queue = [entry(1, 'host-song'), entry(100, 'so-1', true)];
    reindex(engine.queue);

    expect(await guests.remove(ANA, 100)).toEqual({ kind: 'started' });
    expect(engine.removeQueueEntryById).not.toHaveBeenCalled();
  });

  it('answers started when the song starts between the refresh and the locked removal', async () => {
    const { engine, guests } = await queuedByAna();
    engine.removeQueueEntryById.mockRejectedValueOnce(new QueueEntryStartedError(100));

    expect(await guests.remove(ANA, 100)).toEqual({ kind: 'started' });
    expect(guests.ledger.ownerOf(100)).toBe('session-ana');
  });

  it('answers not-found without starting mpv when mpv is not running', async () => {
    const { engine, guests } = await queuedByAna();
    engine.running = false;

    expect(await guests.remove(ANA, 100)).toEqual({ kind: 'not-found' });
    expect(engine.removeQueueEntryById).not.toHaveBeenCalled();
  });

  it('answers signed-out and keeps the song when the session ended while the queue was read', async () => {
    const { engine, guests } = await queuedByAna();
    let live = true;
    const onChange = vi.fn();
    guests.watch(onChange);
    engine.getQueue.mockImplementationOnce(() => {
      live = false;
      return Promise.resolve(engine.queue.map((queued) => ({ ...queued })));
    });

    expect(await guests.remove({ ...ANA, isLive: () => live }, 100)).toEqual({ kind: 'signed-out' });
    expect(engine.removeQueueEntryById).not.toHaveBeenCalled();
    expect(guests.ledger.ownerOf(100)).toBe('session-ana');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('answers not-found once the song left the queue', async () => {
    const { engine, guests } = await queuedByAna();
    engine.queue = [entry(1, 'host-song', true)];

    expect(await guests.remove(ANA, 100)).toEqual({ kind: 'not-found' });
    expect(engine.removeQueueEntryById).not.toHaveBeenCalled();
  });
});

describe('GuestQueue across a host replace', () => {
  const CY = { sessionId: 'session-cy', isHost: false, currentLabel: () => 'Guest 3', isLive: () => true };
  const DEE = { sessionId: 'session-dee', isHost: false, currentLabel: () => 'Guest 4', isLive: () => true };
  const GENERATION_RISE: StateChangeEvent = { kind: 'property', name: REPLACE_GENERATION_PROPERTY, data: 1 };

  /** Ana, Bo and Cy each queue one song after the host song, as entries 100, 101 and 102. */
  async function threeGuestSongs(limit = 1): Promise<{ engine: FakeEngine; guests: GuestQueue; onChange: ReturnType<typeof vi.fn> }> {
    const engine = fakeEngine([entry(1, 'host-song', true)]);
    const guests = guestQueue(engine, limit);
    const onChange = vi.fn();
    guests.watch(onChange);
    for (const [guest, songId] of [[ANA, 'so-1'], [BO, 'so-2'], [CY, 'so-3']] as const) {
      expect((await guests.add(guest, song(songId))).kind).toBe('added');
    }
    return { engine, guests, onChange };
  }

  function replaceQueue(engine: FakeEngine, marks: ReplaceMarks): void {
    engine.queue = [entry(200, 'new-1', true), entry(201, 'new-2')];
    reindex(engine.queue);
    engine.marks = marks;
  }

  const songIds = (engine: FakeEngine): Array<string | null> => engine.queue.map((queued) => queued.songId);
  const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

  it.each([
    ['an MCP process, seen as a generation rise', GENERATION_RISE],
    ['the web player process, seen as its own queue event', { kind: 'queue' } as StateChangeEvent],
  ])('appends the unplayed guest songs after a song replace from %s, in add order', async (_label, event) => {
    const { engine, guests } = await threeGuestSongs();

    replaceQueue(engine, { generation: 1, pending: false });
    engine.emit(event);

    await vi.waitFor(() => { expect(songIds(engine)).toEqual(['new-1', 'new-2', 'so-1', 'so-2', 'so-3']); });
    expect(engine.enqueue).toHaveBeenLastCalledWith(['so-1', 'so-2', 'so-3'], 'append', [song('so-1'), song('so-2'), song('so-3')], { refuseRadioQueue: true });
    expect([103, 104, 105].map((id) => guests.ledger.ownerOf(id))).toEqual([ANA.sessionId, BO.sessionId, CY.sessionId]);
    expect(guests.ledger.addedByOf(103)).toBe('Ana');
    expect(guests.counts(ANA.sessionId)).toEqual({ limit: 1, remaining: 0 });
  });

  it('holds the songs and their slots when the playlist clear arrives before the generation rises', async () => {
    const { engine, guests } = await threeGuestSongs();

    replaceQueue(engine, { generation: 0, pending: true });
    engine.emit({ kind: 'property', name: 'playlist-count', data: 2 });
    await vi.waitFor(() => { expect(guests.ledger.ownerOf(100)).toBeNull(); });

    expect(guests.counts(ANA.sessionId)).toEqual({ limit: 1, remaining: 0 });
    expect(await guests.add(DEE, song('so-2'))).toEqual({ kind: 'duplicate' });
    expect(engine.enqueue).toHaveBeenCalledTimes(3);

    engine.marks = { generation: 1, pending: false };
    engine.emit(GENERATION_RISE);

    await vi.waitFor(() => { expect(songIds(engine)).toEqual(['new-1', 'new-2', 'so-1', 'so-2', 'so-3']); });
    expect(guests.ledger.unplayedEntryIds(BO.sessionId)).toEqual([104]);
  });

  it('restores the held songs before a guest add that arrives after the replace completed', async () => {
    const { engine, guests } = await threeGuestSongs();
    replaceQueue(engine, { generation: 1, pending: false });

    expect(await guests.add(DEE, song('so-9'))).toMatchObject({ kind: 'added', entryId: 106 });

    expect(songIds(engine)).toEqual(['new-1', 'new-2', 'so-1', 'so-2', 'so-3', 'so-9']);
    await settle();
    expect(engine.enqueue).toHaveBeenCalledTimes(5);
  });

  it('records the label a guest holds when the restore append lands, not the one it held when the songs were taken', async () => {
    const { engine, guests } = await threeGuestSongs();
    let releaseAppend: (() => void) | undefined;
    engine.enqueue.mockImplementationOnce(() => new Promise((resolve) => {
      releaseAppend = () => resolve({ demoted: false, outputMissing: null, entryIds: [103, 104, 105] });
    }));
    replaceQueue(engine, { generation: 1, pending: false });

    engine.emit(GENERATION_RISE);
    await vi.waitFor(() => { expect(engine.enqueue).toHaveBeenCalledTimes(4); });
    guests.relabel(ANA.sessionId, 'Anna');
    releaseAppend?.();

    await vi.waitFor(() => { expect(guests.ledger.ownerOf(103)).toBe(ANA.sessionId); });
    expect([103, 104, 105].map((id) => guests.ledger.addedByOf(id))).toEqual(['Anna', 'Guest 2', 'Guest 3']);
  });

  it.each([
    ['a radio replace', (engine: FakeEngine): void => { engine.queue = [entry(200, null, true)]; }],
    ['a clear', (engine: FakeEngine): void => { engine.queue = []; }],
    ['a removal of single entries', (engine: FakeEngine): void => { engine.queue = engine.queue.filter((queued) => queued.entryId === 1); }],
    ['a song replace from a release that never raises the generation', (engine: FakeEngine): void => { replaceQueue(engine, NO_REPLACE); }],
  ])('drops the removed guest songs and frees their slots after %s', async (_label, change) => {
    const { engine, guests } = await threeGuestSongs();

    change(engine);
    reindex(engine.queue);
    engine.emit({ kind: 'queue' });

    await vi.waitFor(() => { expect(guests.counts(ANA.sessionId).remaining).toBe(1); });
    await settle();
    expect(guests.ledger.isEmpty()).toBe(true);
    expect(engine.enqueue).toHaveBeenCalledTimes(3);
  });

  it('drops the held songs when the replace fails and clears its pending mark with no rise', async () => {
    const { engine, guests } = await threeGuestSongs();
    replaceQueue(engine, { generation: 0, pending: true });
    engine.emit({ kind: 'queue' });
    await vi.waitFor(() => { expect(guests.ledger.ownerOf(100)).toBeNull(); });

    engine.queue = [];
    engine.marks = NO_REPLACE;
    engine.emit({ kind: 'property', name: REPLACE_PENDING_PROPERTY, data: false });

    await vi.waitFor(() => { expect(guests.ledger.isEmpty()).toBe(true); });
    expect(guests.counts(BO.sessionId).remaining).toBe(1);
    expect(engine.enqueue).toHaveBeenCalledTimes(3);
  });

  it('drops the held songs, without an error, when a radio stream refuses the restore', async () => {
    const { engine, guests, onChange } = await threeGuestSongs();
    engine.enqueue.mockRejectedValueOnce(new RadioQueueRefusedError());
    onChange.mockClear();

    replaceQueue(engine, { generation: 1, pending: false });
    engine.emit(GENERATION_RISE);

    await vi.waitFor(() => { expect(guests.ledger.isEmpty()).toBe(true); });
    expect(engine.enqueue).toHaveBeenCalledTimes(4);
    expect(guests.counts(CY.sessionId).remaining).toBe(1);
    expect(onChange).toHaveBeenCalled();
  });

  it('leaves out a guest song that had started before the replace', async () => {
    const { engine, guests } = await threeGuestSongs();
    engine.queue = [entry(1, 'host-song'), entry(100, 'so-1', true), entry(101, 'so-2'), entry(102, 'so-3')];
    reindex(engine.queue);
    engine.emit({ kind: 'property', name: 'playlist-pos', data: 1 });
    await vi.waitFor(() => { expect(guests.ledger.isStarted(100)).toBe(true); });

    replaceQueue(engine, { generation: 1, pending: false });
    engine.emit(GENERATION_RISE);

    await vi.waitFor(() => { expect(songIds(engine)).toEqual(['new-1', 'new-2', 'so-2', 'so-3']); });
    expect(guests.counts(ANA.sessionId).remaining).toBe(1);
  });

  it('keeps the held songs across a re-attach to the same mpv, and restores them once the replace completes', async () => {
    const { engine, guests } = await threeGuestSongs();
    replaceQueue(engine, { generation: 0, pending: true });
    engine.emit({ kind: 'queue' });
    await vi.waitFor(() => { expect(guests.ledger.ownerOf(100)).toBeNull(); });

    engine.emit({ kind: 'attach' });
    expect(guests.counts(ANA.sessionId).remaining).toBe(0);

    engine.marks = { generation: 1, pending: false };
    engine.emit(GENERATION_RISE);

    await vi.waitFor(() => { expect(songIds(engine)).toEqual(['new-1', 'new-2', 'so-1', 'so-2', 'so-3']); });
  });

  it('drops the held songs when a new mpv attaches, since it numbers its generation from 0 again', async () => {
    const { engine, guests } = await threeGuestSongs();
    replaceQueue(engine, { generation: 1, pending: false });
    engine.emit(GENERATION_RISE);
    await vi.waitFor(() => { expect(guests.ledger.ownerOf(103)).toBe(ANA.sessionId); });

    replaceQueue(engine, { generation: 1, pending: true });
    engine.emit({ kind: 'queue' });
    await vi.waitFor(() => { expect(guests.ledger.ownerOf(103)).toBeNull(); });

    engine.queue = [entry(1, 'other-song', true)];
    engine.marks = NO_REPLACE;
    engine.emit({ kind: 'attach' });
    engine.emit({ kind: 'queue' });

    await vi.waitFor(() => { expect(guests.ledger.isEmpty()).toBe(true); });
    await settle();
    expect(guests.counts(ANA.sessionId).remaining).toBe(1);
    expect(engine.enqueue).toHaveBeenCalledTimes(4);
  });

  it('restores the songs when the replace completes between the playlist read and the marks read', async () => {
    const { engine } = await threeGuestSongs();
    engine.getQueue.mockImplementationOnce(() => {
      const beforeReplace = engine.queue.map((queued) => ({ ...queued }));
      replaceQueue(engine, { generation: 1, pending: false });
      return Promise.resolve(beforeReplace);
    });
    engine.emit({ kind: 'queue' });
    await settle();

    engine.emit(GENERATION_RISE);

    await vi.waitFor(() => { expect(songIds(engine)).toEqual(['new-1', 'new-2', 'so-1', 'so-2', 'so-3']); });
  });

  it('restores the songs untracked when mpv gives any of them no id', async () => {
    const { engine, guests } = await threeGuestSongs();
    engine.reportIds = [103];

    replaceQueue(engine, { generation: 1, pending: false });
    engine.emit(GENERATION_RISE);

    await vi.waitFor(() => { expect(songIds(engine)).toEqual(['new-1', 'new-2', 'so-1', 'so-2', 'so-3']); });
    expect(guests.ledger.ownerOf(103)).toBeNull();
    expect(guests.ledger.isEmpty()).toBe(true);
    expect(guests.counts(ANA.sessionId).remaining).toBe(1);
  });

  it('drops the held songs with a warning when the restore append fails', async () => {
    const { engine, guests } = await threeGuestSongs();
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    engine.enqueue.mockRejectedValueOnce(new Error('loadfile failed'));

    replaceQueue(engine, { generation: 1, pending: false });
    engine.emit(GENERATION_RISE);

    await vi.waitFor(() => { expect(guests.ledger.isEmpty()).toBe(true); });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('guest songs not restored after a replace: loadfile failed'));
    expect(guests.counts(ANA.sessionId).remaining).toBe(1);
    warn.mockRestore();
  });

  it('stops renaming the songs a failed restore append dropped', async () => {
    const { engine, guests } = await threeGuestSongs();
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const takeRestorable = vi.spyOn(guests.ledger, 'takeRestorable');
    engine.enqueue.mockRejectedValueOnce(new Error('loadfile failed'));

    replaceQueue(engine, { generation: 1, pending: false });
    engine.emit(GENERATION_RISE);
    await vi.waitFor(() => { expect(guests.ledger.isEmpty()).toBe(true); });

    const dropped = takeRestorable.mock.results.flatMap((result) => (result.type === 'return' ? result.value : []));
    expect(dropped.map((guestSong) => guestSong.addedBy)).toEqual(['Ana', 'Guest 2', 'Guest 3']);
    guests.relabel(ANA.sessionId, 'Anna');
    expect(dropped.map((guestSong) => guestSong.addedBy)).toEqual(['Ana', 'Guest 2', 'Guest 3']);
    warn.mockRestore();
  });

  it('logs a failed restore queue read and keeps the songs held for the next refresh', async () => {
    const { engine, guests } = await threeGuestSongs();
    const debug = vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
    const readQueue = engine.getQueue.getMockImplementation() as () => Promise<QueueEntry[]>;
    engine.getQueue
      .mockImplementationOnce(readQueue)
      .mockImplementationOnce(() => Promise.reject(new Error('mpv IPC socket closed')));

    replaceQueue(engine, { generation: 1, pending: false });
    engine.emit(GENERATION_RISE);

    await vi.waitFor(() => { expect(debug).toHaveBeenCalledWith('webui: guest song restore failed: mpv IPC socket closed'); });
    expect(guests.ledger.hasRestorable()).toBe(true);
    engine.emit(GENERATION_RISE);
    await vi.waitFor(() => { expect(songIds(engine)).toEqual(['new-1', 'new-2', 'so-1', 'so-2', 'so-3']); });
    debug.mockRestore();
  });

  it('drops a held song that the new queue already holds waiting, and frees its slot', async () => {
    const { engine, guests } = await threeGuestSongs();
    engine.queue = [entry(200, 'new-1', true), entry(201, 'so-2')];
    reindex(engine.queue);
    engine.marks = { generation: 1, pending: false };
    engine.emit(GENERATION_RISE);

    await vi.waitFor(() => { expect(songIds(engine)).toEqual(['new-1', 'so-2', 'so-1', 'so-3']); });
    expect(engine.enqueue).toHaveBeenLastCalledWith(['so-1', 'so-3'], 'append', [song('so-1'), song('so-3')], { refuseRadioQueue: true });
    expect([103, 104].map((id) => guests.ledger.ownerOf(id))).toEqual([ANA.sessionId, CY.sessionId]);
    expect(guests.counts(BO.sessionId).remaining).toBe(1);
  });

  it('restores the held songs when the connection drops before the restore and its queue read re-attaches', async () => {
    const { engine, guests } = await threeGuestSongs();
    engine.readReplaceMarks.mockImplementationOnce(() => {
      engine.running = false;
      return Promise.resolve({ ...engine.marks });
    });
    const readQueue = engine.getQueue.getMockImplementation() as () => Promise<QueueEntry[]>;
    engine.getQueue
      .mockImplementationOnce(readQueue)
      .mockImplementationOnce(() => {
        engine.running = true;
        return readQueue();
      });

    replaceQueue(engine, { generation: 1, pending: false });
    engine.emit(GENERATION_RISE);

    await vi.waitFor(() => { expect(songIds(engine)).toEqual(['new-1', 'new-2', 'so-1', 'so-2', 'so-3']); });
    expect(guests.ledger.ownerOf(103)).toBe(ANA.sessionId);
  });

  it('drops the held songs, without starting mpv, when mpv stops before the restore runs', async () => {
    const { engine, guests } = await threeGuestSongs();
    engine.readReplaceMarks.mockImplementationOnce(() => {
      engine.running = false;
      return Promise.resolve({ ...engine.marks });
    });

    replaceQueue(engine, { generation: 1, pending: false });
    engine.emit(GENERATION_RISE);

    await vi.waitFor(() => { expect(guests.ledger.isEmpty()).toBe(true); });
    await settle();
    expect(engine.enqueue).toHaveBeenCalledTimes(3);
    engine.running = true;
    expect(guests.counts(ANA.sessionId).remaining).toBe(1);
  });
});

describe('GuestQueue.removeGuestSongs', () => {
  /** Ana's song 100 plays, Bo's song 101 waits, and Ana's song 102 waits. */
  async function jukeboxQueue(): Promise<{ engine: FakeEngine; guests: GuestQueue }> {
    const engine = fakeEngine([entry(1, 'host-song', true)]);
    const guests = guestQueue(engine);
    await guests.add(ANA, song('so-1'));
    await guests.add(BO, song('so-2'));
    engine.queue.push(entry(102, 'so-3'));
    guests.ledger.record(102, { sessionId: ANA.sessionId, song: song('so-3'), addedBy: 'Ana', byHost: false, addedAt: 0 });
    engine.queue[0] = entry(1, 'host-song');
    engine.queue[1] = entry(100, 'so-1', true);
    reindex(engine.queue);
    return { engine, guests };
  }

  it("removes only the guest's songs that have not started, and lists the rest", async () => {
    const { engine, guests } = await jukeboxQueue();
    const onChange = vi.fn();
    guests.watch(onChange);

    expect(await guests.removeGuestSongs(ANA.sessionId)).toEqual({ removed: 1, stayed: 0 });
    expect(engine.queue.map((queued) => queued.songId)).toEqual(['host-song', 'so-1', 'so-2']);
    expect(engine.removeQueueEntryById).toHaveBeenCalledWith(102, { songId: 'so-3', refuseStarted: true });
    expect(guests.ledger.unplayedSongs(ANA.sessionId)).toEqual([]);
    expect(guests.ledger.unplayedSongs(BO.sessionId)).toEqual([song('so-2')]);
    expect(onChange).toHaveBeenCalled();
  });

  it('keeps a song that starts before the locked removal', async () => {
    const { engine, guests } = await jukeboxQueue();
    engine.removeQueueEntryById.mockRejectedValueOnce(new QueueEntryStartedError(102));

    expect(await guests.removeGuestSongs(ANA.sessionId)).toEqual({ removed: 0, stayed: 0 });
    expect(guests.ledger.ownerOf(102)).toBe(ANA.sessionId);
  });

  it('removes nothing, starts no mpv and counts the queued songs that stay while no mpv is attached', async () => {
    const { engine, guests } = await jukeboxQueue();
    engine.running = false;

    // No queue read reached the ledger since song 100 started, so it still counts as waiting.
    expect(await guests.removeGuestSongs(ANA.sessionId)).toEqual({ removed: 0, stayed: 2 });
    expect(engine.removeQueueEntryById).not.toHaveBeenCalled();
    expect(guests.ledger.unplayedEntryIds(ANA.sessionId)).toContain(102);
  });

  it('keeps and counts the songs left when the mpv connection drops during the removal', async () => {
    const { engine, guests } = await jukeboxQueue();
    engine.queue.push(entry(103, 'so-4'));
    reindex(engine.queue);
    guests.ledger.record(103, { sessionId: ANA.sessionId, song: song('so-4'), addedBy: 'Ana', byHost: false, addedAt: 0 });
    const removeWhileAttached = engine.removeQueueEntryById.getMockImplementation();
    engine.removeQueueEntryById.mockImplementation((entryId: number) => {
      if (entryId !== 103) return removeWhileAttached?.(entryId);
      engine.running = false;
      return Promise.resolve(false);
    });

    expect(await guests.removeGuestSongs(ANA.sessionId)).toEqual({ removed: 1, stayed: 1 });
    expect(engine.queue.map((queued) => queued.songId)).toEqual(['host-song', 'so-1', 'so-2', 'so-4']);
    expect(guests.ledger.unplayedEntryIds(ANA.sessionId)).toEqual([103]);
  });

  it('answers no songs while no mpv is attached and the guest has no queued song', async () => {
    const { engine, guests } = await jukeboxQueue();
    engine.running = false;

    expect(await guests.removeGuestSongs('nobody')).toEqual({ removed: 0, stayed: 0 });
  });

  it("lists the guest's unplayed songs only while an mpv is attached, like its count", async () => {
    const { engine, guests } = await jukeboxQueue();

    const listed = guests.unplayedSongs(ANA.sessionId);
    expect(listed).toContainEqual(song('so-3'));
    expect(listed).toEqual(guests.ledger.unplayedSongs(ANA.sessionId));
    engine.running = false;
    expect(guests.unplayedSongs(ANA.sessionId)).toEqual([]);
    expect(guests.counts(ANA.sessionId).remaining).toBe(guests.counts('nobody').remaining);
  });

  it('rejects with the mpv error, so the caller can report it', async () => {
    const { engine, guests } = await jukeboxQueue();
    engine.removeQueueEntryById.mockRejectedValueOnce(new Error('ipc closed'));

    await expect(guests.removeGuestSongs(ANA.sessionId)).rejects.toThrow('ipc closed');
  });

  it('removes the song of an add that was appending when the removal started', async () => {
    const engine = fakeEngine([entry(1, 'host-song', true)]);
    const guests = guestQueue(engine);
    let appendLands: () => void = () => undefined;
    const appendRequested = new Promise<void>((requested) => {
      engine.enqueue.mockImplementationOnce((songIds: string[]) => new Promise((resolve) => {
        appendLands = () => {
          engine.queue.push(entry(100, songIds[0] ?? null));
          reindex(engine.queue);
          resolve({ demoted: false, outputMissing: null, entryIds: [100] });
        };
        requested();
      }));
    });
    const adding = guests.add(ANA, song('so-1'));
    await appendRequested;

    const removing = guests.removeGuestSongs(ANA.sessionId);
    appendLands();

    expect((await adding).kind).toBe('added');
    expect(await removing).toEqual({ removed: 1, stayed: 0 });
    expect(engine.queue.map((queued) => queued.songId)).toEqual(['host-song']);
  });

  it('refuses an add whose turn comes after the session ended, so its song never lands', async () => {
    const engine = fakeEngine([entry(1, 'host-song', true)]);
    const guests = guestQueue(engine);
    let live = true;
    const ana = { ...ANA, isLive: () => live };
    let boAppendLands: () => void = () => undefined;
    const boAppendRequested = new Promise<void>((requested) => {
      engine.enqueue.mockImplementationOnce((songIds: string[]) => new Promise((resolve) => {
        boAppendLands = () => {
          engine.queue.push(entry(100, songIds[0] ?? null));
          reindex(engine.queue);
          resolve({ demoted: false, outputMissing: null, entryIds: [100] });
        };
        requested();
      }));
    });
    const boAdding = guests.add(BO, song('so-2'));
    await boAppendRequested;
    const anaAdding = guests.add(ana, song('so-1'));

    live = false;
    const removing = guests.removeGuestSongs(ANA.sessionId);
    boAppendLands();

    expect((await boAdding).kind).toBe('added');
    expect(await anaAdding).toEqual({ kind: 'signed-out' });
    expect(await removing).toEqual({ removed: 0, stayed: 0 });
    expect(engine.enqueue).toHaveBeenCalledTimes(1);
    expect(engine.queue.map((queued) => queued.songId)).toEqual(['host-song', 'so-2']);
  });

  it('drops the songs a pending replace holds, so the completed replace never restores them', async () => {
    const engine = fakeEngine([entry(1, 'host-song', true)]);
    const guests = guestQueue(engine);
    guests.watch(() => undefined);
    await guests.add(ANA, song('so-1'));
    await guests.add(BO, song('so-2'));
    engine.queue = [entry(200, 'new-1', true)];
    reindex(engine.queue);
    engine.marks = { generation: 0, pending: true };
    engine.emit({ kind: 'property', name: 'playlist-count', data: 1 });
    await vi.waitFor(() => { expect(guests.ledger.ownerOf(100)).toBeNull(); });
    expect(guests.ledger.unplayedSongs(ANA.sessionId)).toEqual([song('so-1')]);

    expect(await guests.removeGuestSongs(ANA.sessionId)).toEqual({ removed: 1, stayed: 0 });
    engine.marks = { generation: 1, pending: false };
    engine.emit({ kind: 'property', name: REPLACE_GENERATION_PROPERTY, data: 1 });

    await vi.waitFor(() => { expect(engine.queue.map((queued) => queued.songId)).toEqual(['new-1', 'so-2']); });
  });

  it('drops the held songs while no mpv is attached and counts the queued ones that stay', async () => {
    const engine = fakeEngine([entry(1, 'host-song', true)]);
    const guests = guestQueue(engine);
    guests.watch(() => undefined);
    await guests.add(ANA, song('so-1'));
    engine.queue = [entry(200, 'new-1', true)];
    reindex(engine.queue);
    engine.marks = { generation: 0, pending: true };
    engine.emit({ kind: 'property', name: 'playlist-count', data: 1 });
    await vi.waitFor(() => { expect(guests.ledger.ownerOf(100)).toBeNull(); });
    engine.queue.push(entry(201, 'so-3'));
    reindex(engine.queue);
    guests.ledger.record(201, { sessionId: ANA.sessionId, song: song('so-3'), addedBy: 'Ana', byHost: false, addedAt: 0 });
    engine.running = false;

    expect(await guests.removeGuestSongs(ANA.sessionId)).toEqual({ removed: 1, stayed: 1 });
    expect(guests.ledger.unplayedSongs(ANA.sessionId)).toEqual([song('so-3')]);
    expect(engine.removeQueueEntryById).not.toHaveBeenCalled();
  });
});
