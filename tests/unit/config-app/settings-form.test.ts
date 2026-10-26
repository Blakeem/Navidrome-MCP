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

interface StubElement {
  value: string;
  checked: boolean;
  hidden: boolean;
  type: string;
  textContent: string;
  className: string;
  dataset: Record<string, string>;
  selectedOptions: Array<{ dataset: Record<string, string> }>;
  addEventListener: (type: string, listener: () => void) => void;
  setAttribute: (name: string, value: string) => void;
  toggleAttribute: (name: string, force: boolean) => void;
  querySelector: (selector: string) => StubElement;
  click: () => void;
  attributes: Record<string, string>;
}

interface FormApi {
  collectChecked: (confirmPassword?: boolean) => { webui: { auth: { adminPassword: string } } } | null;
  renderAuthMode: () => void;
  renderAdminPasswordConfirm: () => void;
  renderExposeWarning: () => void;
  bindRevealButton: (button: StubElement) => void;
  markPasswordStored: () => void;
}

function stubElement(): StubElement {
  const listeners: Record<string, Array<() => void>> = {};
  const children: Record<string, StubElement> = {};
  const element: StubElement = {
    value: '',
    checked: false,
    hidden: false,
    type: 'text',
    textContent: '',
    className: '',
    dataset: {},
    selectedOptions: [],
    attributes: {},
    addEventListener: (type, listener) => {
      (listeners[type] ??= []).push(listener);
    },
    setAttribute: (name, value) => {
      element.attributes[name] = value;
    },
    toggleAttribute: (name, force) => {
      if (name === 'hidden') element.hidden = force;
    },
    querySelector: (selector) => (children[selector] ??= stubElement()),
    click: () => {
      for (const listener of listeners['click'] ?? []) listener();
    },
  };
  return element;
}

function loadForm(): { api: FormApi; byId: (id: string) => StubElement } {
  const elements = new Map<string, StubElement>();
  const byId = (id: string): StubElement => {
    let element = elements.get(id);
    if (element === undefined) {
      element = stubElement();
      elements.set(id, element);
    }
    return element;
  };
  const context = createContext({
    document: { getElementById: byId, querySelectorAll: () => [], createElement: stubElement },
    // A rejected fetch leaves init() on its fallback path, so the form never reaches the network.
    fetch: () => Promise.reject(new Error('offline')),
    crypto: globalThis.crypto,
  });
  runInContext(`${APP_SOURCE}\nglobalThis.api = { collectChecked, renderAuthMode, renderAdminPasswordConfirm, renderExposeWarning, bindRevealButton, markPasswordStored: () => { adminPasswordSet = true; } };`, context);
  return { api: (context as { api: FormApi }).api, byId };
}

describe('admin password confirmation', () => {
  let form: ReturnType<typeof loadForm>;

  beforeEach(() => {
    form = loadForm();
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

describe('expose warning', () => {
  it.each([
    ['jukebox', false, '', false],
    ['jukebox', true, '', true],
    ['jukebox', false, '0.0.0.0', true],
    ['jukebox', true, '127.0.0.1', false],
    ['jukebox', false, '127.0.0.1', false],
    ['password', false, '', true],
    ['none', false, '', true],
  ])('mode %s, expose %s, host "%s" hides the warning: %s', (mode, expose, host, hidden) => {
    const form = loadForm();
    form.byId('webuiAuthMode').value = mode;
    form.byId('webuiExpose').checked = expose;
    form.byId('webuiHost').value = host;

    form.api.renderExposeWarning();

    expect(form.byId('webuiExposeWarn').hidden).toBe(hidden);
  });

  it('names the loopback Bind host as the cause when one is set', () => {
    const form = loadForm();
    form.byId('webuiAuthMode').value = 'jukebox';
    form.byId('webuiExpose').checked = true;
    form.byId('webuiHost').value = '127.0.0.1';

    form.api.renderExposeWarning();

    expect(form.byId('webuiExposeWarn').textContent).toContain('Bind host');
  });
});

describe('password reveal button', () => {
  it('toggles the input type, the label and the icon', () => {
    const form = loadForm();
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
  const FIELD_ORDER = [
    'id="webuiEnabled"',
    'id="webuiPort"',
    'id="webuiExpose"',
    'id="webuiAuthMode"',
    'id="webuiAdminPassword"',
    'id="webuiAdminPasswordConfirm"',
    'id="webuiAdminAccess"',
    'id="jukeboxGuestQueueLimit"',
    'id="webuiPublicUrl"',
    'id="webuiTlsCert"',
    'id="webuiTlsKey"',
    '<h3 class="subhead">Advanced</h3>',
    'id="webuiHost"',
    'id="webuiAllowedHosts"',
  ];

  it('lists the Web Player fields in order, with the advanced fields last', () => {
    const positions = FIELD_ORDER.map((marker) => HTML.indexOf(marker));

    expect(positions.every((position) => position !== -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('uses the Web Player wording', () => {
    expect(HTML).toContain('<h2>Web Player</h2>');
    expect(HTML).toContain('Run the web player');
    expect(HTML).not.toContain('companion control panel');
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
