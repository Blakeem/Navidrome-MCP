/**
 * Navidrome MCP Server - PlaybackEngine.isPlaying() unit tests
 * Copyright (C) 2025
 *
 * isPlaying() is a pure read over the engine's cached observed-properties
 * (no IPC round-trip, no spawn), so it can be exercised without a live mpv by
 * driving the singleton's cached state directly. We reach into the private
 * `ipc`/`propertyCache` fields via a typed view because there is no public
 * setter for observed properties — this mirrors exactly what mpv's
 * property-change events populate at runtime. Tests are not linted/typechecked
 * by the quality gates (src-only), so the cast is contained to this file.
 *
 * Semantics under test (standalone-web spec §8.2): biased toward "keep
 * playing" — a freshly-attached engine that hasn't observed idle-active/eof
 * yet still reads as playing, so we never kill a maybe-playing mpv.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { playbackEngine } from '../../../src/services/playback/playback-engine.js';

interface EngineInternals {
  ipc: { isConnected(): boolean } | null;
  propertyCache: Map<string, unknown>;
}

const internals = playbackEngine as unknown as EngineInternals;

function setConnected(connected: boolean): void {
  internals.ipc = connected ? { isConnected: (): boolean => true } : null;
}

function setProps(props: Record<string, unknown>): void {
  internals.propertyCache.clear();
  for (const [name, value] of Object.entries(props)) {
    internals.propertyCache.set(name, value);
  }
}

describe('PlaybackEngine.isPlaying', () => {
  afterEach(() => {
    internals.ipc = null;
    internals.propertyCache.clear();
  });

  it('returns false when there is no live IPC connection', () => {
    setConnected(false);
    setProps({ 'playlist-count': 1, pause: false });
    expect(playbackEngine.isPlaying()).toBe(false);
  });

  it('returns true when connected, queued, unpaused, not idle and not at EOF', () => {
    setConnected(true);
    setProps({ 'playlist-count': 1, pause: false, 'idle-active': false, 'eof-reached': false });
    expect(playbackEngine.isPlaying()).toBe(true);
  });

  it('treats a fresh attach (idle-active/eof not yet observed) as playing — biased toward keep', () => {
    setConnected(true);
    // pause emits its initial value on attach; idle-active and eof-reached do not.
    setProps({ 'playlist-count': 1, pause: false });
    expect(playbackEngine.isPlaying()).toBe(true);
  });

  it('returns false when paused', () => {
    setConnected(true);
    setProps({ 'playlist-count': 1, pause: true });
    expect(playbackEngine.isPlaying()).toBe(false);
  });

  it('returns false when pause has never been observed', () => {
    setConnected(true);
    setProps({ 'playlist-count': 1 });
    expect(playbackEngine.isPlaying()).toBe(false);
  });

  it('returns false for an empty queue', () => {
    setConnected(true);
    setProps({ 'playlist-count': 0, pause: false });
    expect(playbackEngine.isPlaying()).toBe(false);
  });

  it('returns false when playlist-count is not numeric', () => {
    setConnected(true);
    setProps({ 'playlist-count': undefined, pause: false });
    expect(playbackEngine.isPlaying()).toBe(false);
  });

  it('returns false when idle-active is true', () => {
    setConnected(true);
    setProps({ 'playlist-count': 1, pause: false, 'idle-active': true });
    expect(playbackEngine.isPlaying()).toBe(false);
  });

  it('returns false at end-of-file', () => {
    setConnected(true);
    setProps({ 'playlist-count': 1, pause: false, 'eof-reached': true });
    expect(playbackEngine.isPlaying()).toBe(false);
  });

  it('treats a radio stream (count 1, never EOF) as perpetually playing', () => {
    setConnected(true);
    setProps({ 'playlist-count': 1, pause: false });
    expect(playbackEngine.isPlaying()).toBe(true);
  });
});
