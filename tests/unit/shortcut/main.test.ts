/**
 * Navidrome MCP Server - `navidrome-mcp shortcut` printer tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const { assertPlayerBuiltMock, createJukeboxShortcutMock } = vi.hoisted(() => ({
  assertPlayerBuiltMock: vi.fn(),
  createJukeboxShortcutMock: vi.fn(),
}));

vi.mock('../../../src/shortcut/create.js', () => ({
  assertPlayerBuilt: assertPlayerBuiltMock,
  createJukeboxShortcut: createJukeboxShortcutMock,
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('navidrome-mcp shortcut', () => {
  it('prints only the build error when the player is not built', async () => {
    assertPlayerBuiltMock.mockImplementation(() => {
      throw new Error('Built player not found at /pkg/dist/web/main.js. Build it first with: pnpm build');
    });
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    // The module runs its command on import.
    await import('../../../src/shortcut/main.js');

    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(
      '\n  Could not create the shortcut: Built player not found at /pkg/dist/web/main.js. Build it first with: pnpm build\n\n',
    );
    expect(exit).toHaveBeenCalledWith(1);
    expect(createJukeboxShortcutMock).not.toHaveBeenCalled();
  });
});
