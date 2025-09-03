/**
 * Navidrome MCP Server - Error Formatting Utility
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

/**
 * Standardized error message formatting utilities
 * Provides consistent error messages across the application
 */

export class ErrorFormatter {
  /**
   * Format API request errors with consistent pattern
   */
  static apiRequest(operation: string, response: Response): string {
    return `API request failed: ${operation} - ${response.status} ${response.statusText}`;
  }

  /**
   * Format API response errors (when status is not ok)
   */
  static apiResponse(operation: string, details?: string): string {
    const base = `API error: ${operation}`;
    return details ? `${base} - ${details}` : base;
  }

  /**
   * Format operation failures with context
   */
  static operationFailed(operation: string, error: unknown): string {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return `Operation failed: ${operation} - ${message}`;
  }

  /**
   * Format service errors (external service failures)
   */
  static serviceError(service: string, operation: string, details?: string): string {
    const base = `Service error: ${service} ${operation}`;
    return details ? `${base} - ${details}` : base;
  }

  /**
   * Format validation errors
   */
  static validation(field: string, issue: string): string {
    return `Validation error: ${field} ${issue}`;
  }

  /**
   * Format resource not found errors
   */
  static notFound(resource: string, identifier?: string): string {
    const base = `Resource not found: ${resource}`;
    return identifier ? `${base} (${identifier})` : base;
  }
}