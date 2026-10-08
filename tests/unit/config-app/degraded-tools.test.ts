/**
 * Navidrome MCP Server - Degraded-mode tool notice tests
 * Copyright (C) 2025
 *
 * The degraded tools are the only in-band route back to the settings page, so
 * a startup failure reason must lead the notice both tools return.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/open-browser.js', () => ({ openBrowser: vi.fn() }));

import { registerDegradedTools, type StartupFailure } from '../../../src/config-app/degraded-tools.js';

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
    const notice = noticeFor(toolName, { reason: 'Authentication failed: 401 Unauthorized', unreachable: false });

    expect(notice).toMatch(
      /^Navidrome MCP could not start with the current configuration: Authentication failed: 401 Unauthorized\n/,
    );
    expect(notice).toContain(SETTINGS_URL);
    expect(notice).toContain('apply only when no settings.json with a Navidrome URL exists');
  });

  it('reports an unreachable Navidrome without blaming the configuration', () => {
    const notice = noticeFor('test_connection', { reason: 'connect ECONNREFUSED', unreachable: true });

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
    const failure: StartupFailure = { reason: 'connect ECONNREFUSED', unreachable: true };

    expect(callDegradedTool('test_connection', failure)?.isError).toBe(true);
    expect(callDegradedTool('test_connection')?.isError).toBe(true);
    expect(callDegradedTool('open_settings', failure)?.isError).toBeUndefined();
  });
});
