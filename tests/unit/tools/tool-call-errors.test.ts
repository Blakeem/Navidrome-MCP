/**
 * Navidrome MCP Server - tools/call error contract tests
 * Copyright (C) 2025
 *
 * A failing tool returns an isError result the model can read and correct.
 * Only an unknown tool name is a JSON-RPC protocol error (-32602).
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ErrorCode, McpError, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import type { NavidromeClient } from '../../../src/client/navidrome-client.js';
import { registerTools } from '../../../src/tools/handlers/registry.js';
import { createMockClient } from '../../factories/mock-client.js';
import { makeTestConfig } from '../../helpers/test-config.js';

type CallTool = (request: { params: { name: string; arguments?: Record<string, unknown> } }) => Promise<CallToolResult>;

function callToolHandler(client = createMockClient()): CallTool {
  const handlers = new Map<unknown, CallTool>();
  const server = {
    setRequestHandler: (schema: unknown, handler: CallTool): void => {
      handlers.set(schema, handler);
    },
  } as unknown as Server;
  registerTools(server, client as unknown as NavidromeClient, makeTestConfig());
  const handler = handlers.get(CallToolRequestSchema);
  if (handler === undefined) throw new Error('registerTools installed no tools/call handler');
  return handler;
}

describe('tools/call error contract', () => {
  it('returns invalid arguments as an isError result naming the field', async () => {
    const result = await callToolHandler()({ params: { name: 'get_song', arguments: {} } });

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: 'text' });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toMatch(/^Tool 'get_song' failed: Invalid arguments\. songId: /);
    expect(text).not.toContain('"code"');
  });

  it('returns an upstream failure as an isError result', async () => {
    const client = createMockClient();
    const upstream = new Error('API request failed: /song/abc - 500 Internal Server Error');
    const requests = [client.request, client.requestWithMeta, client.requestWithLibraryFilter, client.subsonicRequest];
    for (const request of requests) request.mockRejectedValue(upstream);

    const result = await callToolHandler(client)({ params: { name: 'get_song', arguments: { songId: 'abc' } } });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('500 Internal Server Error');
  });

  it('rejects an unknown tool as an InvalidParams protocol error', async () => {
    const error = await callToolHandler()({ params: { name: 'no_such_tool' } }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(McpError);
    expect((error as McpError).code).toBe(ErrorCode.InvalidParams);
    expect((error as McpError).message).toContain('Unknown tool: no_such_tool');
  });
});
