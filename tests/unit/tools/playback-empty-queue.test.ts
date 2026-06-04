/**
 * Navidrome MCP Server - empty-queue navigator tests
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
 * Covers the queue NAVIGATORS — next / previous / play_queue_index / resume —
 * when no mpv is running (e.g. the web player was powered off, taking mpv with
 * it). The play queue lives inside mpv, so a fresh spawn would be empty; these
 * tools must therefore attach-only and report an empty queue rather than
 * lazy-spawning an empty player. The engine is mocked: `isRunning()` returns
 * false, and the underlying transport commands must NOT be invoked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const ensureAttachedMock = vi.fn().mockResolvedValue(undefined);
const isRunningMock = vi.fn();
const nextMock = vi.fn().mockResolvedValue(undefined);
const previousMock = vi.fn().mockResolvedValue(undefined);
const resumeMock = vi.fn().mockResolvedValue(undefined);
const pauseMock = vi.fn().mockResolvedValue(undefined);
const seekMock = vi.fn().mockResolvedValue(undefined);
const jumpMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../src/services/playback/playback-engine.js', () => ({
  playbackEngine: {
    ensureAttached: ensureAttachedMock,
    isRunning: isRunningMock,
    next: nextMock,
    previous: previousMock,
    resume: resumeMock,
    pause: pauseMock,
    seek: seekMock,
    jumpToPlaylistEntry: jumpMock,
  },
}));

const { next, previous, resume, pause, seek, playQueueIndex } = await import('../../../src/tools/playback.js');

describe('queue navigators with no live mpv (empty queue)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isRunningMock.mockReturnValue(false); // no mpv attached
  });

  it('next reports an empty queue and does not skip', async () => {
    const result = await next({});
    expect(ensureAttachedMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/empty|nothing/i);
    expect(nextMock).not.toHaveBeenCalled();
  });

  it('previous reports an empty queue and does not skip', async () => {
    const result = await previous({});
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/empty|nothing/i);
    expect(previousMock).not.toHaveBeenCalled();
  });

  it('resume reports nothing to resume and does not unpause', async () => {
    const result = await resume({});
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/nothing to resume/i);
    expect(resumeMock).not.toHaveBeenCalled();
  });

  it('pause reports nothing to pause and does not pause', async () => {
    const result = await pause({});
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/nothing to pause/i);
    expect(pauseMock).not.toHaveBeenCalled();
  });

  it('seek reports nothing to seek and does not seek', async () => {
    const result = await seek({ seconds: 30, mode: 'absolute' });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/nothing to seek/i);
    expect(seekMock).not.toHaveBeenCalled();
  });

  it('play_queue_index reports an empty queue and does not jump', async () => {
    const result = await playQueueIndex({ index: 3 });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/empty|nothing/i);
    expect(jumpMock).not.toHaveBeenCalled();
  });

  it('attaches (never spawns) — ensureAttached is used, ensureRunning is not exposed', async () => {
    await next({});
    await previous({});
    await resume({});
    await pause({});
    await seek({ seconds: 10, mode: 'relative' });
    await playQueueIndex({ index: 0 });
    expect(ensureAttachedMock).toHaveBeenCalledTimes(6);
  });
});

describe('queue navigators with a live mpv pass through to the engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isRunningMock.mockReturnValue(true); // mpv attached + a real queue
  });

  it('next skips and reports success', async () => {
    const result = await next({});
    expect(nextMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });

  it('resume unpauses and reports success', async () => {
    const result = await resume({});
    expect(resumeMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.paused).toBe(false);
  });

  it('pause pauses and reports success', async () => {
    const result = await pause({});
    expect(pauseMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.paused).toBe(true);
  });

  it('seek seeks and reports success', async () => {
    const result = await seek({ seconds: 30, mode: 'absolute' });
    expect(seekMock).toHaveBeenCalledWith(30, 'absolute');
    expect(result.success).toBe(true);
  });

  it('play_queue_index jumps and reports success', async () => {
    const result = await playQueueIndex({ index: 2 });
    expect(jumpMock).toHaveBeenCalledWith(2);
    expect(result.success).toBe(true);
  });
});
