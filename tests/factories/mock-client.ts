/**
 * Mock Client Factory for Navidrome MCP Server Tests
 * 
 * Provides mock implementations of NavidromeClient for testing write operations
 * without making actual API calls to the server.
 */

import { vi, type MockedFunction } from 'vitest';
import type { NavidromeClient } from '../../src/client/navidrome-client.js';

export interface MockNavidromeClient {
  request: MockedFunction<NavidromeClient['request']>;
  subsonicRequest: MockedFunction<NavidromeClient['subsonicRequest']>;
  initialize: MockedFunction<() => Promise<void>>;
  getBaseUrl: MockedFunction<() => string>;
  isInitialized: MockedFunction<() => boolean>;
}

/**
 * Creates a mock Navidrome client for testing write operations
 * Following UNIT-TEST-STRATEGY.md guidelines for mocked write operations
 */
export function createMockClient(): MockNavidromeClient {
  return {
    request: vi.fn(),
    subsonicRequest: vi.fn(),
    initialize: vi.fn().mockResolvedValue(undefined),
    getBaseUrl: vi.fn().mockReturnValue('http://mock-server:4533'),
    isInitialized: vi.fn().mockReturnValue(true),
  };
}

// Re-export shared client utilities for convenience
export { getSharedLiveClient } from './shared-client.js';