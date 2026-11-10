/**
 * Navidrome MCP Server - Settings form test
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// src/config-app/public/ is outside eslint and type checking, and no DOM library runs in vitest.
// app.js runs here in a node:vm context over stub elements, and the page source is read as text.

import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';

const PUBLIC_DIR = new URL('../../../src/config-app/public/', import.meta.url);
const read = (file: string): string => readFileSync(new URL(file, PUBLIC_DIR), 'utf8');

const HTML = read('index.html');
const APP_SOURCE = read('app.js');

const ADVANCED_SECTION = HTML.slice(HTML.indexOf('<details id="advancedSettings"'), HTML.indexOf('</details>'));
const OPEN_PART = HTML.replace(ADVANCED_SECTION, '');
const ADVANCED_IDS = new Set([...ADVANCED_SECTION.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
const controlIds = (markup: string): string[] => [...markup.matchAll(/<(?:input|select)[^>]*\bid="([^"]+)"/g)].map((match) => match[1] ?? '');

interface StubEvent { target?: StubElement; preventDefault?: () => void }

interface StubElement {
  id: string;
  value: string;
  checked: boolean;
  hidden: boolean;
  disabled: boolean;
  open: boolean;
  type: string;
  textContent: string;
  className: string;
  dataset: Record<string, string>;
  selectedOptions: Array<{ dataset: Record<string, string> }>;
  addEventListener: (type: string, listener: (event: StubEvent) => void) => void;
  dispatch: (type: string, event: StubEvent) => void;
  contains: (other: StubElement | null) => boolean;
  setAttribute: (name: string, value: string) => void;
  toggleAttribute: (name: string, force: boolean) => void;
  querySelector: (selector: string) => StubElement;
  click: () => void;
  replaceChildren: (...children: StubElement[]) => void;
  appended: StubElement[];
  append: (...items: Array<StubElement | string>) => void;
  /** Each item append() added, in order. */
  added: Array<StubElement | string>;
  attributes: Record<string, string>;
  href?: string;
  target?: string;
  rel?: string;
}

type Payload = Record<string, Record<string, unknown>>;

interface FormApi {
  collectChecked: (
    confirmPassword?: boolean,
  ) => { webui: { auth: { adminPassword: string } } } | null;
  populate: (seed: unknown) => void;
  renderAuthMode: () => void;
  renderAdminPasswordConfirm: () => void;
  renderAdminPasswordState: () => void;
  renderExposeWarning: () => void;
  renderTransport: () => void;
  renderTranscode: () => void;
  bindRevealButton: (button: StubElement) => void;
  markPasswordStored: () => void;
  storeProblemMessage: (problem: string, unreadable: boolean, salvaged: boolean) => string;
  showStoreNotices: (notices: unknown) => void;
  showPath: (elementId: string, path: unknown) => void;
  onSave: (event: StubEvent) => Promise<void>;
  onTest: () => Promise<void>;
  onCreateShortcut: () => Promise<void>;
}

function stubElement(): StubElement {
  const listeners: Record<string, Array<(event: StubEvent) => void>> = {};
  const children: Record<string, StubElement> = {};
  const element: StubElement = {
    id: '',
    value: '',
    checked: false,
    hidden: false,
    disabled: false,
    open: false,
    type: 'text',
    textContent: '',
    className: '',
    dataset: {},
    selectedOptions: [],
    attributes: {},
    addEventListener: (type, listener) => {
      (listeners[type] ??= []).push(listener);
    },
    dispatch: (type, event) => {
      for (const listener of listeners[type] ?? []) listener(event);
    },
    // The Advanced section holds the ids its markup holds. Every other stub holds nothing.
    contains: (other) => element.id === 'advancedSettings' && other !== null && ADVANCED_IDS.has(other.id),
    setAttribute: (name, value) => {
      element.attributes[name] = value;
    },
    toggleAttribute: (name, force) => {
      if (name === 'hidden') element.hidden = force;
    },
    querySelector: (selector) => (children[selector] ??= stubElement()),
    click: () => {
      element.dispatch('click', {});
    },
    appended: [],
    replaceChildren: (...replacements) => {
      element.appended = replacements;
    },
    added: [],
    append: (...items) => {
      element.added.push(...items);
    },
  };
  return element;
}

/** A fixed answer, or a function of the request index that answers later or out of order. */
type LibraryAnswer = Record<string, unknown> | ((request: number) => Promise<Record<string, unknown>>);

interface SavedResponse { ok: boolean; body: Record<string, unknown> }

