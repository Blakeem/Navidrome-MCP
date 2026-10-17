/**
 * Navidrome MCP Server - set_volume contract tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * The set_volume description promises a clamp, so the schema must pass an out-of-range level
 * through to the engine clamp and reject only a non-finite one.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// The mock clamps, so an out-of-range input shows whether the tool reports the engine's result.
// tests/unit/services/playback/playback-engine.test.ts covers the real clamp.
const setVolumeMock = vi.fn((level: number) => Promise.resolve(Math.max(0, Math.min(100, level))));

vi.mock('../../../src/services/playback/playback-engine.js', () => ({
  playbackEngine: {
    setVolume: setVolumeMock,
  },
}));

const { setVolume } = await import('../../../src/tools/playback.js');

describe('set_volume clamps out-of-range input (does not reject)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts level > 100 and forwards it raw to the engine clamp', async () => {
    await expect(setVolume({ level: 150 })).resolves.toEqual({ success: true, volume: 100 });
    expect(setVolumeMock).toHaveBeenCalledWith(150);
  });

  it('accepts level < 0 and forwards it raw to the engine clamp', async () => {
    await expect(setVolume({ level: -5 })).resolves.toEqual({ success: true, volume: 0 });
    expect(setVolumeMock).toHaveBeenCalledWith(-5);
  });

  it('still accepts an in-range level', async () => {
    await expect(setVolume({ level: 42 })).resolves.toEqual({ success: true, volume: 42 });
    expect(setVolumeMock).toHaveBeenCalledWith(42);
  });

  it('still rejects a non-finite level (NaN / Infinity)', async () => {
    await expect(setVolume({ level: Number.NaN })).rejects.toThrow();
    await expect(setVolume({ level: Number.POSITIVE_INFINITY })).rejects.toThrow();
    expect(setVolumeMock).not.toHaveBeenCalled();
  });
});
