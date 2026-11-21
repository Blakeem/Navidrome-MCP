/**
 * Navidrome MCP Server - Device theme controls test
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// src/webui/public/ is outside eslint and type checking, and no DOM library runs in vitest. These
// tests give the guest header button and the Settings dialog group fake elements, with theme.js real,
// so each control's visibility, icon, name and effect run without a browser.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PUBLIC_DIR = '../../../src/webui/public/';
const LOCAL_CONTROLS = `${PUBLIC_DIR}local-controls.js`;
const DEVICE_KEY = 'navidrome-mcp.device-theme';

interface FakeElement {
  attributes: Map<string, string>;
  hidden: boolean;
  checked: boolean;
  value: string;
  handlers: Record<string, () => void>;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
  addEventListener: (event: string, handler: () => void) => void;
  querySelector: (selector: string) => FakeElement | undefined;
  querySelectorAll: () => FakeElement[];
}

let store: Map<string, string>;
let root: { dataset: Record<string, string> };
let elements: Map<string, FakeElement>;
// The two icons that guest-theme.js finds by class inside the toggle, so they are not in `elements`.
let moon: FakeElement;
let sun: FakeElement;
let radios: FakeElement[];
let mayChangeSettings = false;

function fakeElement(value = ''): FakeElement {
  const el: FakeElement = {
    attributes: new Map(),
    get hidden() { return el.attributes.has('hidden'); },
    checked: false,
    value,
    handlers: {},
    setAttribute: (name, text) => { el.attributes.set(name, text); },
    removeAttribute: (name) => { el.attributes.delete(name); },
    addEventListener: (event, handler) => { el.handlers[event] = handler; },
    querySelector: () => undefined,
    querySelectorAll: () => [],
  } as FakeElement;
  return el;
}

function element(id: string): FakeElement {
  const found = elements.get(id);
  expect(found, `#${id} was looked up`).toBeDefined();
  return found as FakeElement;
}

function install(deviceDark: boolean): void {
  store = new Map();
  root = { dataset: {} };
  moon = fakeElement();
  sun = fakeElement();
  const toggle = fakeElement();
  toggle.querySelector = (selector) => (selector === '.icon-moon' ? moon : sun);
  toggle.setAttribute('hidden', '');
  radios = [fakeElement('light'), fakeElement('dark')];
  const group = fakeElement();
  group.querySelectorAll = () => radios;
  group.setAttribute('hidden', '');
  elements = new Map([
    ['guest-theme-toggle', toggle],
    ['settings-device-theme-group', group],
  ]);
  vi.stubGlobal('document', {
    documentElement: root,
    querySelectorAll: () => [],
    getElementById: (id: string) => elements.get(id),
  });
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '#forced' }));
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
    matchMedia: () => ({ matches: deviceDark, addEventListener: () => undefined }),
  });
  vi.resetModules();
  vi.doMock(LOCAL_CONTROLS, () => ({ canChangePlayerSettings: () => mayChangeSettings }));
}

interface ThemeModule {
  applyTheme: (theme: unknown) => void;
}

const loadTheme = async (): Promise<ThemeModule> => (await import(`${PUBLIC_DIR}theme.js`)) as unknown as ThemeModule;

afterEach(() => {
  vi.doUnmock(LOCAL_CONTROLS);
  vi.unstubAllGlobals();
});

describe('the guest header theme button', () => {
  const bind = async (): Promise<ThemeModule> => {
    const theme = await loadTheme();
    const toggle = (await import(`${PUBLIC_DIR}guest-theme.js`)) as unknown as { bindThemeToggle: () => void };
    toggle.bindThemeToggle();
    return theme;
  };

  beforeEach(() => {
    install(false);
  });

  it('stays hidden until the server says the host theme is System', async () => {
    const theme = await bind();

    expect(element('guest-theme-toggle').hidden).toBe(true);
    theme.applyTheme(null);

    expect(element('guest-theme-toggle').hidden).toBe(false);
  });

  it.each(['light', 'dark'])('stays hidden while the host forces %s', async (forced) => {
    const theme = await bind();

    theme.applyTheme(forced);

    expect(element('guest-theme-toggle').hidden).toBe(true);
  });

  it('shows a moon named Switch to dark mode while the page is light', async () => {
    const theme = await bind();

    theme.applyTheme(null);

    expect(element('guest-theme-toggle').attributes.get('aria-label')).toBe('Switch to dark mode');
    expect(moon.hidden).toBe(false);
    expect(sun.hidden).toBe(true);
  });

  it('switches this browser to dark on a tap, then shows a sun named Switch to light mode', async () => {
    const theme = await bind();
    theme.applyTheme(null);

    element('guest-theme-toggle').handlers['click']?.();

    expect(root.dataset['theme']).toBe('dark');
    expect(store.get(DEVICE_KEY)).toBe('dark');
    expect(element('guest-theme-toggle').attributes.get('aria-label')).toBe('Switch to light mode');
    expect(moon.hidden).toBe(true);
    expect(sun.hidden).toBe(false);
  });

  it('removes the stored choice when a second tap returns to the device mode', async () => {
    const theme = await bind();
    theme.applyTheme(null);

    element('guest-theme-toggle').handlers['click']?.();
    element('guest-theme-toggle').handlers['click']?.();

    expect(store.has(DEVICE_KEY)).toBe(false);
    expect(root.dataset['theme']).toBeUndefined();
    expect(element('guest-theme-toggle').attributes.get('aria-label')).toBe('Switch to dark mode');
  });
});

describe('the Settings dialog device Theme group', () => {
  const bind = async (): Promise<ThemeModule> => {
    const theme = await loadTheme();
    const group = (await import(`${PUBLIC_DIR}settings-device-theme.js`)) as unknown as { bindDeviceTheme: () => void };
    group.bindDeviceTheme();
    return theme;
  };
  const radio = (value: string): FakeElement => radios.find((candidate) => candidate.value === value) as FakeElement;

  beforeEach(() => {
    install(false);
    mayChangeSettings = false;
  });

  it('shows on a remote browser once the server says the host theme is System', async () => {
    const theme = await bind();

    expect(element('settings-device-theme-group').hidden).toBe(true);
    theme.applyTheme(null);

    expect(element('settings-device-theme-group').hidden).toBe(false);
  });

  it('never shows on the player computer', async () => {
    mayChangeSettings = true;
    const theme = await bind();

    theme.applyTheme(null);

    expect(element('settings-device-theme-group').hidden).toBe(true);
  });

  it('hides when the host forces a theme', async () => {
    const theme = await bind();
    theme.applyTheme(null);

    theme.applyTheme('dark');

    expect(element('settings-device-theme-group').hidden).toBe(true);
  });

  it('checks the radio of the painted scheme and changes only this browser on a pick', async () => {
    const theme = await bind();
    theme.applyTheme(null);
    expect(radio('light').checked).toBe(true);
    expect(radio('dark').checked).toBe(false);

    radio('dark').handlers['change']?.();

    expect(root.dataset['theme']).toBe('dark');
    expect(store.get(DEVICE_KEY)).toBe('dark');
    expect(radio('dark').checked).toBe(true);
    expect(radio('light').checked).toBe(false);
  });
});
