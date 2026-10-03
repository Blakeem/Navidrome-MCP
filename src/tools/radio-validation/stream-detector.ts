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

interface AudioDetectionResult {
  readonly detected: boolean;
  readonly format?: string;
  readonly mime?: string;
}

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
  'application/x-mpegurl', // HLS
];

const STREAMING_HEADER_PREFIXES = ['icy-', 'x-audiocast-'];
// Shoutcast sends its notice banners on error responses too, so they prove no stream.
const NOTICE_HEADER_PREFIX = 'icy-notice';

export function isAudioContentType(contentType: string | null): boolean {
  if (contentType === null || contentType === '') return false;

  const normalized = contentType.toLowerCase();
  return VALID_AUDIO_MIMES.some(mime => normalized.includes(mime));
}

// undici decodes header bytes as latin1, while Icecast and Shoutcast pass ICY fields through as the source's UTF-8.
function decodeIcyValue(value: string): string {
  const utf8 = Buffer.from(value, 'latin1').toString('utf8');
  return utf8.includes('\uFFFD') ? value : utf8;
}

/** Some SHOUTcast/Icecast servers put markup in ICY fields, and raw HTML breaks client markdown. */
export function extractStreamingHeaders(headers: Headers): Record<string, string> {
  const streamHeaders: Record<string, string> = {};

  headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    const isStreamingHeader = STREAMING_HEADER_PREFIXES.some((prefix) => lowerKey.startsWith(prefix));
    if (isStreamingHeader && !lowerKey.startsWith(NOTICE_HEADER_PREFIX)) {
      streamHeaders[lowerKey] = stripHtml(decodeIcyValue(value));
    }
  });

  return streamHeaders;
}

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

    const signatures = [
      { bytes: [0xFF, 0xFB], format: 'mp3', mime: 'audio/mpeg' }, // MP3
      { bytes: [0xFF, 0xF1], format: 'aac', mime: 'audio/aac' },  // AAC
      { bytes: [0xFF, 0xF9], format: 'aac', mime: 'audio/aac' },  // AAC
      { bytes: [0x4F, 0x67, 0x67, 0x53], format: 'ogg', mime: 'audio/ogg' }, // OGG
    ];

    for (const sig of signatures) {
      // An absent byte must count as a mismatch, not a wildcard, so a
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