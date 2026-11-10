/**
 * Navidrome MCP Server - Admin header layout test
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// src/webui/public/ is outside eslint and type checking, and no DOM library runs in vitest. These
// checks read the page source, so a renamed id or a moved button fails here and not in a browser.

import { existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PUBLIC_DIR = new URL('../../../src/webui/public/', import.meta.url);
const read = (file: string): string => readFileSync(new URL(file, PUBLIC_DIR), 'utf8');

const HTML = read('index.html');
const HEADER_ICON_IDS = ['open-lyrics', 'open-play-dialog', 'open-jukebox', 'open-guests', 'open-settings'];
const SETTINGS_ACTION_IDS = ['open-network-info', 'logout-btn', 'power-btn'];

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from, `${start} is in the page`).toBeGreaterThanOrEqual(0);
  const to = source.indexOf(end, from);
  expect(to, `${end} follows ${start}`).toBeGreaterThan(from);
  return source.slice(from, to);
}

const headerActions = between(HTML, '<div class="topbar-actions">', '</header>');
const settingsDialog = between(HTML, '<dialog id="settings-dialog"', '</dialog>');
const guestsDialog = between(HTML, '<dialog id="guests-dialog"', '</dialog>');

function idsOf(markup: string, pattern: RegExp): string[] {
  return Array.from(markup.matchAll(pattern), (match) => match[1] ?? '');
}

describe('the admin header', () => {
  it('holds only the five icons the layout allows, in order', () => {
    const ids = idsOf(headerActions, /<button[^>]*class="ghost-btn[^"]*"[^>]*id="([^"]+)"/g);

    expect(ids).toEqual(HEADER_ICON_IDS);
  });

  it('shows the Guests icon only after the jukebox mode shows it', () => {
    expect(headerActions).toMatch(/id="open-guests" aria-label="Guests"[^>]*\bhidden\b/);
    expect(headerActions).toMatch(/id="open-jukebox"[^>]*\bhidden\b/);
  });
});

describe('the settings dialog', () => {
  it.each(SETTINGS_ACTION_IDS)('holds %s', (id) => {
    expect(settingsDialog).toContain(`id="${id}"`);
    expect(headerActions).not.toContain(`id="${id}"`);
  });

  it('keeps Log out hidden until an admin session shows it', () => {
    expect(settingsDialog).toMatch(/id="logout-btn"[^>]*\bhidden\b/);
  });

  it('keeps the local-only controls hidden until a local browser shows them', () => {
    expect(settingsDialog).toContain('<fieldset class="settings-group" id="settings-theme-group" hidden>');
    expect(settingsDialog).toContain('<fieldset class="settings-group" id="settings-player-group" hidden>');
    expect(settingsDialog).toMatch(/id="power-btn"[^>]*\bhidden\b/);
    expect(settingsDialog).not.toMatch(/id="open-network-info"[^>]*\bhidden\b/);
  });

  it('ends the local Player group with the All settings button and its hint', () => {
    const playerGroup = between(settingsDialog, 'id="settings-player-group"', '</fieldset>');
    const button = playerGroup.slice(playerGroup.lastIndexOf('<button'));

    expect(button).toMatch(/^<button type="button" class="btn-secondary" id="open-all-settings" aria-describedby="all-settings-hint">/);
    expect(button).toContain('All settings</button>');
    expect(button.trimEnd()).toMatch(
      /<p class="modal-hint" id="all-settings-hint">Navidrome connection, admin password, access and more\. Opens on this computer\.<\/p>$/,
    );
  });

  it('ends with the remote note, hidden until a remote browser shows it', () => {
    const note = '<p class="modal-hint" id="settings-remote-note" hidden>Player settings and Shut down are on the player\'s computer.</p>';

    expect(settingsDialog.slice(settingsDialog.lastIndexOf('</fieldset>'))).toContain(note);
  });
});

describe('the Guests dialog', () => {
  it('lists guests, the banned list and the song limit', () => {
    expect(idsOf(guestsDialog, /<legend class="settings-heading">([^<]+)<\/legend>/g)).toEqual(['Signed in', 'Banned', 'Song limit']);
    expect(guestsDialog).toContain('<h2 id="guests-title">Guests</h2>');
  });

  it('drops the address debug line', () => {
    expect(HTML).not.toContain('Your address as seen by the server');
    expect(HTML).not.toContain('people-address');
  });

  it('puts the song limit label and its hint in separate elements', () => {
    expect(guestsDialog).toContain('>Songs each guest may have waiting</label>');
    expect(guestsDialog).toContain('<p class="modal-hint" id="jukebox-guest-limit-hint">1 to 20. A slot frees when one of their songs starts or they remove it.</p>');
    expect(guestsDialog).toContain('aria-describedby="jukebox-guest-limit-hint"');
  });
});

describe('the modules behind the header', () => {
  const MODULES = ['guests.js', 'guests-list.js', 'local-controls.js', 'network-info.js', 'settings.js'];

  it.each(MODULES)('%s looks up only ids that index.html holds', (file) => {
    const ids = idsOf(read(file), /byId\('([^']+)'\)/g);

    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(HTML, `${file} reads #${id}`).toContain(`id="${id}"`);
  });

  it('replaced the people modules with the guests modules', () => {
    expect(existsSync(new URL('people.js', PUBLIC_DIR))).toBe(false);
    expect(existsSync(new URL('people-guests.js', PUBLIC_DIR))).toBe(false);
    expect(read('app.js')).toContain("from './guests.js'");
    expect(read('app.js')).not.toContain('people');
  });
});

describe('app.js', () => {
  const MODULE_DIR = '../../../src/webui/public/';
  // page-view.js stays real, so the page's own mode routing decides which boot path runs.
  const REAL_MODULES = new Set(['page-view.js']);
  const mockedModules = Array.from(read('app.js').matchAll(/import \{([^}]+)\} from '\.\/([^']+)'/g), (match) => ({
    file: match[2] ?? '',
    names: (match[1] ?? '').split(',').map((name) => name.trim()),
  })).filter((module) => !REAL_MODULES.has(module.file));

  const setLocalPeer = vi.fn();
  let session: Record<string, unknown> | null = null;

  beforeEach(() => {
    setLocalPeer.mockReset();
    vi.resetModules();
    for (const module of mockedModules) {
      vi.doMock(`${MODULE_DIR}${module.file}`, () => ({
        ...Object.fromEntries(module.names.map((name) => [name, vi.fn()])),
        ...(module.file === 'local-controls.js' ? { setLocalPeer } : {}),
        ...(module.file === 'api.js' ? { getJson: vi.fn((url: string) => Promise.resolve(url === '/api/auth/session' ? session : null)) } : {}),
      }));
    }
  });

  afterEach(() => {
    for (const module of mockedModules) vi.doUnmock(`${MODULE_DIR}${module.file}`);
  });

  const boot = async (): Promise<void> => {
    await import('../../../src/webui/public/app.js');
    await vi.waitFor(() => expect(setLocalPeer).toHaveBeenCalled());
  };

  it.each([
    ['none', true],
    ['none', false],
    ['password', true],
    ['password', false],
    ['jukebox', true],
    ['jukebox', false],
  ])('passes the session isLocal flag to setLocalPeer in mode %s (isLocal %s)', async (mode, isLocal) => {
    session = { mode, role: mode === 'none' ? null : 'admin', isLocal };

    await boot();

    expect(setLocalPeer).toHaveBeenCalledTimes(1);
    expect(setLocalPeer).toHaveBeenCalledWith(isLocal);
  });

  it('treats an unread session as remote', async () => {
    session = null;

    await boot();

    expect(setLocalPeer).toHaveBeenCalledTimes(1);
    expect(setLocalPeer).toHaveBeenCalledWith(false);
  });
});

describe('local-controls.js', () => {
  interface FakeElement {
    hidden: boolean;
    setAttribute: (name: string) => void;
    removeAttribute: (name: string) => void;
    addEventListener: () => void;
    querySelector: () => FakeElement;
  }
  type LocalControls = {
    setLocalPeer: (isLocal: boolean) => void;
    showAdminControls: () => void;
    canChangePlayerSettings: () => boolean;
  };

  let elements = new Map<string, FakeElement>();
  const element = (id: string): FakeElement => {
    const found = elements.get(id);
    expect(found, `#${id} was looked up`).toBeDefined();
    return found as FakeElement;
  };

  beforeEach(() => {
    elements = new Map();
    const fake = (): FakeElement => {
      const el: FakeElement = {
        hidden: false,
        setAttribute: () => { el.hidden = true; },
        removeAttribute: () => { el.hidden = false; },
        addEventListener: () => undefined,
        querySelector: () => el,
      };
      return el;
    };
    vi.stubGlobal('document', {
      getElementById: (id: string) => {
        if (!elements.has(id)) elements.set(id, fake());
        return elements.get(id);
      },
      querySelector: () => fake(),
    });
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const load = async (): Promise<LocalControls> =>
    (await import('../../../src/webui/public/local-controls.js')) as unknown as LocalControls;

  it('lets a remote browser open settings, with the local-only controls hidden', async () => {
    const controls = await load();

    controls.setLocalPeer(false);

    expect(element('open-settings').hidden).toBe(false);
    expect(element('settings-remote-note').hidden).toBe(false);
    for (const id of ['settings-theme-group', 'settings-player-group', 'power-btn']) {
      expect(element(id).hidden, id).toBe(true);
    }
    expect(controls.canChangePlayerSettings()).toBe(false);
  });

  it('shows every settings control to a local browser', async () => {
    const controls = await load();

    controls.setLocalPeer(true);

    for (const id of ['open-settings', 'settings-theme-group', 'settings-player-group', 'power-btn']) {
      expect(element(id).hidden, id).toBe(false);
    }
    expect(element('settings-remote-note').hidden).toBe(true);
    expect(controls.canChangePlayerSettings()).toBe(true);
  });

  it('shows Log out to a remote admin session and keeps the local-only controls hidden', async () => {
    const controls = await load();

    controls.setLocalPeer(false);
    controls.showAdminControls();

    expect(element('logout-btn').hidden).toBe(false);
    for (const id of ['settings-theme-group', 'settings-player-group', 'power-btn']) {
      expect(element(id).hidden, id).toBe(true);
    }
    expect(controls.canChangePlayerSettings()).toBe(false);
  });
});

describe('settings.js', () => {
  const API = '../../../src/webui/public/api.js';
  const LOCAL_CONTROLS = '../../../src/webui/public/local-controls.js';
  const THEME = '../../../src/webui/public/theme.js';

  let openHandler: () => void = () => undefined;
  const showModal = vi.fn();
  const getJson = vi.fn();
  let mayChangeSettings = false;

  beforeEach(() => {
    showModal.mockReset();
    getJson.mockReset().mockResolvedValue(null);
    const fake = (id: string): Record<string, unknown> => ({
      hidden: false,
      textContent: '',
      addEventListener: (_event: string, handler: () => void) => {
        if (id === 'open-settings') openHandler = handler;
      },
      querySelectorAll: () => [],
      showModal,
    });
    vi.stubGlobal('document', { getElementById: fake });
    vi.resetModules();
    vi.doMock(API, () => ({ FAILED_TEXT: 'That action failed. Try again.', getJson, postJson: vi.fn() }));
    vi.doMock(LOCAL_CONTROLS, () => ({ canChangePlayerSettings: () => mayChangeSettings }));
    vi.doMock(THEME, () => ({ applyTheme: vi.fn() }));
  });

  afterEach(() => {
    vi.doUnmock(API);
    vi.doUnmock(LOCAL_CONTROLS);
    vi.doUnmock(THEME);
    vi.unstubAllGlobals();
  });

  const open = async (): Promise<void> => {
    const settings = (await import('../../../src/webui/public/settings.js')) as unknown as { bindSettings: () => void };
    settings.bindSettings();
    openHandler();
    await vi.waitFor(() => expect(showModal).toHaveBeenCalled());
  };

  it('opens for a remote browser without reading the player settings', async () => {
    mayChangeSettings = false;

    await open();

    expect(getJson).not.toHaveBeenCalled();
  });

  it('reads the player settings for a local browser', async () => {
    mayChangeSettings = true;

    await open();

    expect(getJson).toHaveBeenCalledWith('/api/player/settings');
  });
});

describe('openAllSettings in settings.js', () => {
  const API = '../../../src/webui/public/api.js';
  const LOCAL_CONTROLS = '../../../src/webui/public/local-controls.js';
  const THEME = '../../../src/webui/public/theme.js';
  const SETTINGS_URL = 'http://127.0.0.1:5555/';

  type StatusLine = { textContent: string };
  type OpenAllSettings = (statusLine: StatusLine) => Promise<void>;

  const postJson = vi.fn();
  const windowOpen = vi.fn();
  let tab: { opener: unknown; location: { href: string }; close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    tab = { opener: {}, location: { href: '' }, close: vi.fn() };
    postJson.mockReset();
    windowOpen.mockReset().mockReturnValue(tab);
    vi.stubGlobal('document', {
      getElementById: () => ({ textContent: '', addEventListener: () => undefined, querySelectorAll: () => [] }),
    });
    vi.stubGlobal('window', { open: windowOpen });
    vi.resetModules();
    vi.doMock(API, () => ({ FAILED_TEXT: 'That action failed. Try again.', getJson: vi.fn(), postJson }));
    vi.doMock(LOCAL_CONTROLS, () => ({ canChangePlayerSettings: () => true }));
    vi.doMock(THEME, () => ({ applyTheme: vi.fn() }));
  });

  afterEach(() => {
    vi.doUnmock(API);
    vi.doUnmock(LOCAL_CONTROLS);
    vi.doUnmock(THEME);
    vi.unstubAllGlobals();
  });

  const load = async (): Promise<OpenAllSettings> =>
    ((await import('../../../src/webui/public/settings.js')) as unknown as { openAllSettings: OpenAllSettings }).openAllSettings;

  it('opens the tab before the request leaves, then points it at the settings page', async () => {
    const openAllSettings = await load();
    const statusLine = { textContent: 'old' };
    let answer: (value: unknown) => void = () => undefined;
    postJson.mockReturnValue(new Promise((resolve) => { answer = resolve; }));

    const opening = openAllSettings(statusLine);

    expect(windowOpen).toHaveBeenCalledWith('', '_blank');
    expect(tab.opener).toBeNull();
    expect(postJson).toHaveBeenCalledWith('/api/player/settings-page');
    expect(windowOpen.mock.invocationCallOrder[0]).toBeLessThan(postJson.mock.invocationCallOrder[0] ?? 0);
    answer({ ok: true, status: 200, data: { url: SETTINGS_URL } });
    await opening;
    expect(tab.location.href).toBe(SETTINGS_URL);
    expect(tab.close).not.toHaveBeenCalled();
    expect(statusLine.textContent).toBe('');
  });

  it('closes the tab and shows the server error when the request fails', async () => {
    const openAllSettings = await load();
    const statusLine = { textContent: '' };
    postJson.mockResolvedValue({ ok: false, status: 500, data: { error: 'The settings page failed to start: listen EACCES' } });

    await openAllSettings(statusLine);

    expect(tab.close).toHaveBeenCalledTimes(1);
    expect(tab.location.href).toBe('');
    expect(statusLine.textContent).toBe('The settings page failed to start: listen EACCES');
  });

  it('closes the tab and shows the generic failure when no answer arrives', async () => {
    const openAllSettings = await load();
    const statusLine = { textContent: '' };
    postJson.mockResolvedValue({ ok: false, status: null, data: null });

    await openAllSettings(statusLine);

    expect(tab.close).toHaveBeenCalledTimes(1);
    expect(statusLine.textContent).toBe('That action failed. Try again.');
  });

  it('names the blocked tab and starts no settings server when the browser refuses the tab', async () => {
    const openAllSettings = await load();
    const statusLine = { textContent: '' };
    windowOpen.mockReturnValue(null);

    await openAllSettings(statusLine);

    expect(postJson).not.toHaveBeenCalled();
    expect(statusLine.textContent).toBe('The browser blocked the new tab. Allow pop-ups for this page, then try again.');
  });
});

describe('network-info.js hints', () => {
  const API = '../../../src/webui/public/api.js';
  const LOCAL_CONTROLS = '../../../src/webui/public/local-controls.js';
  const SETTINGS = '../../../src/webui/public/settings.js';
  const RESTART = 'then shut down the player and start it again.';

  interface FakeNode {
    children: unknown[];
    textContent: string;
    handlers: Record<string, () => unknown>;
    [key: string]: unknown;
  }

  const getJson = vi.fn();
  const openAllSettings = vi.fn();
  let isLocal = true;
  let elements = new Map<string, FakeNode>();

  const node = (): FakeNode => {
    const el: FakeNode = {
      children: [],
      textContent: '',
      handlers: {},
      append: (...nodes: unknown[]) => { el.children.push(...nodes); },
      replaceChildren: (...nodes: unknown[]) => { el.children = nodes; },
      addEventListener: (event: string, handler: () => unknown) => { el.handlers[event] = handler; },
      showModal: () => undefined,
    };
    return el;
  };
  const byId = (id: string): FakeNode => {
    if (!elements.has(id)) elements.set(id, node());
    return elements.get(id) as FakeNode;
  };

  beforeEach(() => {
    elements = new Map();
    getJson.mockReset();
    openAllSettings.mockReset();
    vi.stubGlobal('document', { getElementById: byId, createElement: () => node() });
    vi.resetModules();
    vi.doMock(API, () => ({ getJson }));
    vi.doMock(LOCAL_CONTROLS, () => ({ canChangePlayerSettings: () => isLocal }));
    vi.doMock(SETTINGS, () => ({ openAllSettings }));
  });

  afterEach(() => {
    vi.doUnmock(API);
    vi.doUnmock(LOCAL_CONTROLS);
    vi.doUnmock(SETTINGS);
    vi.unstubAllGlobals();
  });

  async function showNetworkInfo(info: Record<string, unknown>): Promise<unknown[]> {
    getJson.mockResolvedValue({ localhostUrl: 'http://127.0.0.1:8808/', interfaces: [], ...info });
    const module = (await import('../../../src/webui/public/network-info.js')) as unknown as { bindNetworkInfo: () => void };
    module.bindNetworkInfo();
    await byId('open-network-info').handlers['click']?.();
    return byId('network-info-hint').children;
  }

  it('gives a local viewer of a loopback bind the Expose on LAN step and an All settings button', async () => {
    isLocal = true;

    const [text, , button] = await showNetworkInfo({ lanReachable: false, expose: false });

    expect(text).toBe(`Turn on Expose on LAN in All settings, ${RESTART}`);
    expect((button as FakeNode).textContent).toBe('All settings');
    (button as FakeNode).handlers['click']?.();
    expect(openAllSettings).toHaveBeenCalledWith(byId('network-info-status'));
  });

  it('gives a local viewer of a loopback bind host the Bind host step and an All settings button', async () => {
    isLocal = true;

    const [text, , button] = await showNetworkInfo({ lanReachable: false, expose: true });

    expect(text).toBe(`The bind host is a loopback address, which overrides Expose on LAN. Clear Bind host in the Jukebox Remote section of All settings, ${RESTART}`);
    expect((button as FakeNode).textContent).toBe('All settings');
  });

  it("names the player's computer to a remote viewer, with no button", async () => {
    isLocal = false;

    const children = await showNetworkInfo({ lanReachable: false, expose: false });

    expect(children).toEqual([`Turn on Expose on LAN in the settings on the player's computer, ${RESTART}`]);
  });

  it("names the Bind host section on the player's computer to a remote viewer, with no button", async () => {
    isLocal = false;

    const children = await showNetworkInfo({ lanReachable: false, expose: true });

    expect(children).toEqual([
      `The bind host is a loopback address, which overrides Expose on LAN. Clear Bind host in the Jukebox Remote section of the settings on the player's computer, ${RESTART}`,
    ]);
  });

  it('shows no button when the player is reachable on the LAN', async () => {
    isLocal = true;

    const children = await showNetworkInfo({
      lanReachable: true,
      expose: true,
      interfaces: [{ iface: 'eth0', address: '192.168.1.20', url: 'http://192.168.1.20:8808/' }],
    });

    expect(children).toEqual(['']);
  });
});
