/**
 * Navidrome MCP Server - Degraded-mode tool notice tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * The degraded tools are the only in-band route back to the settings page, so
 * a startup failure reason must lead the notice both tools return.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/open-browser.js', () => ({ openBrowser: vi.fn() }));

import { buildHeadlessStartupError, registerDegradedTools } from '../../../src/config-app/degraded-tools.js';
import type { StartupFailure } from '../../../src/config.js';

const SETTINGS_URL = 'http://127.0.0.1:5000/';

type CallToolResult = { content: Array<{ text: string }>; isError?: boolean };
type CallToolHandler = (request: { params: { name: string } }) => CallToolResult;

function callDegradedTool(toolName: string, failure?: StartupFailure): CallToolResult | undefined {
  const handlers = new Map<unknown, CallToolHandler>();
  const server = {
    setRequestHandler: (schema: unknown, handler: CallToolHandler): void => {
      handlers.set(schema, handler);
    },
  } as unknown as Server;
  registerDegradedTools(server, SETTINGS_URL, failure);
  return handlers.get(CallToolRequestSchema)?.({ params: { name: toolName } });
}

function noticeFor(toolName: string, failure?: StartupFailure): string | undefined {
  return callDegradedTool(toolName, failure)?.content[0]?.text;
}

describe('registerDegradedTools notice', () => {
  it.each(['open_settings', 'test_connection'])('%s leads with the startup failure reason', (toolName) => {
    const notice = noticeFor(toolName, {
      reason: 'Authentication failed: 401 Unauthorized',
      unreachable: false,
      source: 'store',
    });

    expect(notice).toMatch(
      /^Navidrome MCP could not start with the current configuration: Authentication failed: 401 Unauthorized\n/,
    );
    expect(notice).toContain(SETTINGS_URL);
    expect(notice).toContain('apply only when settings.json is absent, fails the settings schema, or has no Navidrome URL');
    expect(notice).toContain('names a web remote auth mode other than none blocks them');
  });

  it('tells an env-built config to fix the environment variable, not the store', () => {
    const notice = noticeFor('test_connection', {
      reason: 'The environment-derived config is invalid: Configuration validation failed:\nnavidromeUsername: Required',
      unreachable: false,
      source: 'env',
    });

    expect(notice).toMatch(/^Navidrome MCP could not start with the current configuration: The environment-derived config/);
    expect(notice).toContain('Fix the environment variable that holds the named setting');
    expect(notice).toContain('writes settings.json, which then takes precedence over the environment variables');
    expect(notice).not.toContain('edit or remove settings.json');
  });

  it('names the env fallback skip as the reason, not a first run', () => {
    const notice = noticeFor('test_connection', {
      reason:
        'settings.json is not valid JSON (/x/settings.json). The environment fallback is skipped, since the file ' +
        'names, or may name, a web remote auth mode other than none.',
      unreachable: false,
      source: 'store',
    });

    expect(notice).toMatch(/^Navidrome MCP could not start with the current configuration: settings\.json is not valid JSON/);
    expect(notice).toContain('The environment fallback is skipped');
    expect(notice).not.toContain('not configured yet');
  });

  it('reports an unreachable Navidrome without blaming the configuration', () => {
    const notice = noticeFor('test_connection', { reason: 'connect ECONNREFUSED', unreachable: true, source: 'store' });

    expect(notice).toMatch(/^Navidrome MCP could not reach Navidrome at the configured URL: connect ECONNREFUSED\n/);
    expect(notice).toContain('The configuration was not rejected. Restart the MCP client once Navidrome is reachable.');
    expect(notice).toContain(SETTINGS_URL);
  });

  it('redacts the credentials a failure reason echoes from the configured URL', () => {
    const notice = noticeFor('test_connection', {
      reason:
        'Navidrome /auth/login failed: Request cannot be constructed from a URL that includes credentials: ' +
        'http://admin:secret@nas:4533/auth/login',
      unreachable: false,
      source: 'store',
    });

    expect(notice).not.toContain('secret');
    expect(notice).toContain('<REDACTED>@nas:4533');
  });

  it('keeps the first-run headline when no startup failure occurred', () => {
    const notice = noticeFor('test_connection');

    expect(notice).toMatch(/^Navidrome MCP is not configured yet\.\n/);
    expect(notice).toContain(SETTINGS_URL);
  });

  it('flags test_connection as a failed check and open_settings as a normal result', () => {
    const failure: StartupFailure = { reason: 'connect ECONNREFUSED', unreachable: true, source: 'store' };

    expect(callDegradedTool('test_connection', failure)?.isError).toBe(true);
    expect(callDegradedTool('test_connection')?.isError).toBe(true);
    expect(callDegradedTool('open_settings', failure)?.isError).toBeUndefined();
  });
});

describe('buildHeadlessStartupError', () => {
  it('names the env vars on a first run and says why setup mode cannot run', () => {
    const text = buildHeadlessStartupError();
    expect(text).toContain('not configured');
    expect(text).toContain('MCP_TRANSPORT=http');
    expect(text).toContain('NAVIDROME_URL');
  });

  it('gives an env failure the env remedy and redacts credentials in the reason', () => {
    const text = buildHeadlessStartupError({
      reason: 'fetch failed for http://bob:hunter2@nd.local',
      unreachable: false,
      source: 'env',
    });
    expect(text).toContain('Fix the environment variable that holds the named setting');
    expect(text).not.toContain('hunter2');
  });
});
