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
 * Provides consistent error messages across the MCP application
 */

export class ErrorFormatter {
  /**
   * Extract message from unknown error type
   */
  private static extractMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }

  // === HTTP/API ERRORS ===

  /**
   * Format HTTP request failures (network issues, 404, 500, etc.)
   */
  static httpRequest(operation: string, response: Response, errorText?: string): string {
    const base = `API request failed: ${operation} - ${response.status} ${response.statusText}`;
    return errorText ? `${base} - ${errorText}` : base;
  }

  /**
   * Format Subsonic API specific errors
   */
  static subsonicApi(response: Response): string {
    return `Subsonic API request failed: ${response.status} ${response.statusText}`;
  }

  /**
   * Format Subsonic API response errors (when subsonic-response.status !== 'ok')
   */
  static subsonicResponse(errorMessage?: string): string {
    return `Subsonic API error: ${errorMessage || 'Unknown error'}`;
  }

  // === MCP TOOL ERRORS ===

  /**
   * Format MCP tool execution failures
   */
  static toolExecution(toolName: string, error: unknown): string {
    const message = this.extractMessage(error);
    return `Tool '${toolName}' failed: ${message}`;
  }

  /**
   * Format tool parameter validation errors
   */
  static toolValidation(toolName: string, field: string, issue: string): string {
    return `Tool '${toolName}' validation error: ${field} ${issue}`;
  }

  /**
   * Format tool resource not found errors
   */
  static toolNotFound(resourceType: string, identifier?: string): string {
    const base = `${resourceType} not found`;
    return identifier ? `${base}: ${identifier}` : base;
  }

  /**
   * Format unknown tool errors
   */
  static toolUnknown(toolName: string): string {
    return `Unknown tool: ${toolName}`;
  }

  /**
   * Format not found errors
   */
  static notFound(resourceType: string, identifier: string): string {
    return `${resourceType} not found: ${identifier}`;
  }

  // === AUTHENTICATION & AUTHORIZATION ===

  /**
   * Format authentication failures
   */
  static authentication(details?: string): string {
    const base = 'Authentication failed';
    return details ? `${base}: ${details}` : base;
  }

  /**
   * Format authorization failures
   */
  static authorization(operation: string): string {
    return `Authorization failed: insufficient permissions for ${operation}`;
  }

  // === EXTERNAL SERVICE ERRORS ===

  /**
   * Format Last.fm API errors
   */
  static lastfmApi(response: Response): string {
    return `Last.fm API error: ${response.status} ${response.statusText}`;
  }

  /**
   * Format Last.fm API response errors
   */
  static lastfmResponse(message?: string): string {
    return `Last.fm API error: ${message || 'Unknown error'}`;
  }

  /**
   * Format Radio Browser API errors
   */
  static radioBrowserApi(response: Response): string {
    return `Radio Browser API error: ${response.status} ${response.statusText}`;
  }

  /**
   * Format generic API request errors
   */
  static apiRequest(apiName: string, response: Response): string {
    return `${apiName} request failed: ${response.status} ${response.statusText}`;
  }

  /**
   * Format generic API response errors
   */
  static apiResponse(apiName: string, message?: string): string {
    return `${apiName} error: ${message || 'Unknown error'}`;
  }

  // === CONFIGURATION ERRORS ===

  /**
   * Format configuration validation failures
   */
  static configValidation(messages: string[]): string {
    return `Configuration validation failed:\n${messages.join('\n')}`;
  }

  /**
   * Format missing configuration errors
   */
  static configMissing(service: string, configKey: string): string {
    return `${service} not configured: missing ${configKey}`;
  }

  // === GENERIC OPERATION ERRORS ===

  /**
   * Format general operation failures with context
   */
  static operationFailed(operation: string, error: unknown): string {
    const message = this.extractMessage(error);
    return `Operation failed: ${operation} - ${message}`;
  }

  /**
   * Format unknown resource errors (for MCP resources)
   */
  static unknownResource(resourceUri: string): string {
    return `Unknown resource: ${resourceUri}`;
  }

  /**
   * Format validation stream/URL errors
   */
  static streamValidation(url: string, issue: string): string {
    return `Stream validation failed: ${url} - ${issue}`;
  }
}