interface LoadedForm {
  api: FormApi;
  byId: (id: string) => StubElement;
  /** The body of each POST, in order. */
  posts: Payload[];
  /** The headers of each POST, in order. */
  postHeaders: Record<string, string>[];
  /** The settings each seed request answers with. A successful Save merges into it, and a test edits it as another writer. */
  store: Record<string, unknown>;
  /** False makes each seed request answer an error. */
  seedResponse: { ok: boolean };
  /** The body of each POST to the library list route, in order. */
  libraryPosts: Payload[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function mergeInto(target: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    const current = target[key];
    if (isRecord(value) && isRecord(current)) mergeInto(current, value);
    else target[key] = isRecord(value) ? structuredClone(value) : value;
  }
}

// Mirrors saveSettings in routes.ts: the store keeps each key the post omits, and a typed admin password becomes a stored hash.
function storeSave(store: Record<string, unknown>, post: Record<string, unknown>): void {
  mergeInto(store, post);
  store['storeUsable'] = true;
  const webui = store['webui'];
  const auth = isRecord(webui) ? webui['auth'] : undefined;
  if (!isRecord(auth)) return;
  if (typeof auth['adminPassword'] === 'string' && auth['adminPassword'] !== '') auth['adminPasswordSet'] = true;
  delete auth['adminPassword'];
}

/**
 * With no seed, fetch rejects and init() takes its fallback path. With a seed, init() loads it as
 * the page does, and each POST answers with `saveResponse`.
 */
async function loadForm(
  seed: Record<string, unknown> | null = null,
  saveResponse: SavedResponse = { ok: true, body: { ok: true } },
  seedResponse: { ok: boolean } = { ok: true },
  libraryAnswer: LibraryAnswer = { ok: false, error: 'Navidrome is not reachable' },
): Promise<LoadedForm> {
  const elements = new Map<string, StubElement>();
  const posts: Payload[] = [];
  const postHeaders: Record<string, string>[] = [];
  const libraryPosts: Payload[] = [];
  const store: Record<string, unknown> = structuredClone(seed ?? {});
  const byId = (id: string): StubElement => {
    let element = elements.get(id);
    if (element === undefined) {
      element = stubElement();
      element.id = id;
      elements.set(id, element);
    }
    return element;
  };
  const respond = (ok: boolean, body: unknown): Promise<unknown> => Promise.resolve({ ok, json: () => Promise.resolve(body) });
  const fetchStub = (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }): Promise<unknown> => {
    if (seed === null) return Promise.reject(new Error('offline'));
    if (url === '/api/settings/libraries') {
      libraryPosts.push(JSON.parse(init?.body ?? '{}') as Payload);
      return typeof libraryAnswer === 'function' ? libraryAnswer(libraryPosts.length - 1).then((body) => ({ ok: true, json: () => Promise.resolve(body) })) : respond(true, libraryAnswer);
    }
    if (init?.method === 'POST') {
      const post = JSON.parse(init.body ?? '{}') as Payload;
      posts.push(post);
      postHeaders.push(init.headers ?? {});
      if (url === '/api/settings' && saveResponse.ok && saveResponse.body['ok'] === true) storeSave(store, post);
      return respond(saveResponse.ok, saveResponse.body);
    }
    if (url === '/api/settings/seed') {
      return seedResponse.ok ? respond(true, store) : respond(false, { error: 'Failed to read settings' });
    }
    return respond(true, { devices: [] });
  };
  const context = createContext({
    document: { getElementById: byId, querySelectorAll: () => [], createElement: stubElement },
    fetch: fetchStub,
    crypto: globalThis.crypto,
  });
  runInContext(`${APP_SOURCE}\nglobalThis.api = { collectChecked, populate, renderAuthMode, renderAdminPasswordConfirm, renderAdminPasswordState, renderExposeWarning, renderTransport, renderTranscode, bindRevealButton, storeProblemMessage, showStoreNotices, showPath, onSave, onTest, onCreateShortcut, markPasswordStored: () => { adminPasswordSet = true; } };`, context);
  // A macrotask runs after every promise init() chains on the stub fetch.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { api: (context as { api: FormApi }).api, byId, posts, postHeaders, store, seedResponse, libraryPosts };
}

const NAVIDROME_SEED = { url: 'http://h:4533', username: 'u', password: '********' };
const SUBMIT: StubEvent = { preventDefault: () => undefined };

describe('admin password confirmation', () => {
  let form: LoadedForm;

  beforeEach(async () => {
    form = await loadForm();
    form.byId('webuiAuthMode').value = 'password';
    form.byId('webuiAdminPassword').value = 'correct horse battery';
  });

  it('refuses a save when the confirm field differs', () => {
    form.byId('webuiAdminPasswordConfirm').value = 'correct horse batterX';

    expect(form.api.collectChecked(true)).toBeNull();
    expect(form.byId('status').textContent).toBe('The passwords do not match.');
  });

  it('refuses a save when the confirm field is blank', () => {
    expect(form.api.collectChecked(true)).toBeNull();
    expect(form.byId('status').textContent).toBe('The passwords do not match.');
  });

  it('accepts a save when both fields match', () => {
    form.byId('webuiAdminPasswordConfirm').value = 'correct horse battery';

    const payload = form.api.collectChecked(true);

    expect(payload?.webui.auth.adminPassword).toBe('correct horse battery');
  });

  it('accepts a connection test with a blank confirm field', () => {
    const payload = form.api.collectChecked();

    expect(payload?.webui.auth.adminPassword).toBe('correct horse battery');
  });

  it('still length-checks the password on a connection test', () => {
    form.byId('webuiAdminPassword').value = 'short';

    expect(form.api.collectChecked()).toBeNull();
    expect(form.byId('status').textContent).toContain('must be');
  });

  it('refuses 7 characters with the 8 to 128 rule and accepts 8', () => {
    form.byId('webuiAdminPassword').value = '7 chars';
    expect(form.api.collectChecked()).toBeNull();
    expect(form.byId('status').textContent).toBe('The admin password must be 8 to 128 characters.');

    form.byId('webuiAdminPassword').value = '8 chars!';
    expect(form.api.collectChecked()?.webui.auth.adminPassword).toBe('8 chars!');
  });

  it('accepts a password mode with no stored password and a blank field', () => {
    form.byId('webuiAdminPassword').value = '';

    expect(form.api.collectChecked(true)).not.toBeNull();
  });

  it('says only this computer logs in while no password is stored', () => {
    form.api.renderAdminPasswordState();
    expect(form.byId('webuiAdminPasswordState').textContent)
      .toBe('No password is set. Only this computer can log in as admin. Use 8 to 128 characters.');

    form.api.markPasswordStored();
    form.api.renderAdminPasswordState();
    expect(form.byId('webuiAdminPasswordState').textContent).toBe('A password is set. Leave blank to keep it.');
  });

  it('shows the ask-on-this-computer row only in a login mode, and leaves the stored choice alone in mode none', () => {
    const row = form.byId('webuiAskPasswordHereRow');
    form.byId('webuiAskPasswordHere').checked = false;

    form.api.renderAuthMode();
    expect(row.hidden).toBe(false);
    expect(form.api.collectChecked()?.webui.auth).toMatchObject({ askPasswordOnThisComputer: false });

    form.byId('webuiAuthMode').value = 'none';
    form.api.renderAuthMode();
    expect(row.hidden).toBe(true);
    expect(form.api.collectChecked()?.webui.auth).not.toHaveProperty('askPasswordOnThisComputer');
  });

  it('keeps the stored password when both fields are blank', () => {
    form.api.markPasswordStored();
    form.byId('webuiAdminPassword').value = '';

    expect(form.api.collectChecked(true)).not.toBeNull();
  });

  it('ignores a mismatch typed before Access was set to Open', () => {
    form.byId('webuiAuthMode').value = 'none';
    form.byId('webuiAdminPasswordConfirm').value = 'something else entirely';

    expect(form.api.collectChecked(true)).not.toBeNull();
  });

  it('shows the confirm field only while a login mode holds a typed password', () => {
    const row = form.byId('webuiAdminPasswordConfirmRow');

    form.api.renderAdminPasswordConfirm();
    expect(row.hidden).toBe(false);

    form.byId('webuiAdminPassword').value = '';
    form.api.renderAdminPasswordConfirm();
    expect(row.hidden).toBe(true);

    form.byId('webuiAdminPassword').value = 'typed again';
    form.byId('webuiAuthMode').value = 'none';
    form.api.renderAdminPasswordConfirm();
    expect(row.hidden).toBe(true);
  });
});

