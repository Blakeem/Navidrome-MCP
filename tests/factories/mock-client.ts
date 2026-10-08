/**
 * Mock Client Factory for Navidrome MCP Server Tests
 * 
 * Provides mock implementations of NavidromeClient for testing write operations
 * without making actual API calls to the server.
 */

import { vi, type MockedFunction } from 'vitest';
import type { NavidromeClient } from '../../src/client/navidrome-client.js';

interface MockClientMethods {
  request: MockedFunction<NavidromeClient['request']>;
  requestWithMeta: MockedFunction<NavidromeClient['requestWithMeta']>;
  requestWithLibraryFilter: MockedFunction<NavidromeClient['requestWithLibraryFilter']>;
  requestWithLibraryFilterAndMeta: MockedFunction<NavidromeClient['requestWithLibraryFilterAndMeta']>;
  subsonicRequest: MockedFunction<NavidromeClient['subsonicRequest']>;
  getCurrentToken: MockedFunction<NavidromeClient['getCurrentToken']>;
  initialize: MockedFunction<() => Promise<void>>;
  getBaseUrl: MockedFunction<() => string>;
  isInitialized: MockedFunction<() => boolean>;
}

/** Tools take a NavidromeClient, so the mock carries that type and tests pass it without a cast. */
export type MockNavidromeClient = MockClientMethods & NavidromeClient;

/**
 * Creates a mock Navidrome client for testing write operations
 * Following UNIT-TEST-STRATEGY.md guidelines for mocked write operations
 */
export function createMockClient(): MockNavidromeClient {
  const mock: MockClientMethods = {
    request: vi.fn(),
    requestWithMeta: vi.fn(),
    requestWithLibraryFilter: vi.fn(),
    requestWithLibraryFilterAndMeta: vi.fn(),
    subsonicRequest: vi.fn(),
    getCurrentToken: vi.fn(),
    initialize: vi.fn().mockResolvedValue(undefined),
    getBaseUrl: vi.fn().mockReturnValue('http://mock-server:4533'),
    isInitialized: vi.fn().mockReturnValue(true),
  };
  return mock as MockNavidromeClient;
}

// Re-export shared client utilities for convenience
export { getSharedLiveClient } from './shared-client.js';