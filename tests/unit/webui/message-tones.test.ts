/**
 * Navidrome MCP Server - Jukebox Remote server answer tone test
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// src/webui/public/ is outside eslint and type checking, and no DOM library runs in vitest. These tests
// load the real dialog modules against a fake document and a mocked api.js, so each server answer's tone
// is checked on the line it lands on.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const API = '../../../src/webui/public/api.js';
const FAILED_TEXT = 'That action failed. Try again.';

interface FakeElement {
  textContent: string;
  value: string;
  checked: boolean;
  disabled: boolean;
  inert: boolean;
  isConnected: boolean;
  dataset: Record<string, string>;
  children: FakeElement[];
  handlers: Record<string, (event?: unknown) => void>;
  [key: string]: unknown;
}

interface Answer {
  ok: boolean;
  status: number;
  data: unknown;
}

const getJson = vi.fn();
const getJsonResult = vi.fn();
const postJson = vi.fn();
let elements = new Map<string, FakeElement>();

function fakeElement(): FakeElement {
  let inner: FakeElement | null = null;
  const el: FakeElement = {
    textContent: '',
    value: '',
    checked: false,
    disabled: false,
    inert: false,
    isConnected: true,
    dataset: {},
    children: [],
    handlers: {},
    addEventListener: (event: string, handler: (event?: unknown) => void) => { el.handlers[event] = handler; },
    setAttribute: () => undefined,
    removeAttribute: () => undefined,
    appendChild: (node: FakeElement) => { el.children.push(node); },
    append: (...nodes: unknown[]) => {
      for (const node of nodes) if (typeof node !== 'string') el.children.push(node as FakeElement);
    },
    replaceChildren: (...nodes: unknown[]) => {
      el.children = nodes.filter((node): node is FakeElement => typeof node !== 'string');
      el.textContent = nodes.filter((node) => typeof node === 'string').join('');
    },
    querySelector: () => (inner ??= fakeElement()),
    querySelectorAll: () => [],
    contains: () => false,
    focus: () => undefined,
    showModal: vi.fn(),
  };
  return el;
}

function element(id: string): FakeElement {
  if (!elements.has(id)) elements.set(id, fakeElement());
  return elements.get(id) as FakeElement;
}

function answer(ok: boolean, data: unknown, status = ok ? 200 : 409): Answer {
  return { ok, status, data };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  elements = new Map();
  getJson.mockReset().mockResolvedValue(null);
  getJsonResult.mockReset();
  postJson.mockReset();
  vi.stubGlobal('document', {
    activeElement: null,
    body: {},
    getElementById: element,
    createElement: fakeElement,
    createElementNS: fakeElement,
  });
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
  vi.stubGlobal('Option', class {
    label: string;
    value: string;
    constructor(label: string, value: string) {
      this.label = label;
      this.value = value;
    }
  });
  vi.doMock(API, () => ({ FAILED_TEXT, getJson, getJsonResult, postJson }));
});

afterEach(() => {
  vi.doUnmock(API);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the guest song limit Save in guests.js', () => {
  const save = async (reply: Answer): Promise<FakeElement> => {
    const guests = (await import('../../../src/webui/public/guests.js')) as unknown as { bindGuestsDialog: () => void };
    guests.bindGuestsDialog();
    postJson.mockResolvedValue(reply);
    element('jukebox-guest-limit').value = '3';
    element('jukebox-guest-limit-save').textContent = 'Save';
    element('jukebox-guest-limit-save').handlers['click']?.();
    expect(postJson).toHaveBeenCalledWith('/api/jukebox/settings', { guestQueueLimit: 3 });
    await vi.waitFor(() => expect(element('jukebox-guest-limit-save').textContent).not.toBe('Saving…'));
    return element('jukebox-guest-limit-message');
  };

  it('confirms a stored limit on the button and leaves the line empty', async () => {
    const line = await save(answer(true, { guestQueueLimit: 3, persisted: true }));

    expect(element('jukebox-guest-limit-save').textContent).toBe('Saved');
    expect(line.textContent).toBe('');
    expect(line.dataset.tone).toBeUndefined();
  });

  it('shows the until-restart warning when settings.json was not written', async () => {
    const line = await save(answer(true, { guestQueueLimit: 3, persisted: false }));

    expect(element('jukebox-guest-limit-save').textContent).toBe('Save');
    expect(line.textContent).toBe('Applied until the player restarts. settings.json was not written.');
    expect(line.dataset.tone).toBe('warning');
  });

  it('shows the server error in the error tone', async () => {
    const line = await save(answer(false, { error: 'The song limit must be 1 to 50.' }));

    expect(line.textContent).toBe('The song limit must be 1 to 50.');
    expect(line.dataset.tone).toBe('error');
  });

  it('shows the connection text when the server sent no error', async () => {
    const line = await save(answer(false, null, 0));

    expect(line.textContent).toBe('The limit was not saved. Check the connection and try again.');
    expect(line.dataset.tone).toBe('error');
  });
});

describe('the share link choice in jukebox.js', () => {
  const CODE = {
    active: true,
    expiresAt: 0,
    guestCount: 0,
    problem: null,
    links: { lan: [{ label: 'Wi-Fi', url: 'http://192.168.1.2:8080/join', qrSvg: '<svg/>' }], internet: { url: 'https://jukebox.example/join', qrSvg: '<svg/>' } },
  };

  const choose = async (reply: Answer): Promise<FakeElement> => {
    const jukebox = (await import('../../../src/webui/public/jukebox.js')) as unknown as { bindJukebox: () => void };
    getJson.mockImplementation((url: string) => Promise.resolve(url === '/api/jukebox/code' ? CODE : { shareLink: 'lan' }));
    jukebox.bindJukebox();
    element('open-jukebox').handlers['click']?.();
    await vi.waitFor(() => expect(element('jukebox-status').textContent).toContain('Open until'));
    postJson.mockResolvedValue(reply);
    element('jukebox-share-lan').checked = false;
    element('jukebox-share-internet').checked = true;
    element('jukebox-share-internet').handlers['change']?.();
    expect(postJson).toHaveBeenCalledWith('/api/jukebox/settings', { shareLink: 'internet' });
    await vi.advanceTimersByTimeAsync(0);
    return element('jukebox-message');
  };

  it('shows no message for a stored choice', async () => {
    const line = await choose(answer(true, { shareLink: 'internet', persisted: true }));

    expect(line.textContent).toBe('');
    expect(line.dataset.tone).toBeUndefined();
  });

  it('warns when the choice holds only until the player restarts', async () => {
    const line = await choose(answer(true, { shareLink: 'internet', persisted: false }));

    expect(line.dataset.tone).toBe('warning');
    expect(line.textContent).toBe('The link choice holds until the player restarts. settings.json was not written.');
  });

  it('puts the switch back and shows the error when the save fails', async () => {
    const line = await choose(answer(false, null, 0));

    expect(line.dataset.tone).toBe('error');
    expect(line.textContent).toBe('The link choice was not saved. Check the connection and try again.');
    expect(element('jukebox-share-lan').checked).toBe(true);
    expect(element('jukebox-share-internet').checked).toBe(false);
  });
});

describe('the ban result in guests-list.js', () => {
  const GUEST = {
    sessionId: 'session-1',
    label: 'Guest 1',
    nickname: 'Sam',
    online: true,
    joinedAt: 0,
    networkKey: '192.168.1.0/24',
    addressClass: 'lan',
    sharedCount: 0,
    adminShares: false,
    songs: [],
  };

  // Opens the ban panel on the one guest row and confirms it.
  const ban = async (reply: Answer, rotateError: string | null = null, rotate = false): Promise<FakeElement> => {
    const list = (await import('../../../src/webui/public/guests-list.js')) as unknown as {
      bindGuestList: (options: { rotate: () => Promise<string | null>; changed: () => Promise<void> }) => void;
      refreshGuests: () => Promise<void>;
    };
    getJson.mockImplementation((url: string) => Promise.resolve(url === '/api/jukebox/guests' ? { guests: [GUEST] } : { bans: [] }));
    list.bindGuestList({ rotate: () => Promise.resolve(rotateError), changed: () => Promise.resolve() });
    await list.refreshGuests();
    const banButton = element('guest-list').children[0]?.children[1]?.children[1] as FakeElement;
    banButton.handlers['click']?.({ currentTarget: banButton });
    element('guest-ban-rotate').checked = rotate;
    postJson.mockResolvedValue(reply);
    element('guest-ban-confirm').handlers['click']?.();
    await vi.waitFor(() => expect(element('guest-message').dataset.tone).toBeDefined());
    return element('guest-message');
  };

  it('shows a clean ban as a success', async () => {
    const line = await ban(answer(true, { songsRemoved: 2, songsStayed: 0 }));

    expect(line.textContent).toBe('Guest 1 (Sam) was banned, and 2 songs left the queue.');
    expect(line.dataset.tone).toBe('success');
  });

  it('warns when the songs could not be removed', async () => {
    const line = await ban(answer(true, { songsRemoved: null, songsStayed: 0 }));

    expect(line.textContent).toBe('Guest 1 (Sam) was banned, but their songs could not be removed from the queue.');
    expect(line.dataset.tone).toBe('warning');
  });

  it('warns when a song stayed in the queue', async () => {
    const line = await ban(answer(true, { songsRemoved: 0, songsStayed: 1 }));

    expect(line.textContent).toBe('Guest 1 (Sam) was banned, and 0 songs left the queue. 1 song stayed, since no player is running.');
    expect(line.dataset.tone).toBe('warning');
  });

  it('shows the ban and the failed new code as an error', async () => {
    const line = await ban(answer(true, { songsRemoved: 1, songsStayed: 0 }), 'The jukebox code was not made.', true);

    expect(line.textContent).toBe('Guest 1 (Sam) was banned, and 1 song left the queue. The jukebox code was not made.');
    expect(line.dataset.tone).toBe('error');
  });

  it('shows a refused ban as an error', async () => {
    const line = await ban(answer(false, { error: 'That guest already left.' }));

    expect(line.textContent).toBe('That guest already left.');
    expect(line.dataset.tone).toBe('error');
  });
});

describe('the remove answer in guest-add.js', () => {
  const ITEM = { songId: 'song-1', entryId: 4, title: 'Levitating' };

  const remove = async (reply: Answer): Promise<FakeElement> => {
    const add = (await import('../../../src/webui/public/guest-add.js')) as unknown as { removeSong: (item: typeof ITEM) => Promise<void> };
    postJson.mockResolvedValue(reply);
    await add.removeSong(ITEM);
    expect(postJson).toHaveBeenCalledWith('/api/guest/queue/remove', { entryId: 4 });
    return element('guest-status');
  };

  it('shows a removal as a success', async () => {
    const line = await remove(answer(true, { remaining: 3 }));

    expect(line.textContent).toBe('Removed Levitating.');
    expect(line.dataset.tone).toBe('success');
  });

  it('shows the server error in the error tone', async () => {
    const line = await remove(answer(false, { error: 'That song already played.' }));

    expect(line.textContent).toBe('That song already played.');
    expect(line.dataset.tone).toBe('error');
  });

  it('shows the no-answer text when the server sent no error', async () => {
    const line = await remove(answer(false, null, 0));

    expect(line.textContent).toBe('The player did not answer. Check the connection and try again.');
    expect(line.dataset.tone).toBe('error');
  });

  it('shows nothing when the session ended', async () => {
    const line = await remove(answer(false, { error: 'Sign in again.' }, 401));

    expect(line.textContent).toBe('');
    expect(line.dataset.tone).toBeUndefined();
  });
});
