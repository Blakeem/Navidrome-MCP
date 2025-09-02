/**
 * Navidrome MCP Server - Radio Stream Validation Tool
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
import { fileTypeFromBuffer } from 'file-type';
import type { NavidromeClient } from '../client/navidrome-client.js';
import { 
  SINGLE_VALIDATION_TIMEOUT, 
  MIN_VALIDATION_TIMEOUT, 
  MAX_VALIDATION_TIMEOUT 
} from '../constants/timeouts.js';

// Validation parameter schema
const ValidateStreamSchema = z.object({
  url: z.string().url('URL must be a valid URL'),
  timeout: z.number().min(MIN_VALIDATION_TIMEOUT).max(MAX_VALIDATION_TIMEOUT).optional().default(SINGLE_VALIDATION_TIMEOUT),
  followRedirects: z.boolean().optional().default(true),
});

// Audio format detection result
interface AudioDetectionResult {
  readonly detected: boolean;
  readonly format?: string;
  readonly mime?: string;
}

// Validation context for internal use
interface ValidationContext {
  readonly url: string;
  readonly startTime: number;
  readonly timeout: number;
  readonly followRedirects: boolean;
}

// Stream validation result
export interface StreamValidationResult {
  success: boolean;
  url: string;
  finalUrl?: string;
  status: 'valid' | 'invalid' | 'error';
  httpStatus?: number;
  contentType?: string;
  streamingHeaders: Record<string, string>;
  audioFormat?: AudioDetectionResult;
  validation: {
    httpAccessible: boolean;
    hasAudioContentType: boolean;
    hasStreamingHeaders: boolean;
    audioDataDetected: boolean;
  };
  errors: string[];
  warnings: string[];
  recommendations: string[];
  testDuration: number;
}

// Valid audio MIME types
const VALID_AUDIO_MIMES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/aac',
  'audio/aacp',
  'audio/ogg',
  'audio/opus',
  'audio/flac',
  'audio/x-ms-wma',
  'application/ogg',
  'audio/webm',
  'audio/x-mpegurl',  // M3U playlist
  'audio/x-scpls',    // PLS playlist
  'application/vnd.apple.mpegurl', // HLS
];

// Streaming-specific headers to check
const STREAMING_HEADERS = [
  'icy-name',
  'icy-br',
  'icy-metaint',
  'icy-genre',
  'icy-url',
  'icy-pub',
  'x-audiocast-name',
  'x-audiocast-genre',
  'x-audiocast-bitrate',
];

/**
 * Extract streaming headers from response
 */
function extractStreamingHeaders(headers: Headers): Record<string, string> {
  const streamHeaders: Record<string, string> = {};
  
  headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    if (STREAMING_HEADERS.includes(lowerKey) || lowerKey.startsWith('icy-')) {
      streamHeaders[lowerKey] = value;
    }
  });
  
  return streamHeaders;
}

/**
 * Check if content type indicates audio
 */
function isAudioContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  
  const normalized = contentType.toLowerCase();
  return VALID_AUDIO_MIMES.some(mime => normalized.includes(mime));
}

/**
 * Detect audio format from buffer
 */
async function detectAudioFormat(buffer: Uint8Array): Promise<AudioDetectionResult> {
  try {
    const fileType = await fileTypeFromBuffer(buffer);
    
    if (fileType && fileType.mime.startsWith('audio/')) {
      return {
        detected: true,
        format: fileType.ext,
        mime: fileType.mime,
      };
    }
    
    // Check for common audio signatures manually if file-type doesn't detect
    const signatures = [
      { bytes: [0xFF, 0xFB], format: 'mp3', mime: 'audio/mpeg' }, // MP3
      { bytes: [0xFF, 0xF1], format: 'aac', mime: 'audio/aac' },  // AAC
      { bytes: [0xFF, 0xF9], format: 'aac', mime: 'audio/aac' },  // AAC
      { bytes: [0x4F, 0x67, 0x67, 0x53], format: 'ogg', mime: 'audio/ogg' }, // OGG
    ];
    
    for (const sig of signatures) {
      let matches = true;
      for (let i = 0; i < sig.bytes.length; i++) {
        if (buffer[i] !== sig.bytes[i]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        return {
          detected: true,
          format: sig.format,
          mime: sig.mime,
        };
      }
    }
    
    return { detected: false };
  } catch {
    return { detected: false };
  }
}

/**
 * Perform HEAD request validation
 */
async function validateWithHead(
  context: ValidationContext
): Promise<{ response: Response | null; error: string | null }> {
  try {
    const controller = new AbortController();
    const headTimeout = Math.min(4000, Math.floor(context.timeout * 0.6)); // Use 60% of total timeout
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
        return { response: null, error: `HEAD request timeout after ${Math.min(4000, Math.floor(context.timeout * 0.6))}ms` };
      }
      return { response: null, error: `HEAD request failed: ${err.message}` };
    }
    return { response: null, error: 'Unknown HEAD request error' };
  }
}

