/** Live tests share one authenticated client per process, since Navidrome rate-limits logins. */

import type { NavidromeClient } from '../../src/client/navidrome-client.js';
import { logger } from '../../src/utils/logger.js';

class SharedTestClient {
  private static instance: SharedTestClient | null = null;
  private client: NavidromeClient | null = null;
  private initializationPromise: Promise<NavidromeClient> | null = null;
  private initializationError: Error | null = null;
  private lastInitAttempt: number = 0;
  private readonly RETRY_DELAY = 5000;

  private constructor() {
  }

  public static getInstance(): SharedTestClient {
    if (!SharedTestClient.instance) {
      SharedTestClient.instance = new SharedTestClient();
    }
    return SharedTestClient.instance;
  }

  /** Concurrent callers await the same in-flight login, so one process logs in once. */
  public async getClient(): Promise<NavidromeClient> {
    if (this.client) {
      return this.client;
    }

    if (this.initializationError) {
      const timeSinceLastAttempt = Date.now() - this.lastInitAttempt;
      if (timeSinceLastAttempt < this.RETRY_DELAY) {
        throw new Error(
          `Previous initialization failed. Waiting ${Math.ceil((this.RETRY_DELAY - timeSinceLastAttempt) / 1000)}s before retry. Error: ${this.initializationError.message}`
        );
      }
      this.initializationError = null;
      this.initializationPromise = null;
    }

    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this.initializeClient();

    try {
      this.client = await this.initializationPromise;
      return this.client;
    } catch (error) {
      this.initializationError = error as Error;
      this.lastInitAttempt = Date.now();
      throw error;
    } finally {
      if (this.initializationError) {
        this.initializationPromise = null;
      }
    }
  }

  private async initializeClient(): Promise<NavidromeClient> {
    logger.info('Creating shared test client for all tests...');

    const { NavidromeClient } = await import('../../src/client/navidrome-client.js');
    const { loadConfig } = await import('../../src/config.js');

    const config = await loadConfig();

    const client = new NavidromeClient(config);
    await client.initialize();
    
    logger.info('Shared test client initialized successfully');
    return client;
  }

  public reset(): void {
    logger.info('Resetting shared test client');
    this.client = null;
    this.initializationPromise = null;
    this.initializationError = null;
    this.lastInitAttempt = 0;
  }

  public isInitialized(): boolean {
    return this.client !== null;
  }
}

export async function getSharedLiveClient(): Promise<NavidromeClient> {
  const sharedClient = SharedTestClient.getInstance();
  return sharedClient.getClient();
}

