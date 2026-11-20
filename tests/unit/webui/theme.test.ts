/**
 * Navidrome MCP Server - Jukebox Remote theme test
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// src/webui/public/ is outside eslint and type checking, and no DOM library runs in vitest. These
// tests give theme.js fake globals, so its precedence, storage and change rules run without a browser.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const HOST_HINT_KEY = 'navidrome-mcp.theme';
const DEVICE_KEY = 'navidrome-mcp.device-theme';
const SYSTEM_COLOR = '#system';
const FORCED_COLOR = '#forced';

interface Theme {
  applyTheme: (theme: unknown) => void;
  applyThemeHint: () => void;
  setDeviceTheme: (scheme: unknown) => void;
  ignoreDeviceTheme: () => void;
  paintedScheme: () => string;
  hostThemeIsSystem: () => boolean;
  onThemeChange: (listener: () => void) => void;
}

interface Fake {
  root: { dataset: Record<string, string> };
  meta: { content: string };
  store: Map<string, string>;
  storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn>; removeItem: ReturnType<typeof vi.fn> };
  media: { matches: boolean };
  modeListeners: (() => void)[];
}

let fake: Fake;

function install(options: { deviceDark: boolean; stored?: Record<string, string>; storageThrows?: boolean }): void {
  const store = new Map(Object.entries(options.stored ?? {}));
  const guard = <T>(run: () => T): T => {
    if (options.storageThrows === true) throw new Error('storage blocked');
    return run();
  };
  const modeListeners: (() => void)[] = [];
  fake = {
    root: { dataset: {} },
    meta: { content: SYSTEM_COLOR },
    store,
    storage: {
      getItem: vi.fn((key: string) => guard(() => store.get(key) ?? null)),
      setItem: vi.fn((key: string, value: string) => guard(() => store.set(key, value))),
      removeItem: vi.fn((key: string) => guard(() => store.delete(key))),
    },
    media: { matches: options.deviceDark },
    modeListeners,
  };
  vi.stubGlobal('document', {
    documentElement: fake.root,
    querySelectorAll: () => [fake.meta],
  });
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => ` ${FORCED_COLOR} ` }));
  vi.stubGlobal('window', {
    localStorage: fake.storage,
    matchMedia: () => ({
      get matches() { return fake.media.matches; },
      addEventListener: (_type: string, listener: () => void) => { modeListeners.push(listener); },
    }),
  });
  vi.resetModules();
}

const load = async (): Promise<Theme> => (await import('../../../src/webui/public/theme.js')) as unknown as Theme;

// The device's own mode turns, as a phone's does at night.
function turnDeviceMode(dark: boolean): void {
  fake.media.matches = dark;
  for (const listener of fake.modeListeners) listener();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('theme precedence', () => {
  beforeEach(() => {
    install({ deviceDark: false, stored: { [DEVICE_KEY]: 'dark' } });
  });

  it('paints the host theme over a device choice', async () => {
    const theme = await load();

    theme.applyTheme('light');

    expect(fake.root.dataset['theme']).toBe('light');
    expect(theme.paintedScheme()).toBe('light');
    expect(fake.meta.content).toBe(FORCED_COLOR);
  });

  it('paints the device choice over the device mode while the host theme is System', async () => {
    const theme = await load();

    theme.applyTheme(null);

    expect(fake.root.dataset['theme']).toBe('dark');
    expect(theme.paintedScheme()).toBe('dark');
  });

  it('paints no theme and follows the device mode when no choice is stored', async () => {
    install({ deviceDark: true });
    const theme = await load();

    theme.applyTheme(null);

    expect(fake.root.dataset['theme']).toBeUndefined();
    expect(fake.meta.content).toBe(SYSTEM_COLOR);
    expect(theme.paintedScheme()).toBe('dark');
  });

  it('paints the stored host theme over the device choice before the server answers', async () => {
    install({ deviceDark: false, stored: { [HOST_HINT_KEY]: 'light', [DEVICE_KEY]: 'dark' } });
    const theme = await load();

    theme.applyThemeHint();

    expect(fake.root.dataset['theme']).toBe('light');
    expect(theme.hostThemeIsSystem()).toBe(false);
  });

  it('paints the stored device choice before the server answers when no host theme is stored', async () => {
    const theme = await load();

    theme.applyThemeHint();

    expect(fake.root.dataset['theme']).toBe('dark');
    expect(theme.hostThemeIsSystem()).toBe(false);
  });

  it('stores the host theme the server sends and clears it when the server forces none', async () => {
    const theme = await load();

    theme.applyTheme('light');
    expect(fake.store.get(HOST_HINT_KEY)).toBe('light');
    theme.applyTheme(null);

    expect(fake.store.has(HOST_HINT_KEY)).toBe(false);
  });

  it('treats an unknown host theme as System', async () => {
    const theme = await load();

    theme.applyTheme('sepia');

    expect(theme.hostThemeIsSystem()).toBe(true);
    expect(fake.store.has(HOST_HINT_KEY)).toBe(false);
  });
});

describe('setDeviceTheme', () => {
  it('stores a scheme that differs from the device mode and paints it', async () => {
    install({ deviceDark: false });
    const theme = await load();
    theme.applyTheme(null);

    theme.setDeviceTheme('dark');

    expect(fake.store.get(DEVICE_KEY)).toBe('dark');
    expect(fake.root.dataset['theme']).toBe('dark');
  });

  it('removes the stored choice when the picked scheme equals the device mode', async () => {
    install({ deviceDark: false, stored: { [DEVICE_KEY]: 'dark' } });
    const theme = await load();
    theme.applyTheme(null);

    theme.setDeviceTheme('light');

    expect(fake.store.has(DEVICE_KEY)).toBe(false);
    expect(fake.root.dataset['theme']).toBeUndefined();
    expect(theme.paintedScheme()).toBe('light');
  });

  it('ignores a value that is not a scheme', async () => {
    install({ deviceDark: false });
    const theme = await load();
    theme.applyTheme(null);

    theme.setDeviceTheme('sepia');

    expect(fake.storage.setItem).not.toHaveBeenCalled();
    expect(fake.root.dataset['theme']).toBeUndefined();
  });

  it('drops a stored choice equal to the device mode at load', async () => {
    install({ deviceDark: true, stored: { [DEVICE_KEY]: 'dark' } });
    const theme = await load();

    theme.applyTheme(null);

    expect(fake.store.has(DEVICE_KEY)).toBe(false);
    expect(fake.root.dataset['theme']).toBeUndefined();
  });

  it('keeps the choice for this page when the storage throws', async () => {
    install({ deviceDark: false, storageThrows: true });
    const theme = await load();
    theme.applyThemeHint();
    theme.applyTheme(null);

    theme.setDeviceTheme('dark');

    expect(fake.root.dataset['theme']).toBe('dark');
    expect(theme.paintedScheme()).toBe('dark');
  });
});

describe('ignoreDeviceTheme', () => {
  beforeEach(() => {
    install({ deviceDark: false, stored: { [DEVICE_KEY]: 'dark' } });
  });

  it('paints no device choice, keeps the stored key and still paints a forced host theme', async () => {
    const theme = await load();
    theme.applyThemeHint();

    theme.ignoreDeviceTheme();
    theme.applyTheme(null);

    expect(fake.root.dataset['theme']).toBeUndefined();
    expect(theme.paintedScheme()).toBe('light');
    expect(fake.store.get(DEVICE_KEY)).toBe('dark');
    theme.applyTheme('dark');
    expect(fake.root.dataset['theme']).toBe('dark');
  });

  it('tells the listeners once, then returns early on a repeat', async () => {
    const theme = await load();
    const listener = vi.fn();
    theme.onThemeChange(listener);

    theme.ignoreDeviceTheme();
    theme.ignoreDeviceTheme();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('host theme state', () => {
  beforeEach(() => {
    install({ deviceDark: false });
  });

  it('reports System only after the server answers with no forced theme', async () => {
    const theme = await load();

    theme.applyThemeHint();
    expect(theme.hostThemeIsSystem()).toBe(false);
    theme.applyTheme(null);
    expect(theme.hostThemeIsSystem()).toBe(true);
    theme.applyTheme('dark');

    expect(theme.hostThemeIsSystem()).toBe(false);
  });

  it('returns early on an unchanged state, so a repeated snapshot does no work', async () => {
    const theme = await load();
    const listener = vi.fn();
    theme.onThemeChange(listener);

    theme.applyTheme('dark');
    theme.applyTheme('dark');
    theme.applyTheme('dark');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(fake.storage.setItem).toHaveBeenCalledTimes(1);
  });

  it('tells a listener about each change of the host theme and of the device choice', async () => {
    const theme = await load();
    const listener = vi.fn();
    theme.onThemeChange(listener);

    theme.applyTheme(null);
    theme.setDeviceTheme('dark');
    theme.setDeviceTheme('dark');
    theme.applyTheme('light');

    expect(listener).toHaveBeenCalledTimes(3);
  });
});

describe('the device mode changing', () => {
  it('drops a choice that the new device mode matches and tells the listeners', async () => {
    install({ deviceDark: false, stored: { [DEVICE_KEY]: 'dark' } });
    const theme = await load();
    theme.applyTheme(null);
    const listener = vi.fn();
    theme.onThemeChange(listener);

    turnDeviceMode(true);

    expect(fake.store.has(DEVICE_KEY)).toBe(false);
    expect(fake.root.dataset['theme']).toBeUndefined();
    expect(theme.paintedScheme()).toBe('dark');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('tells the listeners when the device mode decides the painted scheme', async () => {
    install({ deviceDark: false });
    const theme = await load();
    theme.applyTheme(null);
    const listener = vi.fn();
    theme.onThemeChange(listener);

    turnDeviceMode(true);

    expect(theme.paintedScheme()).toBe('dark');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps a choice that differs from the device mode when the mode event repeats the same mode', async () => {
    install({ deviceDark: false, stored: { [DEVICE_KEY]: 'dark' } });
    const theme = await load();
    theme.applyTheme(null);

    turnDeviceMode(false);

    expect(fake.store.get(DEVICE_KEY)).toBe('dark');
    expect(theme.paintedScheme()).toBe('dark');
  });
});