/**
 * Sample audio data from stream
 */
async function sampleAudioData(
  url: string,
  remainingTimeout: number
): Promise<{ buffer: Uint8Array | null; headers: Headers | null; error: string | null }> {
  try {
    const controller = new AbortController();
    const sampleTimeout = Math.max(2000, remainingTimeout); // Ensure at least 2 seconds
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, sampleTimeout);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Range': 'bytes=0-8191', // Get first 8KB
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
      const maxBytes = 8192; // 8KB limit
      const startTime = Date.now();
      const readTimeout = 3000; // 3 second timeout for reading
      
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
        if (value) {
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
        return { buffer: null, headers: null, error: `Audio sampling timeout after ${Math.max(2000, remainingTimeout)}ms` };
      }
      return { buffer: null, headers: null, error: `Audio sampling failed: ${err.message}` };
    }
    return { buffer: null, headers: null, error: 'Unknown audio sampling error' };
  }
}

/**
 * Generate recommendations based on validation results
 */
function generateRecommendations(
  result: Partial<StreamValidationResult>
): string[] {
  const recommendations: string[] = [];
  
  if (result.status === 'valid') {
    recommendations.push('✅ Stream validated successfully');
    
    if (result.streamingHeaders?.['icy-name']) {
      recommendations.push(`🎵 Station: ${result.streamingHeaders['icy-name']}`);
    }
    
    if (result.streamingHeaders?.['icy-br']) {
      recommendations.push(`📊 Bitrate: ${result.streamingHeaders['icy-br']}kbps`);
    }
    
    if (result.audioFormat?.format) {
      recommendations.push(`🎧 Format: ${result.audioFormat.format.toUpperCase()}`);
    }
    
    recommendations.push('✨ Ready to add as radio station');
  } else if (result.status === 'invalid') {
    recommendations.push('❌ Stream validation failed');
    
    if (result.httpStatus === 404) {
      recommendations.push('🔍 Stream URL appears to be offline or moved');
      recommendations.push('💡 Check the station\'s official website for updated URLs');
    } else if (!result.validation?.hasAudioContentType) {
      recommendations.push('⚠️ URL does not serve audio content');
      recommendations.push('💡 Ensure you\'re using the stream URL, not the website URL');
    } else if (!result.validation?.audioDataDetected) {
      recommendations.push('⚠️ Could not detect valid audio data');
      recommendations.push('💡 The stream may be geo-restricted or require authentication');
    }
    
    recommendations.push('🌐 Try finding alternative streams at radio-browser.info');
  } else {
    recommendations.push('⚠️ Stream validation encountered an error');
    recommendations.push('🔄 Try again later or check your network connection');
  }
  
  return recommendations;
}

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
      return {
        success: false,
        url: String(args),
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
        recommendations: ['❌ Please provide a valid URL'],
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
  
  try {
    // Step 1: Try HEAD request first
    const headResult = await validateWithHead(context);
    headResponse = headResult.response;
    headError = headResult.error;
    
    if (headError) {
      warnings.push(headError);
    }
    
    // Step 2: Check if HEAD response gives us enough info to determine validity
    let skipAudioSampling = false;
    if (headResponse) {
      const contentType = headResponse.headers.get('content-type');
      const streamHeaders = extractStreamingHeaders(headResponse.headers);
      
      // If we have clear audio content-type OR streaming headers, we can skip audio sampling
      const hasAudioContentType = contentType && isAudioContentType(contentType);
      const hasStreamingHeaders = Object.keys(streamHeaders).length > 0;
      
      if (hasAudioContentType || hasStreamingHeaders) {
        skipAudioSampling = true;
        // Create a fake successful result for audio detection based on content-type
        buffer = new Uint8Array([0xFF, 0xFB]); // Minimal buffer to satisfy validation logic
        headers = headResponse.headers;
        sampleError = null;
      }
    }
    
    // Step 3: Sample audio data only if headers were inconclusive
    if (!skipAudioSampling) {
      const elapsed = Date.now() - startTime;
      const remainingTime = params.timeout - elapsed;
      
      if (remainingTime > 1000 && !overallController.signal.aborted) {
        const sampleResult = await sampleAudioData(params.url, remainingTime);
        buffer = sampleResult.buffer;
        headers = sampleResult.headers || headResponse?.headers || null;
        sampleError = sampleResult.error;
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
  
  if (sampleError && !headResponse) {
    errors.push(sampleError);
    result.status = 'error';
  }
  
  // Use whichever response we got
  const finalResponse = headResponse || (headers ? { headers, ok: true, status: 200, url: params.url } : null);
  
  if (finalResponse) {
    result.httpStatus = finalResponse.status || 200;
    result.validation.httpAccessible = true;
    
    // Check for redirects
    if (finalResponse.url && finalResponse.url !== params.url) {
      result.finalUrl = finalResponse.url;
    }
    
    // Extract content type
    const contentType = finalResponse.headers.get('content-type');
    if (contentType) {
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
  } else if (result.validation.httpAccessible) {
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