/**
 * Navidrome MCP Server - Shared queue row rules test
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// The admin and guest queues share these rules, so a removal asks first only for a song a guest added.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canRemove, clearConfirmText, hasMoreWaiting, queueWindow, removeConfirmText, removeLabel, removeRefused } from '../../../src/webui/public/queue-list.js';

const hostSong = { index: 1, entryId: 7, songId: 'so-1', title: 'Host Song' };
const guestSong = { index: 2, entryId: 8, songId: 'so-2', title: 'Guest Song', guestLabel: 'Ana', guestWaiting: true };

describe('removeConfirmText', () => {
  it('removes a host or AI song for the admin at once', () => {
    expect(removeConfirmText(hostSong, 'admin')).toBeNull();
  });

  it("asks the admin first for a guest's song and names the guest", () => {
    expect(removeConfirmText(guestSong, 'admin')).toBe('Remove Guest Song? Ana added it.');
  });

  it('asks a guest first for its own song', () => {
    expect(removeConfirmText({ ...hostSong, mine: true }, 'guest')).toBe('Remove Host Song from the queue?');
  });

  it('names an untitled song by the row fallback', () => {
    expect(removeConfirmText({ index: 0, entryId: 3, songId: null, guestLabel: 'Bo' }, 'admin')).toBe('Remove Unknown title? Bo added it.');
  });

  it('names an untitled song of the guest as its own', () => {
    expect(removeConfirmText({ index: 0, entryId: 3, songId: null, mine: true }, 'guest')).toBe('Remove your song from the queue?');
  });
});

describe('removeLabel', () => {
  it('names the song the button removes', () => {
    expect(removeLabel(hostSong, 'admin')).toBe('Remove Host Song from the queue');
    expect(removeLabel({ ...hostSong, mine: true }, 'guest')).toBe('Remove Host Song from the queue');
  });

  it('keeps each page fallback for an untitled song', () => {
    const untitled = { index: 0, entryId: 3, songId: null, mine: true };
    expect(removeLabel(untitled, 'guest')).toBe('Remove your song from the queue');
    expect(removeLabel(untitled, 'admin')).toBe('Remove Unknown title from the queue');
  });
});

describe('canRemove', () => {
  it('lets the admin remove any entry mpv numbered', () => {
    expect(canRemove(hostSong, 'admin')).toBe(true);
    expect(canRemove(guestSong, 'admin')).toBe(true);
    expect(canRemove({ ...hostSong, entryId: undefined }, 'admin')).toBe(false);
  });

  it('lets a guest remove only its own songs', () => {
    expect(canRemove({ ...hostSong, mine: true }, 'guest')).toBe(true);
    expect(canRemove({ ...hostSong, mine: false }, 'guest')).toBe(false);
    expect(canRemove({ ...hostSong, entryId: null, mine: true }, 'guest')).toBe(false);
  });
});

describe('removeRefused', () => {
  it('hides removal of the current entry only while it plays, as the engine refuses', () => {
    expect(removeRefused(true, false)).toBe(true);
    expect(removeRefused(true, undefined)).toBe(true);
    expect(removeRefused(true, true)).toBe(false);
    expect(removeRefused(false, false)).toBe(false);
  });
});

describe('clearConfirmText', () => {
  it('clears at once while no guest song waits', () => {
    expect(clearConfirmText([hostSong, { ...guestSong, guestWaiting: undefined }])).toBeNull();
    expect(clearConfirmText([])).toBeNull();
  });

  it('asks first and counts the waiting guest songs', () => {
    expect(clearConfirmText([hostSong, guestSong])).toBe('Clear the queue? 1 guest song is removed.');
    expect(clearConfirmText([guestSong, { ...guestSong, entryId: 9 }])).toBe('Clear the queue? 2 guest songs are removed.');
  });
});

describe('queueWindow', () => {
  type QueueItem = { index: number };
  const items = Array.from({ length: 30 }, (_, index) => ({ index, entryId: index + 1, songId: `so-${index}` }));

  it('keeps the playing row and the songs after it', () => {
    const shown = queueWindow(items, 4, 10);
    expect(shown).toHaveLength(11);
    expect(shown[0]?.index).toBe(4);
    expect(shown[10]?.index).toBe(14);
  });

  it('stops at the end of the queue', () => {
    expect(queueWindow(items, 27, 10).map((item: QueueItem) => item.index)).toEqual([27, 28, 29]);
  });

  it('starts at the top when nothing plays', () => {
    expect(queueWindow(items, null, 10).map((item: QueueItem) => item.index)).toEqual(items.slice(0, 10).map((item) => item.index));
  });

  it('returns every row of a short queue', () => {
    expect(queueWindow(items.slice(0, 3), 0, 10)).toHaveLength(3);
    expect(queueWindow([], null, 10)).toEqual([]);
  });
});

describe('hasMoreWaiting', () => {
  const items = Array.from({ length: 15 }, (_, index) => ({ index, entryId: index + 1, songId: `so-${index}` }));

  it('counts only the songs after the playing row', () => {
    expect(hasMoreWaiting(items, 10, 10)).toBe(false);
    expect(hasMoreWaiting(items, 4, 10)).toBe(false);
    expect(hasMoreWaiting(items, 3, 10)).toBe(true);
  });

  it('counts every row when nothing plays', () => {
    expect(hasMoreWaiting(items, null, 10)).toBe(true);
    expect(hasMoreWaiting(items.slice(0, 10), null, 10)).toBe(false);
    expect(hasMoreWaiting([], null, 10)).toBe(false);
  });
});

// No DOM library runs in vitest, so these read the page sources, as admin-header.test.ts does.
describe('page wiring', () => {
  const read = (file: string): string => readFileSync(new URL(`../../../src/webui/public/${file}`, import.meta.url), 'utf8');

  it('builds both queues from the shared component, each under its role', () => {
    expect(read('queue.js')).toMatch(/createQueueList\(queueList, \{\s*role: 'admin'/);
    expect(read('guest-queue.js')).toMatch(/createQueueList\(byId\('guest-queue-list'\), \{\s*role: 'guest'/);
  });

  it('removes an admin row by entry id and confirms Clear only through the guest-song rule', () => {
    const adminQueue = read('queue.js');
    expect(adminQueue).toContain("postControl('/api/controls/queue/remove', { entryId: item.entryId })");
    expect(adminQueue).toContain('clearConfirmText(renderedItems)');
  });

  it('passes the pause state to both queues, so a paused current entry keeps its remove button', () => {
    expect(read('app.js')).toContain('renderQueue(queue, playingIndex(nowPlaying), nowPlaying?.paused)');
    expect(read('guest.js')).toContain('renderGuestQueue(stored.queue, index, stored.nowPlaying?.paused)');
  });
});
