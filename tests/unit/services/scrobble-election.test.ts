/**
 * Navidrome MCP Server - Scrobbler election unit tests
 * Copyright (C) 2025
 *
 * Covers the single-submitter rule (standalone-web spec §6.4): MCP scrobbles
 * only in MCP-only mode (no web server enabled); otherwise the web port owner
 * is the submitter.
 */

import { describe, expect, it } from 'vitest';

import { shouldMcpSubmit } from '../../../src/services/playback/scrobble-election.js';
import { makeTestConfig } from '../../helpers/test-config.js';

describe('shouldMcpSubmit', () => {
  it('submits in MCP-only mode (playback on, webui disabled)', () => {
    const config = makeTestConfig({
      features: { playback: true },
      webui: { enabled: false, host: '127.0.0.1', port: 8808, expose: false, autoOpenBrowser: false },
    });
    expect(shouldMcpSubmit(config)).toBe(true);
  });

  it('does NOT submit when a web server is enabled (it owns scrobbling)', () => {
    const config = makeTestConfig({
      features: { playback: true },
      webui: { enabled: true, host: '127.0.0.1', port: 8808, expose: false, autoOpenBrowser: false },
    });
    expect(shouldMcpSubmit(config)).toBe(false);
  });

  it('does NOT submit when playback is disabled', () => {
    const config = makeTestConfig({
      features: { playback: false },
      webui: { enabled: false, host: '127.0.0.1', port: 8808, expose: false, autoOpenBrowser: false },
    });
    expect(shouldMcpSubmit(config)).toBe(false);
  });
});
