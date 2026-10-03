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

import type { z } from 'zod';
import { ValidateStreamSchema } from '../../schemas/index.js';
import type { StreamValidationResult } from '../../types/index.js';
import {
  isAudioContentType,
  extractStreamingHeaders,
  detectAudioFormat,
} from './stream-detector.js';
import {
  validateWithHead,
  sampleAudioData,
} from './network-validator.js';
import { generateRecommendations } from './recommendation-engine.js';

type ValidateStreamParams = z.infer<typeof ValidateStreamSchema>;
type AudioFormat = NonNullable<StreamValidationResult['audioFormat']>;

// Below this remaining budget a sample cannot finish, so it is not started.
const MIN_SAMPLE_BUDGET_MS = 1000;

/** Everything the network probe learned, in the form the pure classifier reads. */
export interface StreamProbe {
  headResponse: { readonly headers: Headers; readonly status: number } | null;
  headError: string | null;
  /** Sample headers when sampling ran, HEAD headers when HEAD was conclusive, else null. */
  headers: Headers | null;
  sampledStatus: number | null;
  buffer: Uint8Array | null;
  sampleError: string | null;
  resolvedFinalUrl: string | null;
  /** HEAD was inconclusive, so sampling ran or ran out of budget. */
  sampled: boolean;
  /** Sampling failed with no HEAD response, so the endpoint never answered. */
  transportFailed: boolean;
}

/**
 * Validate a radio stream URL
 */
export async function validateRadioStream(args: unknown): Promise<StreamValidationResult> {
  const startTime = Date.now();

  const parsed = ValidateStreamSchema.safeParse(args);
  if (!parsed.success) {
    return invalidParametersResult(args, parsed.error, Date.now() - startTime);
  }

  const probe = await probeStream(parsed.data, startTime);
  const audioFormat = probe.buffer !== null && probe.buffer.length > 0 ? await detectAudioFormat(probe.buffer) : null;
  const result = classifyStream(parsed.data.url, probe, audioFormat);

  result.recommendations = generateRecommendations(result);
  result.testDuration = Date.now() - startTime;
  return result;
}

function invalidParametersResult(args: unknown, error: z.ZodError, testDuration: number): StreamValidationResult {
  // String(args) would read "[object Object]", and the LLM needs to see the URL it sent.
  const rawUrl = (typeof args === 'object' && args !== null && 'url' in args && typeof (args as Record<string, unknown>)['url'] === 'string')
    ? (args as Record<string, unknown>)['url'] as string
    : '(invalid input)';
  const urlIsInvalid = error.issues.some((issue) => issue.path[0] === 'url');
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
    errors: [`Invalid parameters: ${error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ')}`],
    warnings: [],
    recommendations: [urlIsInvalid ? 'Please provide a valid http:// or https:// URL' : 'Correct the named parameter and retry'],
    testDuration,
  };
}

/**
 * HEAD first, then a GET sample only when HEAD was inconclusive. The overall timer
 * aborts an in-flight sample, and the sampler reports that as its own timeout.
 */
async function probeStream(params: ValidateStreamParams, startTime: number): Promise<StreamProbe> {
  const probe: StreamProbe = {
    headResponse: null,
    headError: null,
    headers: null,
    sampledStatus: null,
    buffer: null,
    sampleError: null,
    resolvedFinalUrl: null,
    sampled: false,
    transportFailed: false,
  };

  const overallController = new AbortController();
  const overallTimeoutId = setTimeout(() => {
    overallController.abort();
  }, params.timeout);

  try {
    const headResult = await validateWithHead({
      url: params.url,
      timeout: params.timeout,
      followRedirects: params.followRedirects,
    });
    probe.headResponse = headResult.response;
    probe.headError = headResult.error;
    if (headResult.finalUrl !== params.url) {
      probe.resolvedFinalUrl = headResult.finalUrl;
    }

    if (probe.headResponse !== null && headersAreConclusive(probe.headResponse.headers)) {
      probe.headers = probe.headResponse.headers;
    } else {
      probe.sampled = true;
      const remainingTime = params.timeout - (Date.now() - startTime);
      if (remainingTime > MIN_SAMPLE_BUDGET_MS) {
        // Reusing the URL HEAD resolved skips a second walk of the redirect chain and its private-IP checks.
        const sampleResult = await sampleAudioData(probe.resolvedFinalUrl ?? params.url, remainingTime, params.followRedirects, overallController.signal);
        probe.buffer = sampleResult.buffer;
        probe.headers = sampleResult.headers ?? probe.headResponse?.headers ?? null;
        probe.sampledStatus = sampleResult.httpStatus ?? null;
        probe.sampleError = sampleResult.error;
        if (probe.resolvedFinalUrl === null && sampleResult.finalUrl !== params.url) {
          probe.resolvedFinalUrl = sampleResult.finalUrl;
        }
      } else {
        probe.sampleError = 'Insufficient time remaining for audio sampling';
      }
    }
  } finally {
    clearTimeout(overallTimeoutId);
  }

  probe.transportFailed = probe.headResponse === null && probe.sampleError !== null && probe.sampleError !== '';
  return probe;
}

