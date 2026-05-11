/**
 * Navidrome MCP Server - Radio Validation Core Module
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
import type { NavidromeClient } from '../../client/navidrome-client.js';
import {
  SINGLE_VALIDATION_TIMEOUT,
  MIN_VALIDATION_TIMEOUT,
  MAX_VALIDATION_TIMEOUT,
} from '../../constants/timeouts.js';
import {
  isAudioContentType,
  extractStreamingHeaders,
  detectAudioFormat,
} from './stream-detector.js';
import {
  validateWithHead,
  sampleAudioData,
  type ValidationContext,
} from './network-validator.js';
import {
  generateRecommendations,
  type StreamValidationResult,
} from './recommendation-engine.js';
import { isHttpUrlScheme } from '../../utils/network-safety.js';

// Validation parameter schema. The validator probes URLs over Node's fetch,
// which only supports http:// and https://. Other valid radio protocols
// (mms://, rtsp://, rtmp://) are playable by mpv but cannot be probed here;
// reject them at the schema layer with a message that points users at
// play_radio_station instead of letting fetch throw an opaque error.
const ValidateStreamSchema = z.object({
  url: z.string()
    .url('URL must be a valid URL')
    .refine(isHttpUrlScheme, {
      message: 'URL must use http:// or https://. For other protocols (mms://, rtsp://, rtmp://), pass the URL directly to play_radio_station — mpv plays those streams natively but this validator can only probe HTTP/HTTPS.',
    }),
  timeout: z.number().min(MIN_VALIDATION_TIMEOUT).max(MAX_VALIDATION_TIMEOUT).optional().default(SINGLE_VALIDATION_TIMEOUT),
  followRedirects: z.boolean().optional().default(true),
});

/**
 * Validate a radio stream URL
 */
