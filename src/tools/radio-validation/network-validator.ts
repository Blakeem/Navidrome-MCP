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
import { hostResolvesToPrivateIp, isHttpUrlScheme } from '../../utils/network-safety.js';

// Validation context for internal use
export interface ValidationContext {
  readonly url: string;
  readonly startTime: number;
  readonly timeout: number;
  readonly followRedirects: boolean;
}

/** Maximum redirect hops we'll follow before giving up. Matches the spirit
 *  of fetch's default (20) but is tighter — radio stream redirects are
 *  almost always 1-2 hops; anything past 5 is suspicious. */
const MAX_REDIRECTS = 5;

interface FetchWithRedirectsResult {
  readonly response: Response | null;
  readonly finalUrl: string;
  readonly error: string | null;
}

/**
 * Fetch with manual redirect following + private-IP gating on each hop.
 *
 * Why manual: native `redirect: 'follow'` chases redirects opaquely, so a
 * public-looking URL that 302s to http://localhost:4533/api/admin would
 * silently land on a localhost endpoint and surface its status / final URL
 * back through the validator's response. Following manually lets us check
 * each Location's resolved IP before requesting it.
 *
 * The initial URL itself is NOT IP-checked — it was supplied by the caller
 * and the validator's response surface is narrow enough that probing a
 * known localhost URL is no worse than the LLM running curl directly. The
 * surprise-bypass case is only reachable through redirects.
 */
async function fetchWithManualRedirects(
  initialUrl: string,
  init: RequestInit,
  followRedirects: boolean,
): Promise<FetchWithRedirectsResult> {
  let currentUrl = initialUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(currentUrl, { ...init, redirect: 'manual' });

    const isRedirect = response.status >= 300 && response.status < 400;
    if (!isRedirect || !followRedirects) {
      return { response, finalUrl: currentUrl, error: null };
    }

    const location = response.headers.get('location');
    if (location === null || location === '') {
      // 3xx with no Location — return as-is, treat like the terminal response.
      return { response, finalUrl: currentUrl, error: null };
    }

    let nextUrl: URL;
    try {
      nextUrl = new URL(location, currentUrl);
    } catch {
      return { response: null, finalUrl: currentUrl, error: `Malformed redirect Location: ${location}` };
    }

    if (!isHttpUrlScheme(nextUrl.toString())) {
      return { response: null, finalUrl: currentUrl, error: `Refusing to follow redirect to non-HTTP scheme: ${nextUrl.protocol}` };
    }

    try {
      if (await hostResolvesToPrivateIp(nextUrl.hostname)) {
        return { response: null, finalUrl: currentUrl, error: `Refusing to follow redirect to private/local address: ${nextUrl.hostname}` };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return { response: null, finalUrl: currentUrl, error: `Failed to resolve redirect target ${nextUrl.hostname}: ${msg}` };
    }

    currentUrl = nextUrl.toString();
  }

  return { response: null, finalUrl: currentUrl, error: `Exceeded maximum redirects (${MAX_REDIRECTS})` };
}

/**
 * Perform HEAD request validation
 */
export async function validateWithHead(
  context: ValidationContext
): Promise<{ response: Response | null; finalUrl: string; error: string | null }> {
  const headTimeout = Math.min(
    RADIO_VALIDATION.FALLBACK_HEAD_TIMEOUT,
    Math.floor(context.timeout * RADIO_VALIDATION.HEAD_TIMEOUT_RATIO),
  ); // Use 60% of total timeout

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, headTimeout);

    try {
      const result = await fetchWithManualRedirects(
        context.url,
        {
          method: 'HEAD',
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; NavidromeBot/1.0)',
            'Accept': 'audio/*',
          },
        },
        context.followRedirects,
      );

      return result;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err) {
    if (err instanceof Error) {
      if (err.name === 'AbortError') {
        return { response: null, finalUrl: context.url, error: `HEAD request timeout after ${headTimeout}ms` };
      }
      return { response: null, finalUrl: context.url, error: `HEAD request failed: ${err.message}` };
    }
    return { response: null, finalUrl: context.url, error: 'Unknown HEAD request error' };
  }
}

/**
 * Sample audio data from stream
 */