describe('radio and lyrics checkboxes', () => {
  interface FeaturesPayload { features: Record<string, unknown> }

  it('checks each box from the seed', async () => {
    const form = await loadForm();

    form.api.populate({ features: { radio: false, lyrics: true } });

    expect(form.byId('radio').checked).toBe(false);
    expect(form.byId('lyrics').checked).toBe(true);
  });

  it.each([
    [true, false],
    [false, true],
  ])('posts radio %s and lyrics %s as booleans', async (radio, lyrics) => {
    const form = await loadForm();
    form.byId('radio').checked = radio;
    form.byId('lyrics').checked = lyrics;

    const payload = form.api.collectChecked(true) as unknown as FeaturesPayload;

    expect(payload.features['radio']).toBe(radio);
    expect(payload.features['lyrics']).toBe(lyrics);
  });

  it('posts a typed user agent override beside a checked box, and null for a blank one', async () => {
    const form = await loadForm();
    form.byId('radio').checked = true;
    form.byId('radioBrowserUserAgent').value = ' Custom/1.0 ';

    const payload = form.api.collectChecked(true) as unknown as FeaturesPayload;

    expect(payload.features['radioBrowserUserAgent']).toBe('Custom/1.0');
    expect(payload.features['lrclibUserAgent']).toBeNull();
    expect(payload.features).not.toHaveProperty('lyricsProvider');
    expect(payload.features).not.toHaveProperty('musicBrainzUserAgent');
  });
});

describe('settings path display', () => {
  it('replaces the generic name with the path the seed reports', async () => {
    const form = await loadForm();
    form.byId('storePath').textContent = 'settings.json';

    form.api.showPath('storePath', '/home/x/settings.json');

    expect(form.byId('storePath').textContent).toBe('/home/x/settings.json');
  });

  it.each([undefined, null, ''])('keeps the generic name for a seed path of %j', async (path) => {
    const form = await loadForm();
    form.byId('storePath').textContent = 'settings.json';

    form.api.showPath('storePath', path);

    expect(form.byId('storePath').textContent).toBe('settings.json');
  });
});

describe('store problem notice', () => {
  it('promises the backup for a store the server could read', async () => {
    const message = (await loadForm()).api.storeProblemMessage('settings.json is not valid JSON (x)', false, false);

    expect(message).toContain('settings.json.bak');
    expect(message).not.toContain('permissions');
  });

  it('asks for the file to be fixed first when the server cannot read it', async () => {
    const message = (await loadForm()).api.storeProblemMessage('settings.json at x is unreadable (EACCES)', true, false);

    expect(message).toContain("Fix the file's permissions or move it away");
    expect(message).not.toContain('settings.json.bak');
  });

  it("says the form holds none of the file's values when nothing was salvaged", async () => {
    const message = (await loadForm()).api.storeProblemMessage('settings.json is not valid JSON (x)', false, false);

    expect(message).toContain("This form shows default and environment values instead of the file's values.");
    expect(message).not.toContain('each value of the file');
  });

  it("says the form holds the file's accepted values when they were salvaged", async () => {
    const message = (await loadForm()).api.storeProblemMessage('settings.json failed validation (x) [webui.port: bad]', false, true);

    expect(message).toContain('This form shows each value of the file that the server could read and accept.');
    expect(message).not.toContain("instead of the file's values");
  });
});

describe('settings.json notices', () => {
  it('shows one item per notice', async () => {
    const form = await loadForm();
    form.byId('storeNotices').hidden = true;

    form.api.showStoreNotices(['webui.prot is not a setting this version knows. Did you mean webui.port?', 'second']);

    const list = form.byId('storeNotices');
    expect(list.hidden).toBe(false);
    expect(list.appended.map((item) => item.textContent)).toEqual([
      'webui.prot is not a setting this version knows. Did you mean webui.port?',
      'second',
    ]);
  });

  it('replaces the shown notices with the list a save returns', async () => {
    const form = await loadForm();
    form.api.showStoreNotices(['webui.port holds the text "8808"', 'webui.prot is not a setting this version knows.']);

    form.api.showStoreNotices(['webui.prot is not a setting this version knows.']);

    const list = form.byId('storeNotices');
    expect(list.hidden).toBe(false);
    expect(list.appended.map((item) => item.textContent)).toEqual(['webui.prot is not a setting this version knows.']);
  });

  it('empties and hides the list when a save returns no notices', async () => {
    const form = await loadForm();
    form.api.showStoreNotices(['webui.port holds the text "8808"']);

    form.api.showStoreNotices([]);

    const list = form.byId('storeNotices');
    expect(list.hidden).toBe(true);
    expect(list.appended).toEqual([]);
  });

  it.each([undefined, null, []])('keeps the list hidden for a seed value of %j', async (notices) => {
    const form = await loadForm();
    form.byId('storeNotices').hidden = true;

    form.api.showStoreNotices(notices);

    expect(form.byId('storeNotices').hidden).toBe(true);
  });

  it('has a hidden list in the page for the notices', () => {
    expect(HTML).toMatch(/<ul id="storeNotices"[^>]*hidden><\/ul>/);
  });
});

