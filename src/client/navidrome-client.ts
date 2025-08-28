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

  constructor(config: Config) {
    this.baseUrl = config.navidromeUrl;
    this.authManager = new AuthManager(config);
  }

  async initialize(): Promise<void> {
    await this.authManager.authenticate();
    logger.info('Navidrome client initialized');
  }

  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = await this.authManager.getToken();

    const response = await fetch(`${this.baseUrl}/api${endpoint}`, {
      ...options,
      headers: {
        ...options.headers,
        'x-nd-authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }
}
