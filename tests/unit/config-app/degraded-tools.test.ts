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

import { registerDegradedTools } from '../../../src/config-app/degraded-tools.js';

const SETTINGS_URL = 'http://127.0.0.1:5000/';

type CallToolHandler = (request: { params: { name: string } }) => { content: Array<{ text: string }> };

function noticeFor(toolName: string, failureReason?: string): string | undefined {
  const handlers = new Map<unknown, CallToolHandler>();
  const server = {
    setRequestHandler: (schema: unknown, handler: CallToolHandler): void => {
      handlers.set(schema, handler);
    },
  } as unknown as Server;
  registerDegradedTools(server, SETTINGS_URL, failureReason);
  return handlers.get(CallToolRequestSchema)?.({ params: { name: toolName } }).content[0]?.text;
}

describe('registerDegradedTools notice', () => {
  it.each(['open_settings', 'test_connection'])('%s leads with the startup failure reason', (toolName) => {
    const notice = noticeFor(toolName, 'Authentication failed: 401 Unauthorized');

    expect(notice).toMatch(
      /^Navidrome MCP could not start with the saved settings: Authentication failed: 401 Unauthorized\n/,
    );
    expect(notice).toContain(SETTINGS_URL);
  });

  it('keeps the first-run headline when no startup failure occurred', () => {
    const notice = noticeFor('test_connection');

    expect(notice).toMatch(/^Navidrome MCP is not configured yet\.\n/);
    expect(notice).toContain(SETTINGS_URL);
  });
});
