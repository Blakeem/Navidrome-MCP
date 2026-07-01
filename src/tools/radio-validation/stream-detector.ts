/**
 * Navidrome MCP Server - Radio Stream Detection Module
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

import { fileTypeFromBuffer } from 'file-type';
import { stripHtml } from '../../utils/strip-html.js';

// Audio format detection result (module-private — only the return type of the
// exported detectAudioFormat below; consumers get it via inference).
interface AudioDetectionResult {
  readonly detected: boolean;
  readonly format?: string;
  readonly mime?: string;
}

// Valid audio MIME types (module-private — consumed only by isAudioContentType)
const VALID_AUDIO_MIMES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/aac',
  'audio/aacp',
  'audio/mp4',     // AAC in MPEG-4 container (HLS fMP4, Apple streams)
  'audio/x-m4a',   // M4A (AAC) variant
  'audio/m4a',
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

// Streaming-specific headers to check (module-private — consumed only by
// extractStreamingHeaders)
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
 * Check if content type indicates audio
 */
export function isAudioContentType(contentType: string | null): boolean {
  if (contentType === null || contentType === '') return false;

  const normalized = contentType.toLowerCase();
  return VALID_AUDIO_MIMES.some(mime => normalized.includes(mime));
}

/**
 * Extract streaming headers from response.
 *
 * Header values pass through `stripHtml` because some SHOUTcast/Icecast
 * servers ship ICY notice fields with embedded markup (e.g.
 * `icy-notice2: <BR>This stream requires <a href="...">Winamp</a><BR>`).
 * Raw HTML in LLM-facing output reads like a bug and breaks markdown
 * rendering in clients; the strip is a tag-only pass so legitimate text
 * inside the tags survives.
 */
export function extractStreamingHeaders(headers: Headers): Record<string, string> {
  const streamHeaders: Record<string, string> = {};

  headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    if (STREAMING_HEADERS.includes(lowerKey) || lowerKey.startsWith('icy-')) {
      streamHeaders[lowerKey] = stripHtml(value);
    }
  });

  return streamHeaders;
}

/**
 * Detect audio format from buffer
 */
export async function detectAudioFormat(buffer: Uint8Array): Promise<AudioDetectionResult> {
  try {
    const fileType = await fileTypeFromBuffer(buffer);

    if (fileType?.mime.startsWith('audio/') === true) {
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
      // A buffer shorter than the signature can never match — an absent byte
      // (i >= buffer.length) must count as a mismatch, not a wildcard, so a
      // 1-byte [0xFF] sample doesn't falsely match MP3/AAC/OGG.
      if (buffer.length < sig.bytes.length) continue;
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