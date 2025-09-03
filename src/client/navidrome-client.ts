/**
 * Navidrome MCP Server - API Client
 * Copyright (C) 2025
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import type { Config } from '../config.js';
import { AuthManager } from './auth-manager.js';
import { logger } from '../utils/logger.js';

export class NavidromeClient {
  private authManager: AuthManager;
  private baseUrl: string;
  private config: Config;

  constructor(config: Config) {
    this.baseUrl = config.navidromeUrl;
    this.authManager = new AuthManager(config);
    this.config = config;
  }

  async initialize(): Promise<void> {
    await this.authManager.authenticate();
    logger.info('Navidrome client initialized');
  }

  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = await this.authManager.getToken();

    const defaultHeaders: Record<string, string> = {
      'X-ND-Authorization': `Bearer ${token}`,
    };

    // Only set Content-Type for non-GET requests
    if (options.method && options.method !== 'GET') {
      defaultHeaders['Content-Type'] = 'application/json';
    }

    const response = await fetch(`${this.baseUrl}/api${endpoint}`, {
      ...options,
      headers: {
        ...defaultHeaders,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    // Handle different content types
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return response.json() as Promise<T>;
    } else {
      return response.text() as Promise<T>;
    }
  }

  async subsonicRequest(endpoint: string, params: Record<string, string> = {}): Promise<unknown> {
    // Build Subsonic REST API parameters
    const queryParams = new URLSearchParams({
      u: this.config.navidromeUsername,
      p: this.config.navidromePassword,
      v: '1.16.1',
      c: 'navidrome-mcp',
      f: 'json',
      ...params,
    });

    const response = await fetch(`${this.baseUrl}/rest${endpoint}?${queryParams}`);

    if (!response.ok) {
      throw new Error(`Subsonic API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { 'subsonic-response'?: { status?: string; error?: { message?: string } } };

    if (data['subsonic-response']?.status !== 'ok') {
      throw new Error(`Subsonic API error: ${data['subsonic-response']?.error?.message || 'Unknown error'}`);
    }

    return data['subsonic-response'];
  }
}
