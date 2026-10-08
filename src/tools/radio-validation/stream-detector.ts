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

// Headers joins a header sent twice with ", ", and some servers repeat an ICY field, which showed as "320, 320".
function collapseRepeatedValue(value: string): string {
  const parts = value.split(', ');
  return parts.every((part) => part === parts[0]) ? (parts[0] ?? value) : value;
}

/** Some SHOUTcast/Icecast servers put markup in ICY fields, and raw HTML breaks client markdown. */
export function extractStreamingHeaders(headers: Headers): Record<string, string> {
  const streamHeaders: Record<string, string> = {};

  headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    const isStreamingHeader = STREAMING_HEADER_PREFIXES.some((prefix) => lowerKey.startsWith(prefix));
    if (isStreamingHeader && !lowerKey.startsWith(NOTICE_HEADER_PREFIX)) {
      streamHeaders[lowerKey] = stripHtml(decodeIcyValue(collapseRepeatedValue(value)));
    }
  });

  return streamHeaders;
}

// Bitrates in kbps by bitrate index for Layer II and III. Index 0 (free format) and 15 (invalid) are unusable.
const MPEG1_LAYER2_KBPS = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384];
const MPEG1_LAYER3_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_LAYER23_KBPS = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
// Sample rates by MPEG version bits (0 = MPEG 2.5, 2 = MPEG 2, 3 = MPEG 1). Version 1 is reserved.
const MPEG_SAMPLE_RATES: Readonly<Record<number, readonly number[]>> = {
  0: [11025, 12000, 8000],
  2: [22050, 24000, 16000],
  3: [44100, 48000, 32000],
};
const ADTS_HEADER_BYTES = 7;
const OGG_CAPTURE_PATTERN = [0x4f, 0x67, 0x67, 0x53, 0x00];

interface FrameHeader {
  readonly kind: 'mp3' | 'mp2' | 'aac';
  readonly length: number;
}

function readMpegFrame(buffer: Uint8Array, offset: number): FrameHeader | null {
  const [b0, b1, b2] = [buffer[offset], buffer[offset + 1], buffer[offset + 2]];
  if (b0 !== 0xff || b1 === undefined || b2 === undefined || (b1 & 0xe0) !== 0xe0) return null;
  const version = (b1 >> 3) & 0x03;
  const layer = (b1 >> 1) & 0x03;
  const sampleRate = MPEG_SAMPLE_RATES[version]?.[(b2 >> 2) & 0x03];
  // Layer bits 3 are Layer I, which radio does not use, and 0 is reserved.
  if (sampleRate === undefined || (layer !== 1 && layer !== 2)) return null;
  const table = version === 3 ? (layer === 1 ? MPEG1_LAYER3_KBPS : MPEG1_LAYER2_KBPS) : MPEG2_LAYER23_KBPS;
  const kbps = table[b2 >> 4] ?? 0;
  if (kbps === 0) return null;
  const coefficient = layer === 1 && version !== 3 ? 72 : 144;
  const length = Math.floor((coefficient * kbps * 1000) / sampleRate) + ((b2 >> 1) & 0x01);
  return { kind: layer === 1 ? 'mp3' : 'mp2', length };
}

function readAdtsFrame(buffer: Uint8Array, offset: number): FrameHeader | null {
  const [b0, b1, b2, b3, b4, b5] = [0, 1, 2, 3, 4, 5].map((i) => buffer[offset + i]);
  if (b0 !== 0xff || b1 === undefined || b2 === undefined || b3 === undefined || b4 === undefined || b5 === undefined) {
    return null;
  }
  // ADTS shares MPEG's sync bits but its layer bits are always 0, which MPEG reserves.
  if ((b1 & 0xf6) !== 0xf0 || ((b2 >> 2) & 0x0f) > 12) return null;
  const length = ((b3 & 0x03) << 11) | (b4 << 3) | (b5 >> 5);
  return length > ADTS_HEADER_BYTES ? { kind: 'aac', length } : null;
}

/**
 * A live stream sample starts mid-frame, so a format signature at byte 0 misses it. Three frame headers, each one
 * frame after the last, identify MPEG audio or ADTS AAC, since a lone sync pattern shows up in random data.
 */
function findStreamFrames(buffer: Uint8Array): AudioDetectionResult | null {
  for (let offset = 0; offset + 6 < buffer.length; offset++) {
    if (OGG_CAPTURE_PATTERN.every((byte, i) => buffer[offset + i] === byte)) {
      return { detected: true, format: 'ogg', mime: 'audio/ogg' };
    }
    const frame = readMpegFrame(buffer, offset) ?? readAdtsFrame(buffer, offset);
    if (frame === null) continue;
    const readFrame = frame.kind === 'aac' ? readAdtsFrame : readMpegFrame;
    const second = readFrame(buffer, offset + frame.length);
    const third = second === null ? null : readFrame(buffer, offset + frame.length + second.length);
    if (second?.kind === frame.kind && third?.kind === frame.kind) {
      return frame.kind === 'aac'
        ? { detected: true, format: 'aac', mime: 'audio/aac' }
        : { detected: true, format: frame.kind, mime: 'audio/mpeg' };
    }
  }
  return null;
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

    return findStreamFrames(buffer) ?? { detected: false };
  } catch {
    return { detected: false };
  }
}