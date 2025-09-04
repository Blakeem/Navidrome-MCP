/**
 * Navidrome MCP Server - Authentication Manager
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
import { logger } from '../utils/logger.js';
import { ErrorFormatter } from '../utils/error-formatter.js';

export class AuthManager {
  private token: string | null = null;
  private tokenExpiry: Date | null = null;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  async authenticate(): Promise<void> {
    const response = await fetch(`${this.config.navidromeUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: this.config.navidromeUsername,
        password: this.config.navidromePassword,
      }),
    });

    if (!response.ok) {
      throw new Error(ErrorFormatter.authentication(`${response.status} ${response.statusText}`));
    }

    const data = (await response.json()) as { token: string };
    this.token = data.token;
    this.tokenExpiry = new Date(Date.now() + this.config.tokenExpiry * 1000); // Convert seconds to milliseconds
    logger.debug('Authentication successful');
  }

  async getToken(): Promise<string> {
    if (!this.token || !this.tokenExpiry || this.tokenExpiry <= new Date()) {
      await this.authenticate();
    }

    if (!this.token) {
      throw new Error(ErrorFormatter.authentication('token not available after authentication'));
    }

    return this.token;
  }
}
