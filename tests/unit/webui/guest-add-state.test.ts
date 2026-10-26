/**
 * Navidrome MCP Server - Guest Add button rules test
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it, vi } from 'vitest';
import { ANSWER_GRACE_MS, answerSettled, buttonState, queuedSongs, retryDelayMs, sendAdds } from '../../../src/webui/public/guest-add-state.js';

const item = (index: number, songId: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ index, songId, entryId: index + 100, ...extra });

const emptyView = {
  pending: new Map<string, unknown>(),
  removing: new Set<string>(),
  answers: new Map<string, { added: boolean; at: number }>(),
  mine: new Map<string, number>(),
  others: new Set<string>(),
};

describe('queuedSongs', () => {
  it("maps this session's songs to their entry ids and collects the other songs the server marks as waiting", () => {
    const items = [item(0, 'played'), item(1, 'playing'), item(2, 'mine', { mine: true, waiting: true }), item(3, 'theirs', { waiting: true })];

    const { mine, others } = queuedSongs(items);

    expect([...mine]).toEqual([['mine', 102]]);
    expect([...others]).toEqual(['theirs']);
  });

  it('leaves out a song of this session with no entry id, since no removal could name it', () => {
    const { mine, others } = queuedSongs([{ index: 0, songId: 'mine', entryId: null, mine: true, waiting: true }]);

    expect([...mine]).toEqual([]);
    expect([...others]).toEqual(['mine']);
  });
});

describe('buttonState', () => {
  it('shows a request in flight before an answer, and an answer before the snapshot', () => {
    const view = { ...emptyView, pending: new Map([['a', {}]]), removing: new Set(['b']), answers: new Map([['c', { added: false, at: 0 }]]), mine: new Map([['c', 1], ['d', 2]]), others: new Set(['e']) };

    expect(['a', 'b', 'c', 'd', 'e', 'f'].map((songId) => buttonState(songId, view))).toEqual(['pending', 'removing', 'add', 'added', 'queued', 'add']);
  });
});

describe('answerSettled', () => {
  it('keeps an answer until the snapshot agrees or the grace runs out', () => {
    const added = { added: true, at: 1000 };

    expect(answerSettled('a', added, new Map(), 1000)).toBe(false);
    expect(answerSettled('a', added, new Map([['a', 1]]), 1000)).toBe(true);
    expect(answerSettled('a', added, new Map(), 1000 + ANSWER_GRACE_MS)).toBe(true);
  });

  it("keeps a removal answer while the snapshot still lists the song as this session's", () => {
    const removed = { added: false, at: 1000 };

    expect(answerSettled('a', removed, new Map([['a', 1]]), 1000)).toBe(false);
    expect(answerSettled('a', removed, new Map(), 1000)).toBe(true);
  });
});

describe('sendAdds', () => {
  const answer = (status: number, data: unknown = {}): { ok: boolean; status: number; data: unknown } => ({ ok: status === 200, status, data });

  it('sends the songs one at a time in tap order and waits out an add rate refusal before sending the song again', async () => {
    const pending = new Map([['a', { id: 'a' }], ['b', { id: 'b' }]]);
    const replies = [answer(200, { remaining: 2 }), answer(429, { retryAfterMs: 4000 }), answer(200, { remaining: 1 })];
    const post = vi.fn(() => Promise.resolve(replies.shift()));
    const wait = vi.fn(() => Promise.resolve());
    const answered: string[] = [];

    await sendAdds(pending, { post, wait, isLive: () => true, onAnswer: (song: { id: string }) => answered.push(song.id) });

    expect(post.mock.calls).toEqual([['a'], ['b'], ['b']]);
    expect(wait.mock.calls).toEqual([[4000]]);
    expect(answered).toEqual(['a', 'b']);
    expect(pending.size).toBe(0);
  });

  it('reports a final refusal such as the song limit and moves on', async () => {
    const pending = new Map([['a', { id: 'a' }]]);
    const onAnswer = vi.fn();

    await sendAdds(pending, { post: () => Promise.resolve(answer(429, { code: 'limit' })), wait: vi.fn(), isLive: () => true, onAnswer });

    expect(onAnswer).toHaveBeenCalledWith({ id: 'a' }, answer(429, { code: 'limit' }));
    expect(pending.size).toBe(0);
  });

  it('stops on a 401, and drops an answer that lands after the session ended', async () => {
    const signedOut = new Map([['a', { id: 'a' }], ['b', { id: 'b' }]]);
    const ended = new Map([['a', { id: 'a' }]]);
    let live = true;
    const onAnswer = vi.fn();

    await sendAdds(signedOut, { post: () => Promise.resolve(answer(401)), wait: vi.fn(), isLive: () => true, onAnswer });
    await sendAdds(ended, {
      post: () => {
        live = false;
        return Promise.resolve(answer(200));
      },
      wait: vi.fn(),
      isLive: () => live,
      onAnswer,
    });

    expect(onAnswer).not.toHaveBeenCalled();
    expect(signedOut.size).toBe(2);
  });

  it('sends nothing more once the session ends while it waits out the add rate', async () => {
    const pending = new Map([['a', { id: 'a' }]]);
    let live = true;
    const post = vi.fn(() => Promise.resolve(answer(429, { retryAfterMs: 4000 })));

    await sendAdds(pending, {
      post,
      wait: () => {
        live = false;
        return Promise.resolve();
      },
      isLive: () => live,
      onAnswer: vi.fn(),
    });

    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe('retryDelayMs', () => {
  it('retries only a 429 that names its wait, so the song limit refusal stays final', () => {
    expect(retryDelayMs(429, { error: 'Too many songs added at once.', retryAfterMs: 4200 })).toBe(4200);
    expect(retryDelayMs(429, { error: 'You can have 3 songs waiting.', code: 'limit' })).toBeNull();
    expect(retryDelayMs(409, { retryAfterMs: 10 })).toBeNull();
    expect(retryDelayMs(null, null)).toBeNull();
  });
});
