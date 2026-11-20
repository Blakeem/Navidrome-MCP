/**
 * Navidrome MCP Server - Jukebox Remote server answer tone test
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// src/webui/public/ is outside eslint and type checking, and no DOM library runs in vitest. These tests
// load the real dialog modules against a fake document and a mocked api.js, so each server answer's tone
// is checked in the notice it lands in.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readNotice, type Shown } from './fake-notice.js';

const API = '../../../src/webui/public/api.js';
const FAILED_TEXT = 'That action failed. Try again.';
const ANNOUNCE_DELAY_MS = 100;

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
let created: FakeElement[] = [];

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
    showModal: vi.fn(() => { el['open'] = true; }),
    close: () => { el['open'] = false; },
  };
  return el;
}

function createElement(): FakeElement {
  const el = fakeElement();
  created.push(el);
  return el;
}

function element(id: string): FakeElement {
  if (!elements.has(id)) elements.set(id, fakeElement());
  return elements.get(id) as FakeElement;
}

function notice(): Shown {
  return readNotice(created);
}

function announced(): string {
  return created.find((el) => el['className'] === 'visually-hidden')?.textContent ?? '';
}

function answer(ok: boolean, data: unknown, status = ok ? 200 : 409): Answer {
  return { ok, status, data };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  elements = new Map();
  created = [];
  getJson.mockReset().mockResolvedValue(null);
  getJsonResult.mockReset();
  postJson.mockReset();
  vi.stubGlobal('document', {
    activeElement: null,
    body: fakeElement(),
    getElementById: element,
    createElement,
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
  const save = async (reply: Answer): Promise<Shown> => {
    const guests = (await import('../../../src/webui/public/guests.js')) as unknown as { bindGuestsDialog: () => void };
    guests.bindGuestsDialog();
    postJson.mockResolvedValue(reply);
    element('jukebox-guest-limit').value = '3';
    element('jukebox-guest-limit-save').textContent = 'Save';
    element('jukebox-guest-limit-save').handlers['click']?.();
    expect(postJson).toHaveBeenCalledWith('/api/jukebox/settings', { guestQueueLimit: 3 });
    await vi.waitFor(() => expect(element('jukebox-guest-limit-save').textContent).not.toBe('Saving…'));
    return notice();
  };

  it('confirms a stored limit on the button and shows no notice', async () => {
    const shown = await save(answer(true, { guestQueueLimit: 3, persisted: true }));

    expect(element('jukebox-guest-limit-save').textContent).toBe('Saved');
    expect(shown).toEqual({ text: '', tone: undefined });
  });

  it('shows the until-restart warning when settings.json was not written', async () => {
    const shown = await save(answer(true, { guestQueueLimit: 3, persisted: false }));

    expect(element('jukebox-guest-limit-save').textContent).toBe('Save');
    expect(shown).toEqual({ text: 'Applied until the player restarts. settings.json was not written.', tone: 'warning' });
  });

  it('shows the server error in the error tone', async () => {
    const shown = await save(answer(false, { error: 'The song limit must be 1 to 50.' }));

    expect(shown).toEqual({ text: 'The song limit must be 1 to 50.', tone: 'error' });
  });

  it('shows the connection text when the server sent no error', async () => {
    const shown = await save(answer(false, null, 0));

    expect(shown).toEqual({ text: 'The limit was not saved. Check the connection and try again.', tone: 'error' });
  });

  it('shows a failed limit load as an error after the dialog opens', async () => {
    const guests = (await import('../../../src/webui/public/guests.js')) as unknown as { bindGuestsDialog: () => void };
    guests.bindGuestsDialog();
    element('open-guests').handlers['click']?.();

    expect(element('guests-dialog')['showModal']).toHaveBeenCalled();
    await vi.waitFor(() => expect(notice()).toEqual({ text: 'Could not load the guest song limit.', tone: 'error' }));
  });

  it('shows no notice for a limit load that fails after the dialog closed', async () => {
    const guests = (await import('../../../src/webui/public/guests.js')) as unknown as { bindGuestsDialog: () => void };
    guests.bindGuestsDialog();
    element('open-guests').handlers['click']?.();
    element('guests-dialog')['open'] = false;
    await vi.advanceTimersByTimeAsync(0);

    expect(getJson).toHaveBeenCalledWith('/api/jukebox/settings');
    expect(notice()).toEqual({ text: '', tone: undefined });
  });
});

describe('the output list in audio-device.js', () => {
  const REPORT = { devices: [{ id: 'auto', name: 'Autoselect' }], selected: { id: 'auto', name: null, connected: true } };

  // Opens the dialog and holds the list request until the test answers it.
  const open = async (): Promise<(reply: Answer) => void> => {
    let reply: (value: Answer) => void = () => undefined;
    getJsonResult.mockReturnValue(new Promise<Answer>((resolve) => { reply = resolve; }));
    const audio = (await import('../../../src/webui/public/audio-device.js')) as unknown as { bindAudioDevice: () => void };
    audio.bindAudioDevice();
    element('btn-audio-device').handlers['click']?.();
    expect(getJsonResult).toHaveBeenCalledWith('/api/audio-devices');
    return reply;
  };

  it('shows the loading row until the list answers, then one row per output', async () => {
    const reply = await open();
    const list = element('audio-device-list');

    expect(list.children.map((row) => [row['className'], row.textContent])).toEqual([['lib-notice', 'Loading outputs…']]);
    reply(answer(true, REPORT));
    await vi.advanceTimersByTimeAsync(0);

    expect(list.children).toHaveLength(1);
    expect(list.children[0]?.['className']).not.toBe('lib-notice');
    expect(notice()).toEqual({ text: '', tone: undefined });
  });

  it.each([
    ['the server error', answer(false, { error: 'mpv is not running.' }, 503), 'mpv is not running.'],
    ['the generic text when the server sent no error', answer(false, null, 0), FAILED_TEXT],
  ])('empties the list and shows %s as an error', async (_label, reply, text) => {
    (await open())(reply);
    await vi.advanceTimersByTimeAsync(0);

    expect(element('audio-device-list').children).toHaveLength(0);
    expect(notice()).toEqual({ text, tone: 'error' });
  });

  it('empties the list and shows no notice for a load that fails after the dialog closed', async () => {
    const reply = await open();
    element('audio-device-dialog')['open'] = false;
    reply(answer(false, null, 0));
    await vi.advanceTimersByTimeAsync(0);

    expect(element('audio-device-list').children).toHaveLength(0);
    expect(notice()).toEqual({ text: '', tone: undefined });
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

  const choose = async (reply: Answer): Promise<Shown> => {
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
    return notice();
  };

  it('shows no notice for a stored choice', async () => {
    const shown = await choose(answer(true, { shareLink: 'internet', persisted: true }));

    expect(shown).toEqual({ text: '', tone: undefined });
  });

  it('warns when the choice holds only until the player restarts', async () => {
    const shown = await choose(answer(true, { shareLink: 'internet', persisted: false }));

    expect(shown).toEqual({ text: 'The link choice holds until the player restarts. settings.json was not written.', tone: 'warning' });
  });

  it('puts the switch back and shows the error when the save fails', async () => {
    const shown = await choose(answer(false, null, 0));

    expect(shown).toEqual({ text: 'The link choice was not saved. Check the connection and try again.', tone: 'error' });
    expect(element('jukebox-share-lan').checked).toBe(true);
    expect(element('jukebox-share-internet').checked).toBe(false);
  });
});

describe('the jukebox load in jukebox.js', () => {
  const openJukebox = async (closeFirst: boolean): Promise<void> => {
    const jukebox = (await import('../../../src/webui/public/jukebox.js')) as unknown as { bindJukebox: () => void };
    jukebox.bindJukebox();
    element('open-jukebox').handlers['click']?.();
    if (closeFirst) element('jukebox-dialog')['open'] = false;
    await vi.advanceTimersByTimeAsync(0);
    expect(getJson).toHaveBeenCalledWith('/api/jukebox/code');
  };

  it('shows a failed load as an error in the open dialog', async () => {
    await openJukebox(false);

    expect(notice()).toEqual({ text: 'Could not load the jukebox. Check the connection and try again.', tone: 'error' });
  });

  it('shows no notice for a load that fails after the dialog closed', async () => {
    await openJukebox(true);

    expect(notice()).toEqual({ text: '', tone: undefined });
  });
});

describe('the jukebox close in jukebox.js', () => {
  it('confirms the close in the success tone', async () => {
    const jukebox = (await import('../../../src/webui/public/jukebox.js')) as unknown as { bindJukebox: () => void };
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }), confirm: () => true });
    getJson.mockResolvedValue({ active: false });
    postJson.mockResolvedValue(answer(true, {}));
    jukebox.bindJukebox();

    element('jukebox-close').handlers['click']?.();

    await vi.waitFor(() => expect(notice()).toEqual({ text: 'The jukebox closed. Guests were signed out.', tone: 'success' }));
  });
});

describe('the guest results in guests-list.js', () => {
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
  const BAN = { id: 'ban-1', kind: 'browser', label: 'Guest 1', nickname: 'Sam', networkKey: '192.168.1.0/24', expiresAt: 0 };
  const NETWORK_BAN = { ...BAN, id: 'ban-2', kind: 'network' };

  const loadList = async (bans: unknown[] = []) => {
    const list = (await import('../../../src/webui/public/guests-list.js')) as unknown as {
      bindGuestList: (options: { rotate: () => Promise<string | null>; changed: () => Promise<void> }) => void;
      refreshGuests: () => Promise<void>;
    };
    getJson.mockImplementation((url: string) => Promise.resolve(url === '/api/jukebox/guests' ? { guests: [GUEST] } : { bans }));
    return list;
  };

  // Opens the ban panel on the one guest row and confirms it.
  const ban = async (reply: Answer, rotateError: string | null = null, rotate = false): Promise<Shown> => {
    const list = await loadList();
    list.bindGuestList({ rotate: () => Promise.resolve(rotateError), changed: () => Promise.resolve() });
    await list.refreshGuests();
    const banButton = element('guest-list').children[0]?.children[1]?.children[1] as FakeElement;
    banButton.handlers['click']?.({ currentTarget: banButton });
    element('guest-ban-rotate').checked = rotate;
    postJson.mockResolvedValue(reply);
    element('guest-ban-confirm').handlers['click']?.();
    await vi.waitFor(() => expect(notice().tone).toBeDefined());
    return notice();
  };

  // Clicks the button at `buttonIndex` in the one row of `listId` and resolves the notice it shows.
  const clickRow = async (listId: string, buttonIndex: number, reply: Answer, bans: unknown[] = []): Promise<Shown> => {
    const list = await loadList(bans);
    list.bindGuestList({ rotate: () => Promise.resolve(null), changed: () => Promise.resolve() });
    await list.refreshGuests();
    const button = element(listId).children[0]?.children[1]?.children[buttonIndex] as FakeElement;
    postJson.mockResolvedValue(reply);
    button.handlers['click']?.({ currentTarget: button });
    await vi.waitFor(() => expect(notice().tone).toBeDefined());
    return notice();
  };

  it('shows a clean ban as a success with its song count', async () => {
    const shown = await ban(answer(true, { songsRemoved: 2, songsStayed: 0 }));

    expect(shown).toEqual({ text: 'Guest 1 (Sam) was banned. 2 songs removed.', tone: 'success' });
  });

  it('warns when the songs could not be removed', async () => {
    const shown = await ban(answer(true, { songsRemoved: null, songsStayed: 0 }));

    expect(shown).toEqual({ text: 'Guest 1 (Sam) was banned, but their songs could not be removed from the queue.', tone: 'warning' });
  });

  it('warns when a song stayed in the queue', async () => {
    const shown = await ban(answer(true, { songsRemoved: 0, songsStayed: 1 }));

    expect(shown).toEqual({ text: 'Guest 1 (Sam) was banned, and 0 songs left the queue. 1 song stayed, since no player is running.', tone: 'warning' });
  });

  it('shows the ban and the failed new code as an error', async () => {
    const shown = await ban(answer(true, { songsRemoved: 1, songsStayed: 0 }), 'The jukebox code was not made.', true);

    expect(shown).toEqual({ text: 'Guest 1 (Sam) was banned. 1 song removed. The jukebox code was not made.', tone: 'error' });
  });

  it('shows a refused ban as an error', async () => {
    const shown = await ban(answer(false, { error: 'That guest already left.' }));

    expect(shown).toEqual({ text: 'That guest already left.', tone: 'error' });
  });

  it('shows a removed guest as a success', async () => {
    const shown = await clickRow('guest-list', 0, answer(true, {}));

    expect(shown).toEqual({ text: 'Guest 1 (Sam) was signed out.', tone: 'success' });
  });

  it.each([
    [BAN, 'The ban on Guest 1 (Sam) was lifted.'],
    [NETWORK_BAN, 'The network ban on Guest 1 (Sam) was lifted.'],
  ])('shows a lifted ban as a success', async (entry, text) => {
    const shown = await clickRow('ban-list', 0, answer(true, {}), [entry]);

    expect(shown).toEqual({ text, tone: 'success' });
  });
});

describe('the remove answer in guest-add.js', () => {
  const ITEM = { songId: 'song-1', entryId: 4, title: 'Levitating' };

  const remove = async (reply: Answer): Promise<Shown> => {
    const add = (await import('../../../src/webui/public/guest-add.js')) as unknown as { removeSong: (item: typeof ITEM) => Promise<void> };
    postJson.mockResolvedValue(reply);
    await add.removeSong(ITEM);
    expect(postJson).toHaveBeenCalledWith('/api/guest/queue/remove', { entryId: 4 });
    await vi.advanceTimersByTimeAsync(ANNOUNCE_DELAY_MS);
    return notice();
  };

  it('announces a removal to a screen reader and shows no notice', async () => {
    const shown = await remove(answer(true, { remaining: 3 }));

    expect(shown).toEqual({ text: '', tone: undefined });
    expect(announced()).toBe('Removed Levitating.');
  });

  it('shows the server error in the error tone', async () => {
    const shown = await remove(answer(false, { error: 'That song already played.' }));

    expect(shown).toEqual({ text: 'That song already played.', tone: 'error' });
  });

  it('shows the no-answer text when the server sent no error', async () => {
    const shown = await remove(answer(false, null, 0));

    expect(shown).toEqual({ text: 'The player did not answer. Check the connection and try again.', tone: 'error' });
  });

  it('shows nothing when the session ended', async () => {
    const shown = await remove(answer(false, { error: 'Sign in again.' }, 401));

    expect(shown).toEqual({ text: '', tone: undefined });
    expect(announced()).toBe('');
  });
});
