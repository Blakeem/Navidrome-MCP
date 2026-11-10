/**
 * Navidrome MCP Server - Jukebox Remote startup banner tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';

import {
  buildAttachLines,
  buildBannerLines,
  buildSetupHeadline,
  TLS_LOCAL_ADDRESS_WARNING,
} from '../../../src/web/banner.js';
import { STOP_HINT } from '../../../src/cli/texts.js';
import { makeTestConfig } from '../../helpers/test-config.js';
import { TLS_PAIR_A } from '../../helpers/tls-fixtures.js';

describe('Jukebox Remote banner', () => {
  it('explains the certificate warning on local addresses when HTTPS is on', () => {
    const config = makeTestConfig();
    const lines = buildBannerLines({ ...config.webui, host: '127.0.0.1', tls: TLS_PAIR_A }, false);

    expect(lines[0]).toBe('Jukebox Remote listening on https://127.0.0.1:8808/admin');
    expect(lines).toContain(TLS_LOCAL_ADDRESS_WARNING);
  });

  it('leaves the warning out when the player serves HTTP', () => {
    const config = makeTestConfig();
    const lines = buildBannerLines({ ...config.webui, host: '127.0.0.1', tls: { certPath: null, keyPath: null } }, false);

    expect(lines[0]).toBe('Jukebox Remote listening on http://127.0.0.1:8808/admin');
    expect(lines).not.toContain(TLS_LOCAL_ADDRESS_WARNING);
  });

  it('ends a foreground run with the line that says how to stop it', () => {
    const config = makeTestConfig();
    const lines = buildBannerLines({ ...config.webui, host: '127.0.0.1', tls: TLS_PAIR_A }, true);

    expect(STOP_HINT).toBe('Stop it with Ctrl+C or Shut down player in the gear menu.');
    expect(lines.at(-1)).toBe(STOP_HINT);
  });

  it('leaves the stop line out of a run the MCP server spawned', () => {
    const config = makeTestConfig();
    const lines = buildBannerLines({ ...config.webui, host: '127.0.0.1', tls: TLS_PAIR_A }, false);

    expect(lines).not.toContain(STOP_HINT);
  });
});

describe('Jukebox Remote attach lines', () => {
  it('names the running player and says when a settings change applies', () => {
    const lines = buildAttachLines('http://127.0.0.1:8808/admin', false);

    expect(lines[0]).toBe('Jukebox Remote already running at http://127.0.0.1:8808/admin.');
    expect(lines[1]).toBe(
      'Settings page changes saved after it started apply once you click Shut down player in the gear menu and start it again. ' +
        'A new admin password applies without that step when the player runs from settings.json in a password access mode.',
    );
    expect(lines).toHaveLength(2);
  });

  it('adds the certificate warning when the running player serves HTTPS', () => {
    const lines = buildAttachLines('https://127.0.0.1:8808/admin', true);

    expect(lines.at(-1)).toBe(TLS_LOCAL_ADDRESS_WARNING);
  });
});

describe('Jukebox Remote setup headline', () => {
  it('says not configured yet on a first run', () => {
    expect(buildSetupHeadline(undefined)).toBe('Jukebox Remote is not configured yet.');
  });

  it('names a rejected config with its credentials redacted', () => {
    const headline = buildSetupHeadline({
      reason: 'settings.json is not valid JSON (x). Fetch of http://u:secret@h:4533 failed',
      unreachable: false,
      source: 'store',
    });

    expect(headline).toMatch(/^Jukebox Remote could not start with the current configuration: settings\.json is not valid JSON/);
    expect(headline).not.toContain('secret');
  });
});