function headersAreConclusive(headers: Headers): boolean {
  const contentType = headers.get('content-type');
  const hasAudioContentType = contentType !== null && contentType !== '' && isAudioContentType(contentType);
  return hasAudioContentType || Object.keys(extractStreamingHeaders(headers)).length > 0;
}

/**
 * Map a probe to the validation result. Recommendations and test duration are left for the caller.
 */
export function classifyStream(url: string, probe: StreamProbe, audioFormat: AudioFormat | null): StreamValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const result: StreamValidationResult = {
    success: false,
    url,
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

  if (probe.headError !== null && probe.headError !== '') {
    warnings.push(probe.headError);
  }
  if (probe.sampleError !== null && probe.sampleError !== '') {
    // With a HEAD response the endpoint answered, so a failed sample stays a warning.
    if (probe.headResponse === null) {
      errors.push(probe.sampleError);
    } else {
      warnings.push(probe.sampleError);
    }
  }

  const finalStatus: number | null = probe.sampledStatus ?? probe.headResponse?.status ?? null;
  const finalHeaders = probe.headers ?? probe.headResponse?.headers ?? null;

  if (finalHeaders !== null) {
    if (finalStatus !== null) {
      result.httpStatus = finalStatus;
      result.validation.httpAccessible = (finalStatus >= 200 && finalStatus < 300) || finalStatus === 206;
    }

    if (probe.resolvedFinalUrl !== null) {
      result.finalUrl = probe.resolvedFinalUrl;
    }

    result.streamingHeaders = extractStreamingHeaders(finalHeaders);
    result.validation.hasStreamingHeaders = Object.keys(result.streamingHeaders).length > 0;

    const contentType = finalHeaders.get('content-type');
    if (contentType !== null && contentType !== '') {
      result.contentType = contentType;
      result.validation.hasAudioContentType = isAudioContentType(contentType);

      // Icecast mounts that reject HEAD answer text/html yet echo the full ICY header set, which still proves a stream.
      if (!result.validation.hasAudioContentType && !result.validation.hasStreamingHeaders) {
        errors.push(`Non-audio content type: ${contentType}`);
      }
    }
  }

  if (audioFormat !== null) {
    result.audioFormat = audioFormat;
    result.validation.audioDataDetected = audioFormat.detected;

    if (!audioFormat.detected && result.validation.hasAudioContentType) {
      warnings.push('Could not detect audio format from data sample');
    }
  } else if (result.validation.httpAccessible && probe.sampled) {
    warnings.push('Could not sample audio data from stream');
  }

  // ICY headers prove a stream even when HEAD returns 4xx.
  // Without them the endpoint must be reachable and look like audio.
  result.success =
    result.validation.hasStreamingHeaders ||
    (result.validation.httpAccessible &&
      (result.validation.hasAudioContentType || result.validation.audioDataDetected));

  if (!result.success && errors.length === 0) {
    errors.push(
      result.httpStatus !== undefined && !result.validation.httpAccessible
        ? `HTTP ${result.httpStatus}`
        : 'No audio content type, streaming headers, or audio data detected',
    );
  }

  result.status = result.success ? 'valid' : (probe.transportFailed ? 'error' : 'invalid');
  return result;
}