describe('expose warning', () => {
  it.each([
    ['jukebox', false, '', false],
    ['jukebox', true, '', true],
    ['jukebox', false, '0.0.0.0', true],
    ['jukebox', true, '127.0.0.1', false],
    ['jukebox', false, '127.0.0.1', false],
    ['password', false, '', true],
    ['none', false, '', true],
  ])('mode %s, expose %s, host "%s" hides the warning: %s', async (mode, expose, host, hidden) => {
    const form = await loadForm();
    form.byId('webuiAuthMode').value = mode;
    form.byId('webuiExpose').checked = expose;
    form.byId('webuiHost').value = host;

    form.api.renderExposeWarning();

    expect(form.byId('webuiExposeWarn').hidden).toBe(hidden);
  });

  it('names the loopback Bind host as the cause when one is set', async () => {
    const form = await loadForm();
    form.byId('webuiAuthMode').value = 'jukebox';
    form.byId('webuiExpose').checked = true;
    form.byId('webuiHost').value = '127.0.0.1';

    form.api.renderExposeWarning();

    expect(form.byId('webuiExposeWarn').textContent).toContain('Bind host');
  });
});

describe('password reveal button', () => {
  it('toggles the input type, the label and the icon', async () => {
    const form = await loadForm();
    const input = form.byId('webuiAdminPassword');
    const button = stubElement();
    button.dataset['reveal'] = 'webuiAdminPassword';
    input.type = 'password';

    form.api.bindRevealButton(button);
    button.click();

    expect(input.type).toBe('text');
    expect(button.attributes['aria-label']).toBe('Hide password');
    expect(button.querySelector('.icon-show').hidden).toBe(true);
    expect(button.querySelector('.icon-hide').hidden).toBe(false);

    button.click();

    expect(input.type).toBe('password');
    expect(button.attributes['aria-label']).toBe('Show password');
  });
});

