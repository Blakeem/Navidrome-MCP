/**
 * Navidrome MCP Server - Admin header layout test
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// src/webui/public/ is outside eslint and type checking, and no DOM library runs in vitest. These
// checks read the page source, so a renamed id or a moved button fails here and not in a browser.

import { existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { noticeDocument } from './fake-notice.js';

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
      /<p class="modal-hint" id="all-settings-hint">Navidrome connection, admin password, access and more\.<\/p>$/,
    );
  });

  it('holds a device Theme group with Light and Dark only, hidden until a remote browser shows it', () => {
    const group = between(settingsDialog, 'id="settings-device-theme-group"', '</fieldset>');

    expect(settingsDialog).toContain('<fieldset class="settings-group" id="settings-device-theme-group" hidden>');
    expect(idsOf(group, /<input[^>]*name="device-theme" id="([^"]+)"/g)).toEqual(['device-theme-light', 'device-theme-dark']);
    expect(group).toContain('<div class="mode-toggle theme-toggle">');
    expect(group).toContain('<p class="modal-hint">Applies to this device only.</p>');
  });

  it("words the host's Theme hint for the per-device choice", () => {
    const group = between(settingsDialog, 'id="settings-theme-group"', '</fieldset>');

    expect(group).toContain(
      '<p class="modal-hint">Light and Dark apply to every device, guests included. With System, each device picks its own.</p>',
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
  const MODULES = ['guests.js', 'guests-list.js', 'local-controls.js', 'network-info.js', 'settings.js', 'settings-device-theme.js'];

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
  const postLogin = vi.fn();
  const replaceState = vi.fn();
  const ADMIN_ADDRESS = 'http://127.0.0.1:8808/admin';
  const LAUNCH_KEY = 'k'.repeat(43);
  let session: Record<string, unknown> | null = null;
  let location: { href: string; reload: ReturnType<typeof vi.fn>; replace: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    setLocalPeer.mockReset();
    postLogin.mockReset();
    replaceState.mockReset();
    location = { href: ADMIN_ADDRESS, reload: vi.fn(), replace: vi.fn() };
    vi.stubGlobal('window', { location, history: { state: null, replaceState } });
    vi.resetModules();
    for (const module of mockedModules) {
      vi.doMock(`${MODULE_DIR}${module.file}`, () => ({
        ...Object.fromEntries(module.names.map((name) => [name, vi.fn()])),
        ...(module.file === 'local-controls.js' ? { setLocalPeer } : {}),
        ...(module.file === 'api.js'
          ? { getJson: vi.fn((url: string) => Promise.resolve(url === '/api/auth/session' ? session : null)), postLogin }
          : {}),
      }));
    }
  });

  afterEach(() => {
    for (const module of mockedModules) vi.doUnmock(`${MODULE_DIR}${module.file}`);
    vi.unstubAllGlobals();
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

  it("logs the player's computer in with the launch key from its address, then boots the player", async () => {
    const adminSession = { mode: 'jukebox', role: 'admin', isLocal: true, passwordlessHere: true, csrfToken: 'token' };
    session = { mode: 'jukebox', role: 'anonymous', isLocal: true, adminLoginAvailable: true, passwordlessHere: true };
    location.href = `${ADMIN_ADDRESS}?launch=${LAUNCH_KEY}`;
    postLogin.mockImplementation(() => {
      session = adminSession;
      return Promise.resolve({ ok: true, status: 200, data: null });
    });

    await boot();
    const api = await import('../../../src/webui/public/api.js');

    expect(replaceState).toHaveBeenCalledExactlyOnceWith(null, '', ADMIN_ADDRESS);
    expect(replaceState.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(api.getJson).mock.invocationCallOrder[0] ?? 0);
    expect(postLogin).toHaveBeenCalledWith('', LAUNCH_KEY);
    expect(setLocalPeer).toHaveBeenCalledWith(true);
  });

  it.each([
    ['holds', `${ADMIN_ADDRESS}?launch=${LAUNCH_KEY}`, true],
    ['holds no', ADMIN_ADDRESS, false],
  ])('tells the admin controls the page %s launch key', async (_label, href, holdsLaunchKey) => {
    session = { mode: 'jukebox', role: 'admin', isLocal: true, passwordlessHere: true, csrfToken: 'token' };
    location.href = href;

    await boot();
    const controls = await import('../../../src/webui/public/local-controls.js');

    expect(controls.showAdminControls).toHaveBeenCalledExactlyOnceWith(session, holdsLaunchKey);
  });

  it('leaves an address with no launch key unchanged and posts the login with no key', async () => {
    session = { mode: 'jukebox', role: 'anonymous', isLocal: true, adminLoginAvailable: true, passwordlessHere: true };
    postLogin.mockResolvedValue({ ok: false, status: 503, data: { error: 'No admin password is set.' } });

    await import('../../../src/webui/public/app.js');
    const loginView = await import('../../../src/webui/public/login-view.js');

    await vi.waitFor(() => expect(loginView.showLoginView).toHaveBeenCalled());
    expect(replaceState).not.toHaveBeenCalled();
    expect(postLogin).toHaveBeenCalledWith('', null);
  });

  it('shows the password field when the server answers the keyless passwordless login with 401', async () => {
    session = { mode: 'jukebox', role: 'anonymous', isLocal: true, adminLoginAvailable: true, passwordlessHere: true };
    postLogin.mockResolvedValue({ ok: false, status: 401, data: { error: 'Enter the admin password.' } });

    await import('../../../src/webui/public/app.js');
    const loginView = await import('../../../src/webui/public/login-view.js');

    await vi.waitFor(() => expect(loginView.showLoginView).toHaveBeenCalledWith({ ...session, passwordlessHere: false }));
    expect(setLocalPeer).not.toHaveBeenCalled();
  });

  it.each([
    ['the refusal', { error: 'Too many passwordless logins. Try again in 60 seconds.' }, 'Too many passwordless logins. Try again in 60 seconds.'],
    ['null for an answer with no error', null, null],
  ])("passes %s to the login view when the player's computer is refused a passwordless login", async (_label, data, loginError) => {
    session = { mode: 'jukebox', role: 'anonymous', isLocal: true, adminLoginAvailable: true, passwordlessHere: true };
    postLogin.mockResolvedValue({ ok: false, status: 429, data });

    await import('../../../src/webui/public/app.js');
    const loginView = await import('../../../src/webui/public/login-view.js');

    await vi.waitFor(() => expect(loginView.showLoginView).toHaveBeenCalledWith({ ...session, loginError }));
    expect(setLocalPeer).not.toHaveBeenCalled();
  });

  it.each([
    ['reloads to log in again for a passwordless session', { mode: 'jukebox', role: 'anonymous', passwordlessHere: true }, true],
    ['shows the login view for any other session', { mode: 'jukebox', role: 'anonymous', adminLoginAvailable: true }, false],
  ])('after a 401, %s', async (_label, ended, reloads) => {
    const { reload } = location;
    session = { mode: 'jukebox', role: 'admin', isLocal: true, csrfToken: 'token' };
    await boot();
    const api = await import('../../../src/webui/public/api.js');
    const loginView = await import('../../../src/webui/public/login-view.js');
    const onLoginRequired = vi.mocked(api.setLoginRequiredHandler).mock.calls[0]?.[0] as () => void;
    session = ended;

    onLoginRequired();

    await vi.waitFor(() => expect(reloads ? reload : loginView.showLoginView).toHaveBeenCalled());
    expect(reloads ? loginView.showLoginView : reload).not.toHaveBeenCalled();
  });

  it('after a 401, opens the address with the launch key again for a passwordless session, so the new page logs in with it', async () => {
    location.href = `${ADMIN_ADDRESS}?launch=${LAUNCH_KEY}`;
    replaceState.mockImplementation((_state: unknown, _title: string, address: string) => {
      location.href = address;
    });
    session = { mode: 'jukebox', role: 'admin', isLocal: true, csrfToken: 'token' };
    await boot();
    const api = await import('../../../src/webui/public/api.js');
    const onLoginRequired = vi.mocked(api.setLoginRequiredHandler).mock.calls[0]?.[0] as () => void;
    session = { mode: 'jukebox', role: 'anonymous', passwordlessHere: true };

    onLoginRequired();

    await vi.waitFor(() => expect(location.replace).toHaveBeenCalledWith(`${ADMIN_ADDRESS}?launch=${LAUNCH_KEY}`));
    expect(location.reload).not.toHaveBeenCalled();
  });

  it.each([
    ["the player view on the player's computer", { mode: 'jukebox', role: 'admin', isLocal: true, csrfToken: 'token' }, 1],
    ["the login view on the player's computer", { mode: 'jukebox', role: 'anonymous', isLocal: true, adminLoginAvailable: true }, 1],
    ['the login view on another browser', { mode: 'jukebox', role: 'anonymous', isLocal: false, adminLoginAvailable: true }, 0],
    ['the player view on another browser', { mode: 'jukebox', role: 'admin', isLocal: false, csrfToken: 'token' }, 0],
  ])('drops the stored device theme choice only for the player\'s computer, in %s', async (_label, loaded, calls) => {
    session = loaded;
    await import('../../../src/webui/public/app.js');
    const loginView = await import('../../../src/webui/public/login-view.js');
    const themeModule = await import('../../../src/webui/public/theme.js');
    await vi.waitFor(() => expect(vi.mocked(loginView.showLoginView).mock.calls.length + setLocalPeer.mock.calls.length).toBeGreaterThan(0));

    expect(vi.mocked(themeModule.ignoreDeviceTheme)).toHaveBeenCalledTimes(calls);
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
    textContent?: string;
    setAttribute: (name: string) => void;
    removeAttribute: (name: string) => void;
    addEventListener: () => void;
    querySelector: () => FakeElement;
  }
  type LocalControls = {
    setLocalPeer: (isLocal: boolean) => void;
    showAdminControls: (session: Record<string, unknown>, holdsLaunchKey: boolean) => void;
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
    controls.showAdminControls({}, false);

    expect(element('logout-btn').hidden).toBe(false);
    expect(element('no-admin-password-notice').hidden).toBe(true);
    for (const id of ['settings-theme-group', 'settings-player-group', 'power-btn']) {
      expect(element(id).hidden, id).toBe(true);
    }
    expect(controls.canChangePlayerSettings()).toBe(false);
  });

  it("hides Log out from a passwordless page with the launch key and shows the server's notice while no admin password is set", async () => {
    const controls = await load();
    const message = 'No admin password is set. Other devices cannot log in. Set WEBUI_ADMIN_PASSWORD and restart the player.';

    controls.setLocalPeer(true);
    controls.showAdminControls({ passwordlessHere: true, noAdminPasswordMessage: message }, true);

    expect(element('logout-btn').hidden).toBe(true);
    expect(element('no-admin-password-notice').hidden).toBe(false);
    expect(element('no-admin-password-notice').textContent).toBe(message);
  });

  it('shows Log out to a passwordless source whose page holds no launch key, such as a tunnel on the host', async () => {
    const controls = await load();

    controls.setLocalPeer(true);
    controls.showAdminControls({ passwordlessHere: true }, false);

    expect(element('logout-btn').hidden).toBe(false);
  });
});

describe('settings.js', () => {
  const API = '../../../src/webui/public/api.js';
  const LOCAL_CONTROLS = '../../../src/webui/public/local-controls.js';
  const THEME = '../../../src/webui/public/theme.js';

  const SESSION_ONLY = 'Applied for this session only. settings.json was not saved.';
  const STORED = { theme: null, persistAfterMcpExit: false, autoOpenBrowser: false, visualizer: true };

  interface FakeControl {
    checked: boolean;
    textContent: string;
    dataset: Record<string, string>;
    handlers: Record<string, () => void>;
    [key: string]: unknown;
  }

  const showModal = vi.fn();
  const getJson = vi.fn();
  const postJson = vi.fn();
  let mayChangeSettings = false;
  let elements = new Map<string, FakeControl>();
  let form = { inert: false, busy: false };
  let notice = noticeDocument();

  const element = (id: string): FakeControl => {
    if (!elements.has(id)) {
      const el: FakeControl = {
        hidden: false,
        checked: false,
        textContent: '',
        dataset: {},
        handlers: {},
        addEventListener: (event: string, handler: () => void) => { el.handlers[event] = handler; },
        querySelectorAll: () => [],
        querySelector: () => form,
        showModal,
      };
      elements.set(id, el);
    }
    return elements.get(id) as FakeControl;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    elements = new Map();
    form = {
      inert: false,
      busy: false,
      setAttribute: () => { form.busy = true; },
      removeAttribute: () => { form.busy = false; },
      contains: () => false,
    } as typeof form;
    showModal.mockReset();
    getJson.mockReset().mockResolvedValue(null);
    postJson.mockReset();
    notice = noticeDocument();
    vi.stubGlobal('document', { getElementById: element, ...notice.parts });
    vi.resetModules();
    vi.doMock(API, () => ({ FAILED_TEXT: 'That action failed. Try again.', getJson, postJson }));
    vi.doMock(LOCAL_CONTROLS, () => ({ canChangePlayerSettings: () => mayChangeSettings }));
    vi.doMock(THEME, () => ({ applyTheme: vi.fn() }));
  });

  afterEach(() => {
    vi.doUnmock(API);
    vi.doUnmock(LOCAL_CONTROLS);
    vi.doUnmock(THEME);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const open = async (): Promise<void> => {
    const settings = (await import('../../../src/webui/public/settings.js')) as unknown as { bindSettings: () => void };
    settings.bindSettings();
    element('open-settings').handlers['click']?.();
    await vi.waitFor(() => expect(showModal).toHaveBeenCalled());
  };

  // Toggles Keep playing and resolves once the save's answer has been applied.
  const toggleKeepPlaying = async (answer: { ok: boolean; status: number; data: unknown }): Promise<void> => {
    let reply: (value: unknown) => void = () => undefined;
    postJson.mockReturnValue(new Promise((resolve) => { reply = resolve; }));
    element('set-persist').checked = true;
    element('set-persist').handlers['change']?.();
    await vi.waitFor(() => expect(postJson).toHaveBeenCalled());
    expect(form.inert).toBe(true);
    expect(form.busy).toBe(true);
    reply(answer);
    await vi.waitFor(() => expect(form.inert).toBe(false));
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

  it('shows a failed settings load as an error after the dialog opens', async () => {
    mayChangeSettings = true;
    getJson.mockResolvedValue(null);

    await open();

    expect(notice.shown()).toEqual({ text: 'Could not load settings.', tone: 'error' });
    expect(element('set-persist')['disabled']).toBe(true);
  });

  it('blocks the form during a toggle save, then shows Saved. and clears it after its reading time', async () => {
    mayChangeSettings = true;
    getJson.mockResolvedValue(STORED);
    await open();

    await toggleKeepPlaying({ ok: true, status: 200, data: { ...STORED, persistAfterMcpExit: true, persisted: true } });

    expect(postJson).toHaveBeenCalledWith('/api/player/settings', { persistAfterMcpExit: true });
    expect(form.busy).toBe(false);
    expect(notice.shown()).toEqual({ text: 'Saved.', tone: 'success' });
    vi.advanceTimersByTime(2500 + 150);
    expect(notice.shown().text).toBe('');
  });

  it('keeps the session-only warning in the notice', async () => {
    mayChangeSettings = true;
    getJson.mockResolvedValue(STORED);
    await open();

    await toggleKeepPlaying({ ok: true, status: 200, data: { ...STORED, persistAfterMcpExit: true, persisted: false } });
    vi.advanceTimersByTime(60_000);

    expect(notice.shown()).toEqual({ text: SESSION_ONLY, tone: 'warning' });
  });

  it('puts the control back and keeps the error when a save fails', async () => {
    mayChangeSettings = true;
    getJson.mockResolvedValue(STORED);
    await open();

    await toggleKeepPlaying({ ok: false, status: 500, data: null });
    vi.advanceTimersByTime(60_000);

    expect(element('set-persist').checked).toBe(false);
    expect(notice.shown()).toEqual({ text: 'Could not save settings.', tone: 'error' });
  });
});

describe('openAllSettings in settings.js', () => {
  const API = '../../../src/webui/public/api.js';
  const LOCAL_CONTROLS = '../../../src/webui/public/local-controls.js';
  const THEME = '../../../src/webui/public/theme.js';
  const SETTINGS_URL = 'http://127.0.0.1:5555/';

  type OpenAllSettings = () => Promise<void>;

  const postJson = vi.fn();
  const windowOpen = vi.fn();
  let tab: { opener: unknown; location: { href: string }; close: ReturnType<typeof vi.fn> };
  let notice = noticeDocument();

  beforeEach(() => {
    tab = { opener: {}, location: { href: '' }, close: vi.fn() };
    postJson.mockReset();
    windowOpen.mockReset().mockReturnValue(tab);
    notice = noticeDocument();
    vi.stubGlobal('document', {
      getElementById: () => ({ textContent: '', addEventListener: () => undefined, querySelectorAll: () => [], querySelector: () => ({}) }),
      ...notice.parts,
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
    let answer: (value: unknown) => void = () => undefined;
    postJson.mockReturnValue(new Promise((resolve) => { answer = resolve; }));

    const opening = openAllSettings();

    expect(windowOpen).toHaveBeenCalledWith('', '_blank');
    expect(tab.opener).toBeNull();
    expect(postJson).toHaveBeenCalledWith('/api/player/settings-page');
    expect(windowOpen.mock.invocationCallOrder[0]).toBeLessThan(postJson.mock.invocationCallOrder[0] ?? 0);
    answer({ ok: true, status: 200, data: { url: SETTINGS_URL } });
    await opening;
    expect(tab.location.href).toBe(SETTINGS_URL);
    expect(tab.close).not.toHaveBeenCalled();
    expect(notice.shown().text).toBe('');
  });

  it('clears the error of an earlier open when the next open succeeds', async () => {
    const openAllSettings = await load();
    windowOpen.mockReturnValueOnce(null);
    await openAllSettings();
    expect(notice.shown().tone).toBe('error');
    postJson.mockResolvedValue({ ok: true, status: 200, data: { url: SETTINGS_URL } });

    await openAllSettings();

    expect(tab.location.href).toBe(SETTINGS_URL);
    expect(notice.shown().text).toBe('');
  });

  it('closes the tab and shows the server error when the request fails', async () => {
    const openAllSettings = await load();
    postJson.mockResolvedValue({ ok: false, status: 500, data: { error: 'The settings page failed to start: listen EACCES' } });

    await openAllSettings();

    expect(tab.close).toHaveBeenCalledTimes(1);
    expect(tab.location.href).toBe('');
    expect(notice.shown()).toEqual({ text: 'The settings page failed to start: listen EACCES', tone: 'error' });
  });

  it('closes the tab and shows the generic failure when no answer arrives', async () => {
    const openAllSettings = await load();
    postJson.mockResolvedValue({ ok: false, status: null, data: null });

    await openAllSettings();

    expect(tab.close).toHaveBeenCalledTimes(1);
    expect(notice.shown()).toEqual({ text: 'That action failed. Try again.', tone: 'error' });
  });

  it('names the blocked tab and starts no settings server when the browser refuses the tab', async () => {
    const openAllSettings = await load();
    windowOpen.mockReturnValue(null);

    await openAllSettings();

    expect(postJson).not.toHaveBeenCalled();
    expect(notice.shown()).toEqual({ text: 'The browser blocked the new tab. Allow pop-ups for this page, then try again.', tone: 'error' });
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
      dataset: {},
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
    expect(openAllSettings).toHaveBeenCalledWith();
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

describe('login-view.js', () => {
  const MOCKED = ['api.js', 'connection.js', 'lyrics-view.js'];
  type FakeElement = { hidden: boolean; textContent: string; setAttribute: () => void; removeAttribute: () => void; focus: () => void };
  type LoginView = { showLoginView: (session: Record<string, unknown> | null) => void };

  let elements = new Map<string, FakeElement>();
  let notice = noticeDocument();
  const element = (id: string): FakeElement => elements.get(id) as FakeElement;

  beforeEach(() => {
    elements = new Map();
    notice = noticeDocument();
    const fake = (): FakeElement => {
      const el: FakeElement = {
        hidden: false,
        textContent: '',
        setAttribute: () => { el.hidden = true; },
        removeAttribute: () => { el.hidden = false; },
        focus: () => undefined,
      };
      return el;
    };
    vi.stubGlobal('document', {
      getElementById: (id: string) => {
        if (!elements.has(id)) elements.set(id, fake());
        return elements.get(id);
      },
      querySelectorAll: () => [],
      ...notice.parts,
      body: Object.assign(notice.parts.body, { classList: { add: () => undefined } }),
    });
    vi.resetModules();
    for (const file of MOCKED) {
      vi.doMock(`../../../src/webui/public/${file}`, () => ({ postLogin: vi.fn(), stopConnection: vi.fn(), closeLyrics: vi.fn() }));
    }
  });

  afterEach(() => {
    for (const file of MOCKED) vi.doUnmock(`../../../src/webui/public/${file}`);
    vi.unstubAllGlobals();
  });

  const load = async (): Promise<LoginView> => (await import('../../../src/webui/public/login-view.js')) as unknown as LoginView;
  const NO_PASSWORD_SESSION = {
    mode: 'jukebox',
    role: 'anonymous',
    adminLoginAvailable: true,
    passwordlessHere: true,
    yourAddress: '127.0.0.1',
    noAdminPasswordMessage: 'No admin password is set. Other devices cannot log in. Set one in All settings.',
  };

  it.each([
    ['the refusal', 'Too many passwordless logins. Try again in 60 seconds.', 'Too many passwordless logins. Try again in 60 seconds.'],
    ['the connection failure', null, 'Login failed. Check the connection and try again.'],
  ])('shows %s of a passwordless login in place of the card text', async (_label, loginError, help) => {
    const view = await load();

    view.showLoginView({ ...NO_PASSWORD_SESSION, loginError });

    expect(element('login-help').textContent).toBe(help);
    expect(element('login-fields').hidden).toBe(true);
  });

  it.each([
    ['hides', true, true],
    ['shows', false, false],
  ])('%s the password field for a saved password when passwordlessHere is %s', async (_label, passwordlessHere, hidden) => {
    const view = await load();
    const savedPasswordSession = { mode: 'jukebox', role: 'anonymous', adminLoginAvailable: true, yourAddress: '127.0.0.1' };

    view.showLoginView({ ...savedPasswordSession, passwordlessHere, loginError: 'Too many passwordless logins. Try again in 60 seconds.' });

    expect(element('login-fields').hidden).toBe(hidden);
  });

  it('shows the card text when no passwordless login was refused', async () => {
    const view = await load();

    view.showLoginView(NO_PASSWORD_SESSION);

    expect(element('login-help').textContent).toBe(NO_PASSWORD_SESSION.noAdminPasswordMessage);
  });

  it('clears an error notice on the page, since it would stay over the login card', async () => {
    const view = await load();
    const messages = (await import('../../../src/webui/public/messages.js')) as unknown as { notify: (text: string, tone: string) => void };
    messages.notify('That action failed. Try again.', 'error');
    expect(notice.shown().tone).toBe('error');

    view.showLoginView(NO_PASSWORD_SESSION);

    expect(notice.shown()).toEqual({ text: '', tone: undefined });
  });
});
