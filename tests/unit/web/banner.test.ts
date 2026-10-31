/**
 * Navidrome MCP Server - Web player startup banner tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';

import { buildBannerLines, buildSetupHeadline, TLS_LOCAL_ADDRESS_WARNING } from '../../../src/web/banner.js';
import { makeTestConfig } from '../../helpers/test-config.js';
import { TLS_PAIR_A } from '../../helpers/tls-fixtures.js';

describe('web player banner', () => {
  it('explains the certificate warning on local addresses when HTTPS is on', () => {
    const config = makeTestConfig();
    const lines = buildBannerLines({ ...config.webui, host: '127.0.0.1', tls: TLS_PAIR_A });

    expect(lines[0]).toBe('navidrome-web listening on https://127.0.0.1:8808/admin');
    expect(lines).toContain(TLS_LOCAL_ADDRESS_WARNING);
  });

  it('leaves the warning out when the player serves HTTP', () => {
    const config = makeTestConfig();
    const lines = buildBannerLines({ ...config.webui, host: '127.0.0.1', tls: { certPath: null, keyPath: null } });

    expect(lines[0]).toBe('navidrome-web listening on http://127.0.0.1:8808/admin');
    expect(lines).not.toContain(TLS_LOCAL_ADDRESS_WARNING);
  });
});

describe('web player setup headline', () => {
  it('says not configured yet on a first run', () => {
    expect(buildSetupHeadline(undefined)).toBe('navidrome-web is not configured yet.');
  });

  it('names a rejected config with its credentials redacted', () => {
    const headline = buildSetupHeadline({
      reason: 'settings.json is not valid JSON (x). Fetch of http://u:secret@h:4533 failed',
      unreachable: false,
      source: 'store',
    });

    expect(headline).toMatch(/^navidrome-web could not start with the current configuration: settings\.json is not valid JSON/);
    expect(headline).not.toContain('secret');
  });
});
