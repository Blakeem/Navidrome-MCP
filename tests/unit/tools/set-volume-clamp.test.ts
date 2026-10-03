/**
 * Navidrome MCP Server - set_volume contract tests
 * Copyright (C) 2025
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Pins the `set_volume` LLM contract: the tool description twice promises that
 * out-of-range levels are CLAMPED (not rejected). The backing schema therefore
 * must accept any finite number and forward it raw to the engine, whose own
 * `setVolume` clamp (playback-engine.setVolume → Math.max(0, Math.min(100, …)))
 * produces the clamped value. A schema regression that re-adds `.min/.max`
 * would turn a documented clamp into a thrown ZodError — a straight contract
 * lie — so we assert here that out-of-range input resolves and reaches the
 * engine unchanged, while non-finite input is still rejected.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// The mock returns a clamped value that differs from an out-of-range input, so the
// tests prove the tool reports the engine's result. The REAL clamp is exercised
// against a fake IPC in tests/unit/services/playback/playback-engine.test.ts.
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
    // The schema must NOT reject 150 — it forwards the raw value to the engine,
    // which owns the [0,100] clamp.
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
