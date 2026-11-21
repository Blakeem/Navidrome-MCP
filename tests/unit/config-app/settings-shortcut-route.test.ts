/**
 * Navidrome MCP Server - Settings desktop shortcut route test
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// The writer is a stub, so no test writes to the real Desktop. tests/unit/shortcut/create.test.ts covers the writer.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ShortcutResult } from '../../../src/shortcut/create.js';

const { createJukeboxShortcutMock } = vi.hoisted(() => ({ createJukeboxShortcutMock: vi.fn() }));
vi.mock('../../../src/shortcut/create.js', () => ({ createJukeboxShortcut: createJukeboxShortcutMock }));

const { startConfigServer } = await import('../../../src/config-app/server.js');

const DESKTOP_LINK = '/home/u/Desktop/jukebox-remote.desktop';

function result(overrides: Partial<ShortcutResult> = {}): ShortcutResult {
  return { written: [DESKTOP_LINK], runner: null, oldCleanup: { removed: [], kept: [] }, unconfigured: false, ...overrides };
}

describe('POST /api/settings/shortcut', () => {
  let settings: { url: string; close: () => Promise<void> };

  beforeEach(async () => {
    settings = await startConfigServer({ host: 'settings-command' });
  });

  afterEach(async () => {
    await settings.close();
    vi.clearAllMocks();
  });

  const postShortcut = async (headers: Record<string, string> = {}): Promise<{ status: number; json: Record<string, unknown> }> => {
    const res = await fetch(`${settings.url.replace(/\/$/, '')}/api/settings/shortcut`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: '{}',
    });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };

  it('answers the written paths and a message that says how to start the player', async () => {
    createJukeboxShortcutMock.mockResolvedValue(result());

    const { status, json } = await postShortcut();

    expect(status).toBe(200);
    expect(json['ok']).toBe(true);
    expect(json['paths']).toEqual([DESKTOP_LINK]);
    expect(json['message']).toMatch(/^Created the Jukebox Remote shortcut\. Double-click it to start the Jukebox Remote\. Create it again after you move or reinstall navidrome-mcp\./);
  });

  it('names the Windows runner in the message and keeps it out of the paths', async () => {
    const link = 'C:\\Users\\u\\Desktop\\Jukebox Remote.lnk';
    const runner = 'C:\\Users\\u\\AppData\\Local\\navidrome-mcp\\Jukebox Remote.vbs';
    createJukeboxShortcutMock.mockResolvedValue(result({ written: [link], runner }));

    const { json } = await postShortcut();

    expect(json['paths']).toEqual([link]);
    expect(json['message']).toContain(`The shortcut runs ${runner}.`);
  });

  it('names the unconfigured first launch and the old files it removed or kept', async () => {
    createJukeboxShortcutMock.mockResolvedValue(result({
      unconfigured: true,
      oldCleanup: { removed: ['/d/Navidrome Player.lnk'], kept: [{ path: '/d/Navidrome Player.vbs', reason: 'not written by the old generator' }] },
    }));

    const { json } = await postShortcut();

    expect(json['message']).toContain('Navidrome is not configured yet, so the first launch opens this settings page.');
    expect(json['message']).toContain('Removed the old Navidrome Player shortcut files: /d/Navidrome Player.lnk.');
    expect(json['message']).toContain('Left in place: /d/Navidrome Player.vbs (not written by the old generator).');
  });

  it('answers ok false with the cause when the writer fails', async () => {
    createJukeboxShortcutMock.mockRejectedValue(new Error('Built player not found at /p/dist/web/main.js. Build it first with: pnpm build'));

    const { status, json } = await postShortcut();

    expect(status).toBe(200);
    expect(json).toEqual({
      ok: false,
      error: 'Could not create the shortcut: Built player not found at /p/dist/web/main.js. Build it first with: pnpm build',
    });
  });

  it('refuses a cross-origin request before the writer runs', async () => {
    const { status } = await postShortcut({ Origin: 'http://evil.example' });

    expect(status).toBe(403);
    expect(createJukeboxShortcutMock).not.toHaveBeenCalled();
  });
});
