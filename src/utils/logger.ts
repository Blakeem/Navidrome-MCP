/**
 * Navidrome MCP Server - Logger Utility
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

class Logger {
  private debugMode = false;

  setDebug(enabled: boolean): void {
    this.debugMode = enabled;
  }

  debug(...args: unknown[]): void {
    if (this.debugMode) {
      console.error('[DEBUG]', ...args);
    }
  }

  info(...args: unknown[]): void {
    console.error('[INFO]', ...args);
  }

  warn(...args: unknown[]): void {
    console.error('[WARN]', ...args);
  }

  error(...args: unknown[]): void {
    console.error('[ERROR]', ...args);
  }
}

export const logger = new Logger();
