/**
 * Navidrome MCP Server - Radio Network Validation Module
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

import { RADIO_VALIDATION } from '../../constants/timeouts.js';

// Validation context for internal use
export interface ValidationContext {
  readonly url: string;
  readonly startTime: number;
  readonly timeout: number;
  readonly followRedirects: boolean;
}

/**
 * Perform HEAD request validation
 */
export async function validateWithHead(
  context: ValidationContext
): Promise<{ response: Response | null; error: string | null }> {
  try {
    const controller = new AbortController();
    const headTimeout = Math.min(RADIO_VALIDATION.FALLBACK_HEAD_TIMEOUT, Math.floor(context.timeout * RADIO_VALIDATION.HEAD_TIMEOUT_RATIO)); // Use 60% of total timeout
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, headTimeout);

    const response = await fetch(context.url, {
      method: 'HEAD',
      redirect: context.followRedirects ? 'follow' : 'manual',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NavidromeBot/1.0)',
        'Accept': 'audio/*',
      },
    });

    clearTimeout(timeoutId);
    return { response, error: null };
  } catch (err) {
    if (err instanceof Error) {
      if (err.name === 'AbortError') {
        return { response: null, error: `HEAD request timeout after ${Math.min(RADIO_VALIDATION.FALLBACK_HEAD_TIMEOUT, Math.floor(context.timeout * RADIO_VALIDATION.HEAD_TIMEOUT_RATIO))}ms` };
      }
      return { response: null, error: `HEAD request failed: ${err.message}` };
    }
    return { response: null, error: 'Unknown HEAD request error' };
  }
}

/**
 * Sample audio data from stream
 */
export async function sampleAudioData(
  url: string,
  remainingTimeout: number
): Promise<{ buffer: Uint8Array | null; headers: Headers | null; error: string | null }> {
  try {
    const controller = new AbortController();
    const sampleTimeout = Math.max(RADIO_VALIDATION.MIN_SAMPLE_TIMEOUT, remainingTimeout); // Ensure at least 2 seconds
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, sampleTimeout);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Range': `bytes=0-${RADIO_VALIDATION.SAMPLE_BUFFER_SIZE - 1}`, // Get first 8KB
        'User-Agent': 'Mozilla/5.0 (compatible; NavidromeBot/1.0)',
        'Accept': 'audio/*',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok && response.status !== 206) {
      return {
        buffer: null,
        headers: response.headers,
        error: `HTTP ${response.status}: ${response.statusText}`
      };
    }

    // Some servers don't handle Range requests properly and hang on arrayBuffer()
    // Use streaming approach with timeout protection
    try {
      const reader = response.body?.getReader();
      if (!reader) {
        return {
          buffer: null,
          headers: response.headers,
          error: 'No response body reader available'
        };
      }

      const chunks: Uint8Array[] = [];
      let totalLength = 0;
      const maxBytes = RADIO_VALIDATION.SAMPLE_BUFFER_SIZE; // 8KB limit
      const startTime = Date.now();
      const readTimeout = RADIO_VALIDATION.STREAM_READ_TIMEOUT; // 3 second timeout for reading

      while (true) {
        // Check if we've exceeded our read timeout
        if (Date.now() - startTime > readTimeout) {
          await reader.cancel();
          return {
            buffer: totalLength > 0 ? new Uint8Array(totalLength) : null,
            headers: response.headers,
            error: 'Read timeout - got partial data'
          };
        }

        const { value, done } = await reader.read();

        if (done) break;
        if (value !== null && value !== undefined) {
          chunks.push(value);
          totalLength += value.length;

          // Stop if we have enough data
          if (totalLength >= maxBytes) {
            await reader.cancel();
            break;
          }
        }
      }

      // Combine chunks
      if (totalLength > 0) {
        const buffer = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          buffer.set(chunk, offset);
          offset += chunk.length;
        }
        return {
          buffer,
          headers: response.headers,
          error: null
        };
      } else {
        return {
          buffer: null,
          headers: response.headers,
          error: 'No data received from stream'
        };
      }
    } catch (streamErr) {
      if (streamErr instanceof Error && streamErr.name === 'AbortError') {
        return { buffer: null, headers: response.headers, error: 'Stream reading aborted' };
      }
      throw streamErr;
    }
  } catch (err) {
    if (err instanceof Error) {
      if (err.name === 'AbortError') {
        return { buffer: null, headers: null, error: `Audio sampling timeout after ${Math.max(RADIO_VALIDATION.MIN_SAMPLE_TIMEOUT, remainingTimeout)}ms` };
      }
      return { buffer: null, headers: null, error: `Audio sampling failed: ${err.message}` };
    }
    return { buffer: null, headers: null, error: 'Unknown audio sampling error' };
  }
}