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

import { DEFAULT_USER_AGENT } from '../../constants/defaults.js';
import { RADIO_VALIDATION } from '../../constants/timeouts.js';
import {
  describeFetchError,
  hostResolvesToPrivateIp,
  isHttpParserError,
  isHttpUrlScheme,
  NON_STANDARD_HTTP_RESPONSE,
  PRIVATE_ADDRESS_REFUSAL,
  safeFetch,
} from '../../utils/network-safety.js';

interface ValidationContext {
  readonly url: string;
  readonly timeout: number;
  readonly followRedirects: boolean;
}

/** Radio stream redirects are almost always 1-2 hops, so anything past 5 is suspicious. */
const MAX_REDIRECTS = 5;

interface FetchWithRedirectsResult {
  readonly response: Response | null;
  readonly finalUrl: string;
  readonly error: string | null;
}

/**
 * Manual redirect following lets each hop be refused with a specific message.
 * safeFetch's dispatcher enforces the private-IP block on every connection, the initial URL included.
 */
async function fetchWithManualRedirects(
  initialUrl: string,
  init: RequestInit,
  followRedirects: boolean,
): Promise<FetchWithRedirectsResult> {
  let currentUrl = initialUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await safeFetch(currentUrl, { ...init, redirect: 'manual' });

    const isRedirect = response.status >= 300 && response.status < 400;
    if (!isRedirect || !followRedirects) {
      return { response, finalUrl: currentUrl, error: null };
    }

    const location = response.headers.get('location');
    if (location === null || location === '') {
      // A 3xx with no Location is treated as the terminal response.
      return { response, finalUrl: currentUrl, error: null };
    }

    // Cancel the discarded 3xx body so undici returns the socket to the pool now.
    if (response.body) {
      await response.body.cancel().catch(() => { /* body already released */ });
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
        return { response: null, finalUrl: currentUrl, error: `Refusing to follow redirect to ${PRIVATE_ADDRESS_REFUSAL}: ${nextUrl.hostname}` };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return { response: null, finalUrl: currentUrl, error: `Failed to resolve redirect target ${nextUrl.hostname}: ${msg}` };
    }

    currentUrl = nextUrl.toString();
  }

  return { response: null, finalUrl: currentUrl, error: `Exceeded maximum redirects (${MAX_REDIRECTS})` };
}

/** undici's strict parser fails deterministically on legacy ICY responses, so the reason is marked. */
function describeProbeError(err: unknown): string {
  const marker = isHttpParserError(err) ? ` (${NON_STANDARD_HTTP_RESPONSE})` : '';
  return `${describeFetchError(err)}${marker}`;
}

export async function validateWithHead(
  context: ValidationContext
): Promise<FetchWithRedirectsResult> {
  const headTimeout = Math.floor(context.timeout * RADIO_VALIDATION.HEAD_TIMEOUT_RATIO);

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
            // Shoutcast DNAS v2 serves its HTML status page to any User-Agent carrying a `Mozilla` token.
            'User-Agent': DEFAULT_USER_AGENT,
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
      return { response: null, finalUrl: context.url, error: `HEAD request failed: ${describeProbeError(err)}` };
    }
    return { response: null, finalUrl: context.url, error: 'Unknown HEAD request error' };
  }
}

export async function sampleAudioData(
  url: string,
  remainingTimeout: number,
  followRedirects: boolean,
  overallSignal?: AbortSignal,
): Promise<{ buffer: Uint8Array | null; headers: Headers | null; httpStatus?: number; finalUrl: string; error: string | null }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, remainingTimeout);
    // The overall deadline must abort an in-flight sample too.
    const signal = overallSignal
      ? AbortSignal.any([controller.signal, overallSignal])
      : controller.signal;

    // The timer stays armed through the body read so a mid-body stall aborts.
    try {
      const result = await fetchWithManualRedirects(
        url,
        {
          method: 'GET',
          headers: {
            'Range': `bytes=0-${RADIO_VALIDATION.SAMPLE_BUFFER_SIZE - 1}`,
            'User-Agent': DEFAULT_USER_AGENT,
            'Accept': 'audio/*',
          },
          signal,
        },
        followRedirects,
      );

      if (result.error !== null || result.response === null) {
        return { buffer: null, headers: null, finalUrl: result.finalUrl, error: result.error ?? 'No response' };
      }

      const response = result.response;
      if (!response.ok && response.status !== 206) {
        // Error responses (404/500 etc.) can carry a body we never read. Cancel
        // it so the socket returns to the pool without waiting on GC.
        if (response.body) {
          await response.body.cancel().catch(() => { /* body already released */ });
        }
        return {
          buffer: null,
          headers: response.headers,
          httpStatus: response.status,
          finalUrl: result.finalUrl,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      // The catch below keeps what was read before an abort.
      const chunks: Uint8Array[] = [];
      let totalLength = 0;

      // Some servers don't handle Range requests properly and hang on arrayBuffer()
      try {
        const bodyStream = response.body;
        if (!bodyStream) {
          return {
            buffer: null,
            headers: response.headers,
            httpStatus: response.status,
            finalUrl: result.finalUrl,
            error: 'No response body reader available',
          };
        }
        // response.body is ReadableStream<any>, so the reader is typed to keep chunks off any.
        const reader: ReadableStreamDefaultReader<Uint8Array> = bodyStream.getReader();

        try {
          const maxBytes = RADIO_VALIDATION.SAMPLE_BUFFER_SIZE;

          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- intentional infinite read loop, exits via break/return
          while (true) {
            const { value, done } = await reader.read();

            if (done) break;
            // A server that ignores the Range header can hand over one multi-MB chunk.
            // Slicing before the push keeps that blob off the heap.
            const remaining = maxBytes - totalLength;
            const slice = value.length > remaining ? value.subarray(0, remaining) : value;
            chunks.push(slice);
            totalLength += slice.length;

            if (totalLength >= maxBytes) {
              break;
            }
          }

          if (totalLength > 0) {
            return {
              buffer: concatChunks(chunks, totalLength),
              headers: response.headers,
              httpStatus: response.status,
              finalUrl: result.finalUrl,
              error: null,
            };
          } else {
            return {
              buffer: null,
              headers: response.headers,
              httpStatus: response.status,
              finalUrl: result.finalUrl,
              error: 'No data received from stream',
            };
          }
        } finally {
          // cancel() is a no-op on a drained reader and must not throw out of finally.
          await reader.cancel().catch(() => { /* reader already released */ });
        }
      } catch (streamErr) {
        if (streamErr instanceof Error && streamErr.name === 'AbortError') {
          if (totalLength > 0) {
            return { buffer: concatChunks(chunks, totalLength), headers: response.headers, httpStatus: response.status, finalUrl: result.finalUrl, error: null };
          }
          return { buffer: null, headers: response.headers, httpStatus: response.status, finalUrl: result.finalUrl, error: 'Stream reading aborted' };
        }
        throw streamErr;
      }
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err) {
    if (err instanceof Error) {
      if (err.name === 'AbortError') {
        return { buffer: null, headers: null, finalUrl: url, error: `Audio sampling timeout after ${remainingTimeout}ms` };
      }
      return { buffer: null, headers: null, finalUrl: url, error: `Audio sampling failed: ${describeProbeError(err)}` };
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
