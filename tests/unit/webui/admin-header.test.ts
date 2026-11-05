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
    vi.doMock(API, () => ({ getJson, postJson: vi.fn() }));
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