export async function validateRadioStream(
  _client: NavidromeClient,
  args: unknown
): Promise<StreamValidationResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const warnings: string[] = [];

  // Parse and validate input
  let params;
  try {
    params = ValidateStreamSchema.parse(args);
  } catch (error) {
    if (error instanceof z.ZodError) {
      // Extract a displayable URL from the raw args (best-effort). When args
      // is an object like { url: "..." }, String(args) would be "[object Object]"
      // which is useless in error context. The LLM needs to see what it sent.
      const rawUrl = (typeof args === 'object' && args !== null && 'url' in args && typeof (args as Record<string, unknown>)['url'] === 'string')
        ? (args as Record<string, unknown>)['url'] as string
        : '(invalid input)';
      return {
        success: false,
        url: rawUrl,
        status: 'error',
        streamingHeaders: {},
        validation: {
          httpAccessible: false,
          hasAudioContentType: false,
          hasStreamingHeaders: false,
          audioDataDetected: false,
        },
        errors: [`Invalid parameters: ${error.issues.map((e: { message: string }) => e.message).join(', ')}`],
        warnings: [],
        recommendations: ['Please provide a valid http:// or https:// URL'],
        testDuration: Date.now() - startTime,
      };
    }
    throw error;
  }

  const context: ValidationContext = {
    url: params.url,
    startTime,
    timeout: params.timeout,
    followRedirects: params.followRedirects,
  };

  // Initialize result
  const result: StreamValidationResult = {
    success: false,
    url: params.url,
    status: 'invalid',
    streamingHeaders: {},
    validation: {
      httpAccessible: false,
      hasAudioContentType: false,
      hasStreamingHeaders: false,
      audioDataDetected: false,
    },
    errors,
    warnings,
    recommendations: [],
    testDuration: 0,
  };

  // Add overall timeout protection
  const overallController = new AbortController();
  const overallTimeoutId = setTimeout(() => {
    overallController.abort();
    errors.push(`Validation timeout after ${params.timeout}ms`);
  }, params.timeout);

  let headResponse: Response | null = null;
  let headError: string | null = null;
  let buffer: Uint8Array | null = null;
  let headers: Headers | null = null;
  let sampleError: string | null = null;
  let resolvedFinalUrl: string | null = null;
  // Hoisted to function scope so the post-validation warning logic (~line 243)
  // can tell the difference between "sampling was tried and produced no data"
  // and "sampling was deliberately skipped because headers were conclusive".
  let skipAudioSampling = false;

  try {
    // Step 1: Try HEAD request first
    const headResult = await validateWithHead(context);
    headResponse = headResult.response;
    headError = headResult.error;
    if (headResult.finalUrl !== params.url) {
      resolvedFinalUrl = headResult.finalUrl;
    }

    if (headError !== null && headError !== undefined && headError !== '') {
      warnings.push(headError);
    }

    // Step 2: Check if HEAD response gives us enough info to determine validity
    if (headResponse) {
      const contentType = headResponse.headers.get('content-type');
      const streamHeaders = extractStreamingHeaders(headResponse.headers);

      // If we have clear audio content-type OR streaming headers, we can skip audio sampling
      const hasAudioContentType = contentType !== null && contentType !== undefined && contentType !== '' && isAudioContentType(contentType);
      const hasStreamingHeaders = Object.keys(streamHeaders).length > 0;

      if (hasAudioContentType === true || hasStreamingHeaders === true) {
        skipAudioSampling = true;
        // Headers were conclusive — no need to sample audio data.
        // We intentionally do NOT synthesize a fake buffer here; that would
        // set audioDataDetected=true via the magic-bytes path in detectAudioFormat,
        // making the field dishonest (we never actually read stream bytes).
        // Success is determined below from hasAudioContentType || hasStreamingHeaders,
        // which correctly covers this case without a fake signal.
        headers = headResponse.headers;
        sampleError = null;
      }
    }

    // Step 3: Sample audio data only if headers were inconclusive
    if (!skipAudioSampling) {
      const elapsed = Date.now() - startTime;
      const remainingTime = params.timeout - elapsed;

      if (remainingTime > 1000 && !overallController.signal.aborted) {
        const sampleResult = await sampleAudioData(params.url, remainingTime, params.followRedirects);
        buffer = sampleResult.buffer;
        headers = sampleResult.headers ?? headResponse?.headers ?? null;
        sampleError = sampleResult.error;
        if (resolvedFinalUrl === null && sampleResult.finalUrl !== params.url) {
          resolvedFinalUrl = sampleResult.finalUrl;
        }
      } else if (remainingTime <= 1000) {
        sampleError = 'Insufficient time remaining for audio sampling';
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      errors.push('Validation aborted due to overall timeout');
    } else {
      errors.push(`Validation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  } finally {
    clearTimeout(overallTimeoutId);
  }

  if (sampleError !== null && sampleError !== undefined && sampleError !== '' && headResponse === null) {
    errors.push(sampleError);
    result.status = 'error';
  }

  // Use whichever response we got
  const finalResponse = headResponse ?? (headers !== null && headers !== undefined ? { headers, ok: true, status: 200 } : null);

  if (finalResponse) {
    result.httpStatus = finalResponse.status || 200;
    result.validation.httpAccessible = true;

    if (resolvedFinalUrl !== null) {
      result.finalUrl = resolvedFinalUrl;
    }

    // Extract content type
    const contentType = finalResponse.headers.get('content-type');
    if (contentType !== null && contentType !== undefined && contentType !== '') {
      result.contentType = contentType;
      result.validation.hasAudioContentType = isAudioContentType(contentType);

      if (!result.validation.hasAudioContentType) {
        errors.push(`Non-audio content type: ${contentType}`);
      }
    }

    // Extract streaming headers
    result.streamingHeaders = extractStreamingHeaders(finalResponse.headers);
    result.validation.hasStreamingHeaders = Object.keys(result.streamingHeaders).length > 0;
  }

  // Step 3: Detect audio format if we got data
  if (buffer && buffer.length > 0) {
    const audioFormat = await detectAudioFormat(buffer);
    result.audioFormat = audioFormat;
    result.validation.audioDataDetected = audioFormat.detected;

    if (!audioFormat.detected && result.validation.hasAudioContentType) {
      warnings.push('Could not detect audio format from data sample');
    }
  } else if (result.validation.httpAccessible === true && !skipAudioSampling) {
    // Only warn about missing samples when sampling was actually attempted —
    // when headers are conclusive we deliberately skip the body read.
    warnings.push('Could not sample audio data from stream');
  }

  // Determine overall success
  result.success = result.validation.httpAccessible &&
                  (result.validation.hasAudioContentType ||
                   result.validation.audioDataDetected ||
                   result.validation.hasStreamingHeaders);

  result.status = result.success ? 'valid' : (errors.length > 0 ? 'error' : 'invalid');

  // Generate recommendations
  result.recommendations = generateRecommendations(result);

  // Set test duration
  result.testDuration = Date.now() - startTime;

  return result;
}