/**
 * Navidrome MCP Server - mpv owner-shutdown decision unit tests
 * Copyright (C) 2025
 *
 * Covers the single mpv-shutdown authority (standalone-web spec §8.1): the web
 * port owner keeps mpv when playing (detached, survives a web restart) and
 * kills it when stopped/idle.
 */

import { describe, expect, it } from 'vitest';

import { shouldKillMpvOnOwnerShutdown } from '../../../src/services/playback/shutdown.js';

describe('shouldKillMpvOnOwnerShutdown', () => {
  it('keeps mpv when playing', () => {
    expect(shouldKillMpvOnOwnerShutdown(true)).toBe(false);
  });

  it('kills mpv when not playing', () => {
    expect(shouldKillMpvOnOwnerShutdown(false)).toBe(true);
  });
});