describe('settings page markup', () => {
  const OPEN_FIELD_IDS = [
    'url',
    'username',
    'password',
    'lastFmApiKey',
    'radio',
    'lyrics',
    'audioDevice',
    'webuiEnabled',
    'webuiAutoOpen',
    'webuiExpose',
    'webuiAuthMode',
    'webuiAdminPassword',
    'webuiAdminPasswordConfirm',
    'webuiAskPasswordHere',
  ];

  it('shows only the first-run fields outside the Advanced section, in order', () => {
    expect(controlIds(OPEN_PART)).toEqual(OPEN_FIELD_IDS);
  });

  it('puts every other field in one closed Advanced settings section above the Save button', () => {
    expect(controlIds(ADVANCED_SECTION)).toEqual([
      'defaultLibraries',
      'filterCacheEnabled',
      'transportType',
      'transportHost',
      'transportPort',
      'transportExpose',
      'transportAuthToken',
      'transportAllowedHosts',
      'transportAllowedOrigins',
      'radioBrowserUserAgent',
      'radioBrowserBase',
      'lrclibUserAgent',
      'lrclibBase',
      'mpvPath',
      'transcodeFormat',
      'transcodeBitrate',
      'webuiPort',
      'webuiAdminAccess',
      'webuiPublicUrl',
      'webuiTlsCert',
      'webuiTlsKey',
      'webuiHost',
      'webuiAllowedHosts',
      'debug',
    ]);
    expect(HTML).toMatch(/<details id="advancedSettings" class="advanced">\s*<summary>Advanced settings<\/summary>/);
    expect(HTML.match(/<details/g)).toHaveLength(1);
    expect(HTML.indexOf('</details>')).toBeLessThan(HTML.indexOf('id="save-btn"'));
  });

  it('names no other part Advanced', () => {
    expect(HTML.replace('Advanced settings', '')).not.toMatch(/Advanced/);
    expect(HTML).not.toContain('subhead');
  });

  it('drops the player-owned fields, Token expiry and the http only hints', () => {
    expect(HTML + APP_SOURCE).not.toMatch(/webuiPersist|webuiVisualizer|jukeboxGuestQueueLimit|tokenExpiry|Token expiry/);
    expect(APP_SOURCE).not.toMatch(/persistAfterMcpExit|webui\.visualizer|guestQueueLimit|GUEST_QUEUE_LIMIT/);
    expect(HTML).not.toMatch(/http only/i);
  });

  it('shows the radio and lyrics checkboxes, and no user agent or base URL field outside the Advanced section', () => {
    expect(OPEN_PART).toContain('Find internet radio stations');
    expect(OPEN_PART).toContain('Look up lyrics online from LRCLIB');
    expect(OPEN_PART).not.toMatch(/UserAgent|Base"/);
    expect(HTML + APP_SOURCE).not.toMatch(/musicBrainzUserAgent|lyricsProvider|suggestions|addSuggestion/);
  });

  it('uses the Jukebox Remote wording', () => {
    expect(HTML).toContain('<h2>Jukebox Remote</h2>');
    expect(HTML).toContain('Run the Jukebox Remote');
    expect(HTML).not.toMatch(/web player|Web Player|companion control panel/);
  });

  it('names no retired command', () => {
    expect(HTML + APP_SOURCE).not.toMatch(/navidrome-web|navidrome-config/);
  });

  it('states only the settings path in the header', () => {
    const header = /<header class="head">([\s\S]*?)<\/header>/.exec(HTML)?.[1] ?? '';

    expect(header.replace(/\s+/g, ' ').trim()).toBe(
      '<h1>Navidrome MCP Settings</h1> <p class="sub">Saved to <code id="storePath">settings.json</code>.</p>',
    );
  });

  it('gives the Port, Transcode and Allowed hosts hints and the player-owned settings line', () => {
    expect(HTML).toContain('Change it when another program uses 8808.');
    expect(HTML).toContain('keeps the original quality and reliable seeking');
    expect(HTML).toContain("this computer's name and the Public URL host always work. Other host names get 403.");
    expect(HTML).toContain(
      "The player's gear menu sets keep playing and the visualizer. The player's Guests dialog sets the guest song limit. " +
        'The player writes its log to <code id="logPath">',
    );
  });

  it('gives both password fields an eye button', () => {
    expect(HTML).toMatch(/data-reveal="webuiAdminPassword" aria-label="Show password"/);
    expect(HTML).toMatch(/data-reveal="webuiAdminPasswordConfirm" aria-label="Show password"/);
  });

  it('shows the third-party disclaimer in the footer', () => {
    expect(HTML).toContain(
      'Navidrome MCP is an independent third-party project. It is not affiliated with or endorsed by the Navidrome project.',
    );
  });
});

describe('Advanced section open rules', () => {
  it('stays closed for a default stdio store', async () => {
    const form = await loadForm({ storeUsable: true, navidrome: NAVIDROME_SEED, transport: { type: 'stdio' }, webui: { port: 8808 } });

    expect(form.byId('advancedSettings').open).toBe(false);
  });

  it.each([
    ['webui.host', { webui: { host: '0.0.0.0' } }],
    ['transport.type', { transport: { type: 'http' } }],
    ['advanced.debug', { advanced: { debug: true } }],
    ['playback.transcodeFormat', { playback: { transcodeFormat: 'opus' } }],
  ])('opens on load for a non-default %s', async (_path, values) => {
    const form = await loadForm({ storeUsable: true, navidrome: NAVIDROME_SEED, ...values });

    expect(form.byId('advancedSettings').open).toBe(true);
  });

  it('stays closed for a stored http-only value while Type is stdio, since its field is hidden', async () => {
    const form = await loadForm({ storeUsable: true, navidrome: NAVIDROME_SEED, transport: { type: 'stdio', port: 4000 } });

    expect(form.byId('advancedSettings').open).toBe(false);
  });

  it('stays closed for a blank stored transcode format, which the runtime reads as raw', async () => {
    const form = await loadForm({ storeUsable: true, navidrome: NAVIDROME_SEED, playback: { transcodeFormat: '' } });

    expect(form.byId('advancedSettings').open).toBe(false);
  });

  it.each([
    ['anywhere', true],
    ['lan', true],
    ['localhost', false],
  ])('on a switch from Open to a login mode with admin access %s, sets the section open to %s', async (adminAccess, open) => {
    const form = await loadForm({ storeUsable: true, navidrome: NAVIDROME_SEED, webui: { auth: { mode: 'none', adminAccess } } });
    expect(form.byId('advancedSettings').open).toBe(false);

    form.byId('webuiAuthMode').value = 'password';
    form.byId('webuiAuthMode').dispatch('change', {});

    expect(form.byId('advancedSettings').open).toBe(open);
  });

  it('opens on an invalid event from a field inside it, and not from one outside it', async () => {
    const form = await loadForm({ storeUsable: true, navidrome: NAVIDROME_SEED });
    const invalid = (id: string): void => {
      form.byId('settings-form').dispatch('invalid', { target: form.byId(id) });
    };

    invalid('url');
    expect(form.byId('advancedSettings').open).toBe(false);

    invalid('webuiPort');
    expect(form.byId('advancedSettings').open).toBe(true);
  });

  it('opens when a Save error names webui.host', async () => {
    const form = await loadForm(
      { storeUsable: true, navidrome: NAVIDROME_SEED },
      { ok: false, body: { error: 'Configuration validation failed:\nwebui.host: "x" is not supported.' } },
    );

    await form.api.onSave(SUBMIT);

    expect(form.byId('advancedSettings').open).toBe(true);
  });

  it('opens when a Test error names a field inside it at the end of a sentence', async () => {
    const form = await loadForm({ storeUsable: true, navidrome: NAVIDROME_SEED }, { ok: true, body: { ok: false, error: 'Set webui.publicUrl.' } });

    await form.api.onTest();

    expect(form.byId('advancedSettings').open).toBe(true);
  });

  it.each([
    'Configuration validation failed:\nnavidrome.url: Navidrome URL must be a valid URL',
    'webui.portable is not a setting',
  ])('stays closed for an error that names no field inside it: %j', async (error) => {
    const form = await loadForm({ storeUsable: true, navidrome: NAVIDROME_SEED }, { ok: false, body: { error } });

    await form.api.onSave(SUBMIT);

    expect(form.byId('advancedSettings').open).toBe(false);
  });

  it('opens for a Bind host the form rejects before a round trip', async () => {
    const form = await loadForm({ storeUsable: true, navidrome: NAVIDROME_SEED });
    form.byId('webuiHost').value = '10.0.0.5';

    await form.api.onSave(SUBMIT);

    expect(form.posts).toEqual([]);
    expect(form.byId('advancedSettings').open).toBe(true);
  });
});

describe('transport and transcode rows', () => {
  const HTTP_ONLY_IDS = ['transportHost', 'transportPort', 'transportExpose', 'transportAuthToken', 'transportAllowedHosts', 'transportAllowedOrigins'];

  it('shows and enables the http-only fields only while Type is http', async () => {
    const form = await loadForm();
    form.byId('transportType').value = 'stdio';
    form.api.renderTransport();

    expect(form.byId('transportHttpFields').hidden).toBe(true);
    for (const id of HTTP_ONLY_IDS) expect(form.byId(id).disabled).toBe(true);
    expect(form.api.collectChecked()).not.toHaveProperty('transport.port');

    form.byId('transportType').value = 'http';
    form.api.renderTransport();

    expect(form.byId('transportHttpFields').hidden).toBe(false);
    for (const id of HTTP_ONLY_IDS) expect(form.byId(id).disabled).toBe(false);
    expect(form.api.collectChecked()).toHaveProperty('transport.port', 3000);
  });

  it.each([
    ['', true],
    ['raw', true],
    ['opus', false],
  ])('hides the bitrate for format "%s": %s', async (format, hidden) => {
    const form = await loadForm();
    form.byId('transcodeFormat').value = format;

    form.api.renderTranscode();

    expect(form.byId('transcodeBitrateRow').hidden).toBe(hidden);
    expect(form.byId('transcodeBitrate').disabled).toBe(hidden);
  });
});

describe('Save posts only changed fields', () => {
  const STORED = {
    storeUsable: true,
    navidrome: NAVIDROME_SEED,
    webui: { port: 8808, autoOpenBrowser: false, publicUrl: 'https://music.example' },
  };

  it('posts only the changed field, so a gear-menu change to the browser auto-open survives', async () => {
    const form = await loadForm(STORED);
    form.byId('webuiPort').value = '9000';

    await form.api.onSave(SUBMIT);

    expect(form.posts).toEqual([{ webui: { port: 9000 } }]);
  });

  it('posts a field the user cleared as its empty value', async () => {
    const form = await loadForm(STORED);
    form.byId('webuiPublicUrl').value = '';

    await form.api.onSave(SUBMIT);

    expect(form.posts).toEqual([{ webui: { publicUrl: null } }]);
  });

  it('posts a typed admin password, and the next Save posts nothing', async () => {
    const form = await loadForm({ ...STORED, webui: { ...STORED.webui, auth: { mode: 'password' } } });
    form.byId('webuiAdminPassword').value = 'correct horse battery';
    form.byId('webuiAdminPasswordConfirm').value = 'correct horse battery';

    await form.api.onSave(SUBMIT);
    await form.api.onSave(SUBMIT);

    expect(form.posts).toEqual([{ webui: { auth: { adminPassword: 'correct horse battery' } } }, {}]);
    expect(form.byId('webuiAdminPassword').value).toBe('');
  });

  it('posts a password typed before an Open save once Access returns to Password', async () => {
    const form = await loadForm({ ...STORED, webui: { ...STORED.webui, auth: { mode: 'password' } } });
    form.byId('webuiAdminPassword').value = 'correct horse battery';
    form.byId('webuiAdminPasswordConfirm').value = 'correct horse battery';
    form.byId('webuiAuthMode').value = 'none';
    form.api.renderAuthMode();
    await form.api.onSave(SUBMIT);
    form.byId('webuiAuthMode').value = 'password';
    form.api.renderAuthMode();

    await form.api.onSave(SUBMIT);

    expect(form.posts[0]).toEqual({ webui: { auth: { mode: 'none' } } });
    expect(form.posts[1]).toMatchObject({ webui: { auth: { mode: 'password', adminPassword: 'correct horse battery' } } });
  });

  it('shows a value another writer stored after a Save, and the next Save posts nothing', async () => {
    const form = await loadForm(STORED);
    (form.store['webui'] as Record<string, unknown>)['autoOpenBrowser'] = true;
    form.byId('webuiPort').value = '9000';

    await form.api.onSave(SUBMIT);
    await form.api.onSave(SUBMIT);

    expect(form.byId('webuiAutoOpen').checked).toBe(true);
    expect(form.byId('webuiPort').value).toBe('9000');
    expect(form.posts).toEqual([{ webui: { port: 9000 } }, {}]);
  });

  it('keeps the form and posts nothing on the next Save when the store cannot be read after a Save', async () => {
    const form = await loadForm(STORED);
    form.seedResponse.ok = false;
    (form.store['webui'] as Record<string, unknown>)['autoOpenBrowser'] = true;
    form.byId('webuiPort').value = '9000';

    await form.api.onSave(SUBMIT);
    await form.api.onSave(SUBMIT);

    expect(form.byId('webuiAutoOpen').checked).toBe(false);
    expect(form.posts).toEqual([{ webui: { port: 9000 } }, {}]);
  });

  it('posts the change again after a failed Save', async () => {
    const form = await loadForm(STORED, { ok: false, body: { error: 'Failed to write settings' } });
    form.byId('webuiPort').value = '9000';

    await form.api.onSave(SUBMIT);
    await form.api.onSave(SUBMIT);

    expect(form.posts).toEqual([{ webui: { port: 9000 } }, { webui: { port: 9000 } }]);
  });

  it('marks a changed-fields Save, so the server can refuse it over a store that turned unusable', async () => {
    const form = await loadForm(STORED);
    form.byId('webuiPort').value = '9000';

    await form.api.onSave(SUBMIT);

    expect(form.postHeaders[0]).toMatchObject({ 'X-Settings-Changed-Only': '1' });
  });

  it('posts every enabled field on Test connection, with no changed-fields mark', async () => {
    const form = await loadForm(STORED);

    await form.api.onTest();

    expect(form.postHeaders[0]).not.toHaveProperty('X-Settings-Changed-Only');

    expect(form.posts[0]).toMatchObject({
      navidrome: NAVIDROME_SEED,
      transport: { type: 'stdio' },
      webui: { port: 8808, autoOpenBrowser: false, publicUrl: 'https://music.example' },
    });
  });
});

describe('first-run Save', () => {
  it.each([
    ['an env import', { storeUsable: false }],
    ['a voided store', { storeUsable: false, storeProblem: 'settings.json failed validation (x) [webui.port: bad]', storeSalvaged: true }],
  ])('posts every pre-filled value over %s', async (_label, state) => {
    const form = await loadForm({
      ...state,
      navidrome: NAVIDROME_SEED,
      features: { radio: true, lyrics: true },
      playback: { transcodeFormat: 'raw', transcodeBitrate: '192' },
      webui: { enabled: true, port: 8808, autoOpenBrowser: false },
    });

    await form.api.onSave(SUBMIT);

    expect(form.posts).toHaveLength(1);
    expect(form.postHeaders[0]).not.toHaveProperty('X-Settings-Changed-Only');
    expect(form.posts[0]).toMatchObject({
      navidrome: NAVIDROME_SEED,
      transport: { type: 'stdio' },
      features: { radio: true, lyrics: true, lastFmApiKey: null },
      playback: { transcodeFormat: 'raw', audioDevice: null },
      webui: { enabled: true, port: 8808, autoOpenBrowser: false, expose: false, auth: { mode: 'none' } },
      library: { filterCacheEnabled: true, defaultLibraryIds: [] },
      advanced: { debug: false },
    });
  });

  it('posts only the changed field on the next Save', async () => {
    const form = await loadForm({ storeUsable: false, navidrome: NAVIDROME_SEED, webui: { port: 8808 } });

    await form.api.onSave(SUBMIT);
    form.byId('webuiPort').value = '9000';
    await form.api.onSave(SUBMIT);

    expect(form.posts).toHaveLength(2);
    expect(form.posts[1]).toEqual({ webui: { port: 9000 } });
  });
});

describe('save result', () => {
  const ADMIN_URL = 'http://127.0.0.1:9911/admin';

  it('lists the next steps under the message and links the Jukebox Remote address', async () => {
    const form = await loadForm({ storeUsable: false, navidrome: NAVIDROME_SEED }, {
      ok: true,
      body: {
        ok: true,
        message: 'Settings saved to /s/settings.json.',
        nextSteps: [{ text: 'Quit your AI app fully and open it again.' }, { text: 'Open it at', url: ADMIN_URL }],
      },
    });

    await form.api.onSave(SUBMIT);

    const status = form.byId('status');
    expect(status.textContent).toBe('Settings saved to /s/settings.json.');
    expect(status.className).toBe('status show ok');
    const items = (status.added[0] as StubElement).added as StubElement[];
    expect(items.map((item) => item.textContent)).toEqual(['Quit your AI app fully and open it again.', 'Open it at']);
    expect(items[0]?.added).toEqual([]);
    expect(items[1]?.added[1]).toMatchObject({ href: ADMIN_URL, textContent: ADMIN_URL, target: '_blank', rel: 'noopener noreferrer' });
  });

  it('turns off Save and Test after a Save that closed the page', async () => {
    const form = await loadForm({ storeUsable: false, navidrome: NAVIDROME_SEED }, {
      ok: true,
      body: { ok: true, message: 'Settings saved to /s/settings.json.', nextSteps: [{ text: 'The Jukebox Remote is starting.' }], pageClosed: true },
    });

    await form.api.onSave(SUBMIT);

    expect(form.byId('save-btn').disabled).toBe(true);
    expect(form.byId('test-btn').disabled).toBe(true);
    expect(form.byId('status').className).toBe('status show ok');
  });

  it('keeps Save and Test on after a Save that leaves the page open', async () => {
    const form = await loadForm({ storeUsable: false, navidrome: NAVIDROME_SEED });

    await form.api.onSave(SUBMIT);

    expect(form.byId('save-btn').disabled).toBe(false);
    expect(form.byId('test-btn').disabled).toBe(false);
  });

  it('shows a save the Jukebox Remote could not start from as an error with no steps', async () => {
    const message = 'Settings saved to /s/settings.json. The Jukebox Remote could not start. Fix the settings and save again. Error: 401';
    const form = await loadForm({ storeUsable: false, navidrome: NAVIDROME_SEED }, { ok: true, body: { ok: true, startFailed: true, message } });

    await form.api.onSave(SUBMIT);

    const status = form.byId('status');
    expect(status.textContent).toBe(message);
    expect(status.className).toBe('status show err');
    expect(status.added).toEqual([]);
  });
});

describe('desktop shortcut button', () => {
  const PATHS = ['/home/u/.local/share/applications/jukebox-remote.desktop', '/home/u/Desktop/jukebox-remote.desktop'];

  it('posts to the shortcut route and lists each written path under the message', async () => {
    const message = 'Created the Jukebox Remote shortcut. Double-click it to start the Jukebox Remote.';
    const form = await loadForm({ storeUsable: true, navidrome: NAVIDROME_SEED }, { ok: true, body: { ok: true, message, paths: PATHS } });

    await form.api.onCreateShortcut();

    const status = form.byId('shortcutStatus');
    expect(form.posts).toEqual([{}]);
    expect(status.textContent).toBe(message);
    expect(status.className).toBe('status show ok');
    const items = (status.added[0] as StubElement).added as StubElement[];
    expect(items.map((item) => item.textContent)).toEqual(PATHS);
    expect(form.byId('shortcut-btn').disabled).toBe(false);
    expect(form.byId('status').textContent).toBe('');
  });

  it('shows a failure answer as an error with no list', async () => {
    const error = 'Could not create the shortcut: Built player not found at /p/dist/web/main.js. Build it first with: pnpm build';
    const form = await loadForm({ storeUsable: true, navidrome: NAVIDROME_SEED }, { ok: true, body: { ok: false, error } });

    await form.api.onCreateShortcut();

    const status = form.byId('shortcutStatus');
    expect(status.textContent).toBe(error);
    expect(status.className).toBe('status show err');
    expect(status.added).toEqual([]);
  });

  it('turns the button off while the request runs', async () => {
    const form = await loadForm({ storeUsable: true, navidrome: NAVIDROME_SEED }, { ok: true, body: { ok: true, message: 'Created.', paths: [] } });

    const pending = form.api.onCreateShortcut();
    expect(form.byId('shortcut-btn').disabled).toBe(true);
    expect(form.byId('shortcutStatus').className).toBe('status show info');
    await pending;

    expect(form.byId('shortcut-btn').disabled).toBe(false);
  });

  it('turns the button off after a Save that closed the page', async () => {
    const form = await loadForm({ storeUsable: false, navidrome: NAVIDROME_SEED }, {
      ok: true,
      body: { ok: true, message: 'Settings saved to /s/settings.json.', nextSteps: [], pageClosed: true },
    });

    await form.api.onSave(SUBMIT);

    expect(form.byId('shortcut-btn').disabled).toBe(true);
  });
});

describe('seed failure', () => {
  it.each([
    ['a failed request', null, true],
    ['an error answer', {}, false],
  ])('fills each field from its default after %s', async (_label, seed, seedOk) => {
    const form = await loadForm(seed, undefined, { ok: seedOk });

    expect(form.byId('status').textContent).toBe('Could not load the saved settings. The form shows default values.');
    for (const id of ['radio', 'lyrics', 'webuiEnabled', 'filterCacheEnabled', 'webuiAskPasswordHere']) {
      expect(form.byId(id).checked, id).toBe(true);
    }
    expect(form.byId('transportType').value).toBe('stdio');
    expect(form.byId('advancedSettings').open).toBe(false);
  });
});

describe('library picker', () => {
  const TWO_LIBRARIES = { ok: true, libraries: [{ id: 1, name: 'Music' }, { id: 2, name: 'Podcasts' }] };
  const STORED_LOGIN = { storeUsable: true, navidrome: NAVIDROME_SEED };
  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  interface Choice { label: string; box: StubElement }

  // Each choice is a label that holds a checkbox, then the library name.
  function choices(form: LoadedForm): Choice[] {
    return form.byId('libraryChoices').appended.map((row) => {
      const [box, text] = row.added as StubElement[];
      return { label: text?.textContent ?? '', box: box as StubElement };
    });
  }

  function toggle(box: StubElement): void {
    box.checked = !box.checked;
    box.dispatch('change', {});
  }

  it('shows the text field when the list cannot load', async () => {
    const form = await loadForm(STORED_LOGIN);

    expect(form.libraryPosts).toHaveLength(1);
    expect(form.byId('defaultLibrariesRow').hidden).toBe(false);
    expect(form.byId('libraryPicker').hidden).toBe(true);
  });

  it('asks for the list on load only when the form holds a login', async () => {
    const form = await loadForm({ storeUsable: true, navidrome: { url: 'http://h:4533', username: 'u' } });

    expect(form.libraryPosts).toEqual([]);
    expect(form.byId('defaultLibrariesRow').hidden).toBe(false);
  });

  it('posts the form fields with the mask in place of the password', async () => {
    const form = await loadForm(STORED_LOGIN, undefined, undefined, TWO_LIBRARIES);

    expect(form.libraryPosts[0]).toMatchObject({ navidrome: NAVIDROME_SEED });
  });

  it('shows one named checkbox per library and hides the text field', async () => {
    const form = await loadForm({ ...STORED_LOGIN, library: { defaultLibraryIds: [2] } }, undefined, undefined, TWO_LIBRARIES);

    expect(form.byId('libraryPicker').hidden).toBe(false);
    expect(form.byId('defaultLibrariesRow').hidden).toBe(true);
    expect(choices(form).map(({ label, box }) => [label, box.value, box.checked])).toEqual([
      ['Music', '1', false],
      ['Podcasts', '2', true],
    ]);
  });

  it('writes the checked IDs on Save', async () => {
    const form = await loadForm(STORED_LOGIN, undefined, undefined, TWO_LIBRARIES);
    const [music] = choices(form);

    toggle(music?.box as StubElement);
    await form.api.onSave(SUBMIT);

    expect(form.posts).toEqual([{ library: { defaultLibraryIds: [1] } }]);
  });

  it('posts an empty list when every box is cleared, which means all libraries', async () => {
    const form = await loadForm({ ...STORED_LOGIN, library: { defaultLibraryIds: [2] } }, undefined, undefined, TWO_LIBRARIES);

    toggle(choices(form)[1]?.box as StubElement);
    await form.api.onSave(SUBMIT);

    expect(form.posts).toEqual([{ library: { defaultLibraryIds: [] } }]);
  });

  it('shows no field for a user with one library', async () => {
    const form = await loadForm(STORED_LOGIN, undefined, undefined, { ok: true, libraries: [{ id: 1, name: 'Music' }] });

    expect(form.byId('libraryPicker').hidden).toBe(true);
    expect(form.byId('defaultLibrariesRow').hidden).toBe(true);
  });

  it('keeps the text field when the list is empty', async () => {
    const form = await loadForm(STORED_LOGIN, undefined, undefined, { ok: true, libraries: [] });

    expect(form.byId('libraryPicker').hidden).toBe(true);
    expect(form.byId('defaultLibrariesRow').hidden).toBe(false);
  });

  it('shows a stored ID the user cannot see as not found, and keeps it through a Save', async () => {
    const form = await loadForm({ ...STORED_LOGIN, library: { defaultLibraryIds: [2, 9] } }, undefined, undefined, TWO_LIBRARIES);

    expect(choices(form).map(({ label, box }) => [label, box.checked])).toEqual([
      ['Music', false],
      ['Podcasts', true],
      ['Library 9 (not found)', true],
    ]);

    toggle(choices(form)[0]?.box as StubElement);
    await form.api.onSave(SUBMIT);

    expect(form.posts).toEqual([{ library: { defaultLibraryIds: [1, 2, 9] } }]);
  });

  it('posts nothing for the library setting when no box changed', async () => {
    const form = await loadForm({ ...STORED_LOGIN, library: { defaultLibraryIds: [2, 9] } }, undefined, undefined, TWO_LIBRARIES);

    await form.api.onSave(SUBMIT);

    expect(form.posts).toEqual([{}]);
  });

  it('asks for the list again after a successful Test connection', async () => {
    const form = await loadForm({ ...STORED_LOGIN, library: { defaultLibraryIds: [1] } });
    expect(form.byId('libraryPicker').hidden).toBe(true);

    await form.api.onTest();
    await flush();

    expect(form.libraryPosts).toHaveLength(2);
  });

  it('keeps the newer list when an older answer arrives after it', async () => {
    let answerLoad: (body: Record<string, unknown>) => void = () => undefined;
    const slowLoad = new Promise<Record<string, unknown>>((resolve) => {
      answerLoad = resolve;
    });
    const form = await loadForm(
      STORED_LOGIN,
      undefined,
      undefined,
      (request) => (request === 0 ? slowLoad : Promise.resolve(TWO_LIBRARIES)),
    );

    await form.api.onTest();
    await flush();
    expect(choices(form).map(({ label }) => label)).toEqual(['Music', 'Podcasts']);

    answerLoad({ ok: true, libraries: [{ id: 1, name: 'Music' }] });
    await flush();

    expect(form.byId('libraryPicker').hidden).toBe(false);
    expect(choices(form).map(({ label }) => label)).toEqual(['Music', 'Podcasts']);
  });

  it.each(['url', 'username', 'password'])('returns the text field when the %s field is edited', async (id) => {
    const form = await loadForm({ ...STORED_LOGIN, library: { defaultLibraryIds: [2] } }, undefined, undefined, TWO_LIBRARIES);
    expect(form.byId('libraryPicker').hidden).toBe(false);

    toggle(choices(form)[0]?.box as StubElement);
    form.byId(id).dispatch('input', {});

    expect(form.byId('libraryPicker').hidden).toBe(true);
    expect(form.byId('defaultLibrariesRow').hidden).toBe(false);
    expect(form.byId('defaultLibraries').value).toBe('1,2');
  });

  it('drops a list that arrives after the login was edited', async () => {
    let answerLoad: (body: Record<string, unknown>) => void = () => undefined;
    const slowLoad = new Promise<Record<string, unknown>>((resolve) => {
      answerLoad = resolve;
    });
    const form = await loadForm(STORED_LOGIN, undefined, undefined, () => slowLoad);

    form.byId('url').dispatch('input', {});
    answerLoad(TWO_LIBRARIES);
    await flush();

    expect(form.byId('libraryPicker').hidden).toBe(true);
    expect(form.byId('defaultLibrariesRow').hidden).toBe(false);
  });

  it('asks for no list after a failed Test connection', async () => {
    const form = await loadForm(STORED_LOGIN, { ok: true, body: { ok: false, error: 'Login failed' } });

    await form.api.onTest();
    await flush();

    expect(form.libraryPosts).toHaveLength(1);
  });
});
