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

  /**
   * Sanitize URLs and other sensitive data from log messages
   * Removes credentials from URLs to prevent accidental exposure
   */
  private sanitizeArgs(args: unknown[]): unknown[] {
    return args.map(arg => {
      if (typeof arg === 'string' && arg.includes('://')) {
        // Check if string contains URL with potential credentials
        return arg.replace(
          /(https?:\/\/)[^:/\s]*:[^@/\s]*@/g, 
          '$1[CREDENTIALS_REDACTED]@'
        ).replace(
          /([?&])[up]=[^&\s]*/g, 
          '$1[CREDENTIAL_REDACTED]'
        );
      }
      return arg;
    });
  }

  debug(...args: unknown[]): void {
    if (this.debugMode) {
      console.error('[DEBUG]', ...this.sanitizeArgs(args));
    }
  }

  info(...args: unknown[]): void {
    console.error('[INFO]', ...this.sanitizeArgs(args));
  }

  warn(...args: unknown[]): void {
    console.error('[WARN]', ...this.sanitizeArgs(args));
  }

  error(...args: unknown[]): void {
    console.error('[ERROR]', ...this.sanitizeArgs(args));
  }
}

export const logger = new Logger();
