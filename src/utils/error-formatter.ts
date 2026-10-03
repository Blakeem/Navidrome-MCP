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

import { z } from 'zod';

export class ErrorFormatter {
  /**
   * A ZodError's own message is a JSON dump of its issues, too noisy for the agent to act on.
   */
  private static extractMessage(error: unknown): string {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((issue) => `${issue.path.join('.') || 'arguments'}: ${issue.message}`);
      return `Invalid arguments. ${issues.join('. ')}`;
    }
    return error instanceof Error ? error.message : 'Unknown error';
  }

  static httpRequest(operation: string, response: Response, errorText?: string): string {
    const base = `API request failed: ${operation} - ${response.status} ${response.statusText}`;
    return errorText !== undefined && errorText !== '' ? `${base} - ${errorText}` : base;
  }

  static subsonicApi(endpoint: string, response: Response): string {
    return `Subsonic API request failed: ${endpoint} - ${response.status} ${response.statusText}`;
  }

  // A Subsonic failure arrives as HTTP 200 with status 'failed' in the body.
  static subsonicResponse(errorMessage?: string): string {
    return `Subsonic API error: ${errorMessage ?? 'Unknown error'}`;
  }

  static toolExecution(toolName: string, error: unknown): string {
    const message = this.extractMessage(error);
    // The outermost call is the tool the agent invoked, so its name replaces any inner prefix.
    const reason = message.replace(/^Tool '[^']*' failed: /, '');
    return `Tool '${toolName}' failed: ${reason}`;
  }

  static toolUnknown(toolName: string): string {
    return `Unknown tool: ${toolName}`;
  }

  static notFound(resourceType: string, identifier: string): string {
    return `${resourceType} not found: ${identifier}`;
  }

  static authentication(details?: string): string {
    const base = 'Authentication failed';
    return details !== undefined && details !== '' ? `${base}: ${details}` : base;
  }

  static lastfmResponse(message?: string): string {
    return `Last.fm API error: ${message ?? 'Unknown error'}`;
  }

  static configValidation(messages: string[]): string {
    return `Configuration validation failed:\n${messages.join('\n')}`;
  }

  static configMissing(service: string, configKey: string): string {
    return `${service} not configured: missing ${configKey}`;
  }

  static unknownResource(resourceUri: string): string {
    return `Unknown resource: ${resourceUri}`;
  }
}
