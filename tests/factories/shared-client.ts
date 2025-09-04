/**
 * Shared Test Client Singleton
 * 
 * Provides a singleton pattern for test clients to avoid rate limiting
 * and improve test performance by reusing authentication tokens.
 * 
 * Thread-safe implementation ensures only one client instance is created
 * even when tests run in parallel.
 */

import type { NavidromeClient } from '../../src/client/navidrome-client.js';
import { logger } from '../../src/utils/logger.js';

/**
 * Singleton instance holder with lazy initialization
 */
class SharedTestClient {
  private static instance: SharedTestClient | null = null;
  private client: NavidromeClient | null = null;
  private initializationPromise: Promise<NavidromeClient> | null = null;
  private initializationError: Error | null = null;
  private lastInitAttempt: number = 0;
  private readonly RETRY_DELAY = 5000; // 5 seconds between retry attempts

  private constructor() {
    // Private constructor to enforce singleton pattern
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): SharedTestClient {
    if (!SharedTestClient.instance) {
      SharedTestClient.instance = new SharedTestClient();
    }
    return SharedTestClient.instance;
  }

  /**
   * Get or create the shared client instance
   * Thread-safe implementation ensures only one initialization happens
   */
  public async getClient(): Promise<NavidromeClient> {
    // If we have a working client, return it
    if (this.client && this.client.isInitialized()) {
      return this.client;
    }

    // Check if we should retry after a previous error
    if (this.initializationError) {
      const timeSinceLastAttempt = Date.now() - this.lastInitAttempt;
      if (timeSinceLastAttempt < this.RETRY_DELAY) {
        throw new Error(
          `Previous initialization failed. Waiting ${Math.ceil((this.RETRY_DELAY - timeSinceLastAttempt) / 1000)}s before retry. Error: ${this.initializationError.message}`
        );
      }
      // Clear error state for retry
      this.initializationError = null;
      this.initializationPromise = null;
    }

    // If initialization is already in progress, wait for it
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    // Start new initialization
    this.initializationPromise = this.initializeClient();
    
    try {
      this.client = await this.initializationPromise;
      return this.client;
    } catch (error) {
      // Store error state for retry logic
      this.initializationError = error as Error;
      this.lastInitAttempt = Date.now();
      throw error;
    } finally {
      // Clear the promise so next call can retry if needed
      if (this.initializationError) {
        this.initializationPromise = null;
      }
    }
  }

  /**
   * Initialize the Navidrome client
   */
  private async initializeClient(): Promise<NavidromeClient> {
    logger.info('Creating shared test client for all tests...');
    
    const { NavidromeClient } = await import('../../src/client/navidrome-client.js');
    const { loadConfig } = await import('../../src/config.js');
    
    // Load test configuration
    const config = await loadConfig();
    
    // Create and initialize client
    const client = new NavidromeClient(config);
    await client.initialize();
    
    logger.info('Shared test client initialized successfully');
    return client;
  }

  /**
   * Reset the shared client (useful for test cleanup)
   * Should only be called between test suites if needed
   */
  public reset(): void {
    logger.info('Resetting shared test client');
    this.client = null;
    this.initializationPromise = null;
    this.initializationError = null;
    this.lastInitAttempt = 0;
  }

  /**
   * Check if client is currently initialized
   */
  public isInitialized(): boolean {
    return this.client !== null && this.client.isInitialized();
  }
}

/**
 * Get the shared live client for testing
 * This replaces createLiveClient() in individual tests
 */
export async function getSharedLiveClient(): Promise<NavidromeClient> {
  const sharedClient = SharedTestClient.getInstance();
  return sharedClient.getClient();
}

/**
 * Reset the shared client (for test cleanup if needed)
 */
export function resetSharedClient(): void {
  const sharedClient = SharedTestClient.getInstance();
  sharedClient.reset();
}

/**
 * Check if shared client is initialized
 */
export function isSharedClientInitialized(): boolean {
  const sharedClient = SharedTestClient.getInstance();
  return sharedClient.isInitialized();
}