export async function sampleAudioData(
  url: string,
  remainingTimeout: number,
  followRedirects: boolean,
): Promise<{ buffer: Uint8Array | null; headers: Headers | null; finalUrl: string; error: string | null }> {
  try {
    const controller = new AbortController();
    const sampleTimeout = Math.max(RADIO_VALIDATION.MIN_SAMPLE_TIMEOUT, remainingTimeout); // Ensure at least 2 seconds
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, sampleTimeout);

    let result: FetchWithRedirectsResult;
    try {
      result = await fetchWithManualRedirects(
        url,
        {
          method: 'GET',
          headers: {
            'Range': `bytes=0-${RADIO_VALIDATION.SAMPLE_BUFFER_SIZE - 1}`, // Get first 8KB
            'User-Agent': 'Mozilla/5.0 (compatible; NavidromeBot/1.0)',
            'Accept': 'audio/*',
          },
          signal: controller.signal,
        },
        followRedirects,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (result.error !== null || result.response === null) {
      return { buffer: null, headers: null, finalUrl: result.finalUrl, error: result.error ?? 'No response' };
    }

    const response = result.response;
    if (!response.ok && response.status !== 206) {
      return {
        buffer: null,
        headers: response.headers,
        finalUrl: result.finalUrl,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    // Some servers don't handle Range requests properly and hang on arrayBuffer()
    // Use streaming approach with timeout protection
    try {
      const bodyStream = response.body;
      if (!bodyStream) {
        return {
          buffer: null,
          headers: response.headers,
          finalUrl: result.finalUrl,
          error: 'No response body reader available',
        };
      }
      const reader = (bodyStream as ReadableStream<Uint8Array>).getReader();

      const chunks: Uint8Array[] = [];
      let totalLength = 0;
      const maxBytes = RADIO_VALIDATION.SAMPLE_BUFFER_SIZE; // 8KB limit
      const startTime = Date.now();
      const readTimeout = RADIO_VALIDATION.STREAM_READ_TIMEOUT; // 3 second timeout for reading

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- intentional infinite read loop; exits via break/return
      while (true) {
        // Check if we've exceeded our read timeout
        if (Date.now() - startTime > readTimeout) {
          await reader.cancel();
          return {
            buffer: totalLength > 0 ? concatChunks(chunks, totalLength) : null,
            headers: response.headers,
            finalUrl: result.finalUrl,
            error: 'Read timeout - got partial data',
          };
        }

        const { value, done } = await reader.read();

        if (done) break;
        // Slice oversized chunks BEFORE pushing — a server that ignores the
        // Range header can hand us one multi-MB chunk; the post-push limit
        // check would already have allocated the entire blob in heap.
        const remaining = maxBytes - totalLength;
        const slice = value.length > remaining ? value.subarray(0, remaining) : value;
        chunks.push(slice);
        totalLength += slice.length;

        // Stop if we have enough data
        if (totalLength >= maxBytes) {
          await reader.cancel();
          break;
        }
      }

      // Combine chunks
      if (totalLength > 0) {
        return {
          buffer: concatChunks(chunks, totalLength),
          headers: response.headers,
          finalUrl: result.finalUrl,
          error: null,
        };
      } else {
        return {
          buffer: null,
          headers: response.headers,
          finalUrl: result.finalUrl,
          error: 'No data received from stream',
        };
      }
    } catch (streamErr) {
      if (streamErr instanceof Error && streamErr.name === 'AbortError') {
        return { buffer: null, headers: response.headers, finalUrl: result.finalUrl, error: 'Stream reading aborted' };
      }
      throw streamErr;
    }
  } catch (err) {
    if (err instanceof Error) {
      if (err.name === 'AbortError') {
        return { buffer: null, headers: null, finalUrl: url, error: `Audio sampling timeout after ${Math.max(RADIO_VALIDATION.MIN_SAMPLE_TIMEOUT, remainingTimeout)}ms` };
      }
      return { buffer: null, headers: null, finalUrl: url, error: `Audio sampling failed: ${err.message}` };
    }
    return { buffer: null, headers: null, finalUrl: url, error: 'Unknown audio sampling error' };
  }
}

function concatChunks(chunks: readonly Uint8Array[], totalLength: number): Uint8Array {
  const buffer = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  return buffer;
}
