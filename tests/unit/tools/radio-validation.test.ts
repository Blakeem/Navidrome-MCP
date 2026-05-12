/**
 * Navidrome MCP Server - Radio Stream Validation Tests
 * Copyright (C) 2025
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from 'vitest';

// Mock node:dns/promises BEFORE importing the validator so its internal
// hostResolvesToPrivateIp uses the mock for redirect-target resolution.
const mockDnsLookup = vi.fn();
vi.mock('node:dns/promises', () => ({
  lookup: (...args: unknown[]) => mockDnsLookup(...args),
}));

import { validateRadioStream } from '../../../src/tools/radio-validation.js';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as MockedFunction<typeof fetch>;

// Mock file-type
vi.mock('file-type', () => ({
  fileTypeFromBuffer: vi.fn(),
}));

describe('Radio Stream Validation', () => {
  let mockClient: NavidromeClient;

  beforeEach(() => {
    mockClient = {} as NavidromeClient;
    vi.clearAllMocks();
    // Default DNS mock — most tests don't redirect, so this is unused.
    // Tests that exercise redirects override this.
    mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Input Validation', () => {
    it('should reject invalid URL', async () => {
      const result = await validateRadioStream(mockClient, {
        url: 'not-a-url',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('error');
      expect(result.errors[0]).toContain('Invalid parameters');
      expect(result.recommendations[0]).toBe('Please provide a valid http:// or https:// URL');
    });

    it('should reject mms:// with a message pointing to play_radio_station', async () => {
      const result = await validateRadioStream(mockClient, {
        url: 'mms://example.com/stream',
      });

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('Invalid parameters');
      expect(result.errors[0]).toContain('play_radio_station');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should reject rtsp:// before any fetch is attempted', async () => {
      const result = await validateRadioStream(mockClient, {
        url: 'rtsp://example.com/live',
      });

      expect(result.success).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should reject file:// URLs', async () => {
      const result = await validateRadioStream(mockClient, {
        url: 'file:///etc/passwd',
      });

      expect(result.success).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should reject timeout too low', async () => {
      const result = await validateRadioStream(mockClient, {
        url: 'https://example.com/stream.mp3',
        timeout: 500, // Below minimum of 1000
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('error');
      expect(result.errors[0]).toContain('Invalid parameters');
    });

    it('should reject timeout too high', async () => {
      const result = await validateRadioStream(mockClient, {
        url: 'https://example.com/stream.mp3',
        timeout: 50000, // Above maximum of 30000
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('error');
      expect(result.errors[0]).toContain('Invalid parameters');
    });

    it('should return the actual URL in the error response, not [object Object]', async () => {
      // Before the fix, String({ url: 'mms://...' }) = '[object Object]',
      // making the error response useless for the LLM.
      const result = await validateRadioStream(mockClient, {
        url: 'mms://example.com/stream',
        timeout: 5000,
      });

      expect(result.success).toBe(false);
      // url field should be the actual URL string, not '[object Object]'
      expect(result.url).toBe('mms://example.com/stream');
      expect(result.url).not.toBe('[object Object]');
      expect(result.url).not.toContain('object Object');
    });

    it('should return (invalid input) when args is not an object', async () => {
      const result = await validateRadioStream(mockClient, 'not-an-object');

      expect(result.success).toBe(false);
      expect(result.url).toBe('(invalid input)');
    });

    it('should accept valid parameters', async () => {
      // Mock successful HEAD request with audio content-type and streaming headers
      // This will trigger smart validation that skips audio sampling
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: 'https://example.com/stream.mp3',
        headers: new Headers({
          'content-type': 'audio/mpeg',
          'icy-name': 'Test Station',
        }),
      });

      // With smart validation, audio sampling should be skipped
      const result = await validateRadioStream(mockClient, {
        url: 'https://example.com/stream.mp3',
        timeout: 5000,
        followRedirects: false,
      });

      expect(result.url).toBe('https://example.com/stream.mp3');
      // Should only make HEAD request due to smart validation
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
    });
  });

  describe('HTTP Validation', () => {
    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await validateRadioStream(mockClient, {
        url: 'https://offline-station.com/stream.mp3',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('error');
      expect(result.validation.httpAccessible).toBe(false);
    });

    it('should handle timeout errors', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValue(abortError);

      const result = await validateRadioStream(mockClient, {
        url: 'https://slow-station.com/stream.mp3',
        timeout: 2000,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('error');
      expect(result.validation.httpAccessible).toBe(false);
    });

    it('should handle 404 errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers(),
      });

      const result = await validateRadioStream(mockClient, {
        url: 'https://example.com/missing-stream.mp3',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('invalid');
      expect(result.httpStatus).toBe(404);
      expect(result.recommendations).toContain('Stream URL appears to be offline or moved');
    });

    it('should detect valid audio content type', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: 'https://example.com/stream.mp3',
        headers: new Headers({
          'content-type': 'audio/mpeg',
        }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 206,
        headers: new Headers(),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
      });

      const result = await validateRadioStream(mockClient, {
        url: 'https://example.com/stream.mp3',
      });

      expect(result.validation.hasAudioContentType).toBe(true);
      expect(result.contentType).toBe('audio/mpeg');
    });

    it('should detect non-audio content type', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'text/html',
        }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
      });

      const result = await validateRadioStream(mockClient, {
        url: 'https://example.com/webpage.html',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('error');
      expect(result.validation.hasAudioContentType).toBe(false);
      expect(result.recommendations).toContain('Stream validation encountered an error');
    });
  });

  describe('Streaming Headers', () => {
    it('should detect SHOUTcast headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'audio/mpeg',
          'icy-name': 'Test Radio Station',
          'icy-br': '128',
          'icy-genre': 'Pop',
          'icy-metaint': '16000',
        }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 206,
        headers: new Headers(),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
      });

      const result = await validateRadioStream(mockClient, {
        url: 'https://shoutcast.example.com/stream',
      });

      expect(result.validation.hasStreamingHeaders).toBe(true);
      expect(result.streamingHeaders['icy-name']).toBe('Test Radio Station');
      expect(result.streamingHeaders['icy-br']).toBe('128');
      expect(result.streamingHeaders['icy-genre']).toBe('Pop');
      expect(result.recommendations).toContain('Station: Test Radio Station');
      expect(result.recommendations).toContain('Bitrate: 128kbps');
    });

    it('should work without streaming headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'audio/mpeg',
        }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 206,
        headers: new Headers(),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
      });

      const result = await validateRadioStream(mockClient, {
        url: 'https://direct-stream.example.com/audio.mp3',
      });

      expect(result.validation.hasStreamingHeaders).toBe(false);
      expect(result.validation.hasAudioContentType).toBe(true);
    });
  });

  describe('Audio Format Detection', () => {
    beforeEach(async () => {
      const { fileTypeFromBuffer } = vi.mocked(await import('file-type'));
      vi.mocked(fileTypeFromBuffer).mockClear();
    });

    it('should detect MP3 format via audio sampling', async () => {
      const { fileTypeFromBuffer } = vi.mocked(await import('file-type'));

      // HEAD with a generic content-type so headers are inconclusive — forces
      // the validator to fall through to actual audio sampling (GET request).
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/octet-stream',
        }),
      });

      // Audio sampling GET response with a real (mocked) reader
      const mp3Data = new Uint8Array([0xFF, 0xFB, 0x90, 0x00]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 206,
        headers: new Headers(),
        body: {
          getReader: () => {
            let done = false;
            return {
              read: vi.fn().mockImplementation(() => {
                if (!done) { done = true; return Promise.resolve({ value: mp3Data, done: false }); }
                return Promise.resolve({ value: undefined, done: true });
              }),
              cancel: vi.fn().mockResolvedValue(undefined),
            };
          },
        },
      } as unknown as Response);

      fileTypeFromBuffer.mockResolvedValue({
        ext: 'mp3',
        mime: 'audio/mpeg',
      });

      const result = await validateRadioStream(mockClient, {
        url: 'https://example.com/stream.mp3',
      });

      expect(result.validation.audioDataDetected).toBe(true);
      expect(result.audioFormat?.format).toBe('mp3');
      expect(result.audioFormat?.mime).toBe('audio/mpeg');
      expect(result.recommendations).toContain('Format: MP3');
    });

    it('should handle file-type detection failure', async () => {
      const { fileTypeFromBuffer } = vi.mocked(await import('file-type'));
      
      // Use non-audio content-type to force audio sampling
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/octet-stream', // Generic type
        }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 206,
        headers: new Headers(),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
      });

      fileTypeFromBuffer.mockResolvedValue(null);

      const result = await validateRadioStream(mockClient, {
        url: 'https://example.com/unknown-format.stream',
      });

      expect(result.validation.audioDataDetected).toBe(false);
      // When no audio data is detected, audioFormat may be undefined
      expect(result.audioFormat?.detected ?? false).toBe(false);
    });

    it('should detect MP3 signature manually via audio sampling', async () => {
      const { fileTypeFromBuffer } = vi.mocked(await import('file-type'));

      // HEAD with a generic content-type — forces audio sampling (GET request).
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/octet-stream',
        }),
      });

      // Create buffer with MP3 magic-bytes signature
      const mp3Data = new Uint8Array([0xFF, 0xFB, 0x90, 0x00]);

      // Audio sampling GET response with a streaming reader
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 206,
        headers: new Headers(),
        body: {
          getReader: () => {
            let done = false;
            return {
              read: vi.fn().mockImplementation(() => {
                if (!done) { done = true; return Promise.resolve({ value: mp3Data, done: false }); }
                return Promise.resolve({ value: undefined, done: true });
              }),
              cancel: vi.fn().mockResolvedValue(undefined),
            };
          },
        },
      } as unknown as Response);

      fileTypeFromBuffer.mockResolvedValue(null); // file-type can't detect; falls back to magic bytes

      const result = await validateRadioStream(mockClient, {
        url: 'https://example.com/stream.mp3',
      });

      expect(result.validation.audioDataDetected).toBe(true);
      expect(result.audioFormat?.format).toBe('mp3');
      expect(result.audioFormat?.mime).toBe('audio/mpeg');
    });
  });

  describe('Redirect Handling', () => {
    it('should follow a public 302 to a public final URL', async () => {
      // First HEAD: 302 with Location pointing at a public destination
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 302,
        statusText: 'Found',
        headers: new Headers({ 'location': 'https://final-destination.com/stream.mp3' }),
      });
      // Second HEAD against the redirect target: 200 with audio content-type
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'audio/mpeg' }),
      });
      // DNS for the redirect host resolves to a public address
      mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);

      const result = await validateRadioStream(mockClient, {
        url: 'https://redirect.example.com/stream',
        followRedirects: true,
      });

      expect(result.finalUrl).toBe('https://final-destination.com/stream.mp3');
      expect(result.success).toBe(true);
    });

    it('should refuse to follow a redirect to a private IP', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 302,
        statusText: 'Found',
        headers: new Headers({ 'location': 'http://localhost:4533/api/admin' }),
      });
      mockDnsLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);

      const result = await validateRadioStream(mockClient, {
        url: 'https://malicious.example.com/stream',
        followRedirects: true,
      });

      // The HEAD got refused → validator falls through to sampleAudioData,
      // which retries the same redirect and is refused again. Both fetches
      // went to the ORIGINAL public URL, never to the localhost target.
      const fetchTargets = mockFetch.mock.calls.map((c) => String(c[0]));
      expect(fetchTargets.every((u) => u === 'https://malicious.example.com/stream')).toBe(true);
      expect(fetchTargets.some((u) => u.includes('localhost') || u.includes('127.0.0.1'))).toBe(false);

      const refusal = [...result.warnings, ...result.errors].some((m) =>
        m.includes('Refusing to follow redirect to private/local address'),
      );
      expect(refusal).toBe(true);
      expect(result.success).toBe(false);
    });

    it('should refuse to follow a redirect to a non-HTTP scheme', async () => {
      // Both HEAD and sampleAudioData will see the same 302 mock; queue twice.
      const redirectMock = {
        ok: false,
        status: 302,
        statusText: 'Found',
        headers: new Headers({ 'location': 'file:///etc/passwd' }),
      };
      mockFetch.mockResolvedValueOnce(redirectMock);
      mockFetch.mockResolvedValueOnce(redirectMock);

      const result = await validateRadioStream(mockClient, {
        url: 'https://shady.example.com/stream',
        followRedirects: true,
      });

      // Confirm we never followed into the file:// target
      const fetchTargets = mockFetch.mock.calls.map((c) => String(c[0]));
      expect(fetchTargets.some((u) => u.startsWith('file://'))).toBe(false);

      const refusal = [...result.warnings, ...result.errors].some((m) =>
        m.includes('non-HTTP scheme'),
      );
      expect(refusal).toBe(true);
      expect(result.success).toBe(false);
    });
  });

  describe('Success Scenarios', () => {
    it('should validate a perfect stream', async () => {
      // HEAD returns clear audio content-type + ICY streaming headers:
      // skipAudioSampling = true, so only one fetch is made.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'audio/mpeg',
          'icy-name': 'Perfect FM',
          'icy-br': '320',
          'icy-genre': 'Jazz',
        }),
      });

      const result = await validateRadioStream(mockClient, {
        url: 'https://perfect-radio.com/stream.mp3',
      });

      // Only one fetch (HEAD) — audio sampling skipped because headers are conclusive.
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.status).toBe('valid');
      expect(result.validation.httpAccessible).toBe(true);
      expect(result.validation.hasAudioContentType).toBe(true);
      expect(result.validation.hasStreamingHeaders).toBe(true);
      // audioDataDetected is honestly false — no stream bytes were read;
      // success is determined from hasAudioContentType + hasStreamingHeaders.
      expect(result.validation.audioDataDetected).toBe(false);
      // No spurious "Could not sample audio data" warning when sampling was
      // deliberately skipped because headers were conclusive.
      expect(result.warnings).not.toContain('Could not sample audio data from stream');
      expect(result.recommendations).toContain('Stream validated successfully');
      expect(result.recommendations).toContain('Station: Perfect FM');
      expect(result.recommendations).toContain('Bitrate: 320kbps');
      expect(result.recommendations).toContain('Ready to add as radio station');
    });

    it('should measure test duration', async () => {
      const mockDateNow = vi.spyOn(Date, 'now');
      let callCount = 0;
      mockDateNow.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? 1000 : 1100; // Start at 1000, end at 1100 (100ms duration)
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'audio/mpeg',
        }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 206,
        headers: new Headers(),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
      });

      const result = await validateRadioStream(mockClient, {
        url: 'https://example.com/stream.mp3',
      });

      expect(result.testDuration).toBe(100);
      mockDateNow.mockRestore();
    });
  });

  describe('Smart Header-Based Validation', () => {
    it('should skip audio sampling for Shoutcast streams with full headers', async () => {
      // This tests the fix for hanging streams like http://188.40.97.185:8179/stream
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'audio/mpeg',
          'icy-name': '',
          'icy-genre': 'Synthwave',
          'icy-br': '320',
          'icy-sr': '44100',
          'icy-url': 'https://www.synthwavecityfm.com',
          'icy-pub': '1',
          'icy-notice1': '<BR>This stream requires <a href="http://www.winamp.com">Winamp</a><BR>',
          'icy-notice2': 'Shoutcast DNAS/posix(linux x64) v2.6.1.777<BR>',
        }),
      });

      // Since we skip audio sampling, this should NOT be called
      const result = await validateRadioStream(mockClient, {
        url: 'http://188.40.97.185:8179/stream',
      });

      // Should only make HEAD request, not audio sampling request
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.status).toBe('valid');
      expect(result.validation.httpAccessible).toBe(true);
      expect(result.validation.hasAudioContentType).toBe(true);
      expect(result.validation.hasStreamingHeaders).toBe(true);
      // audioDataDetected is honestly false — we skipped audio sampling because
      // headers were conclusive; success is determined from hasAudioContentType
      // and hasStreamingHeaders instead (no fake buffer is written).
      expect(result.validation.audioDataDetected).toBe(false);
      expect(result.streamingHeaders['icy-br']).toBe('320');
      expect(result.streamingHeaders['icy-genre']).toBe('Synthwave');
      // audioFormat is not set when audio sampling is skipped (no magic-bytes check)
      expect(result.audioFormat).toBeUndefined();
      expect(result.recommendations).toContain('Stream validated successfully');
    });

    it('should skip audio sampling when only content-type indicates audio', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'audio/mpeg',
          // No streaming headers
        }),
      });

      const result = await validateRadioStream(mockClient, {
        url: 'https://simple-audio-stream.com/stream.mp3',
      });

      // Should only make HEAD request
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.validation.hasAudioContentType).toBe(true);
      expect(result.validation.hasStreamingHeaders).toBe(false);
      // audioDataDetected is honestly false — we didn't sample stream bytes;
      // success is driven by hasAudioContentType alone (no fake buffer).
      expect(result.validation.audioDataDetected).toBe(false);
    });

    it('should fall back to audio sampling when headers are inconclusive', async () => {
      // HEAD request with no useful headers
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/octet-stream', // Generic type
        }),
      });

      // Audio sampling should be attempted
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 206,
        headers: new Headers(),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
      });

      const result = await validateRadioStream(mockClient, {
        url: 'https://mystery-stream.com/audio',
      });

      // Should make both HEAD and GET requests
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.validation.hasAudioContentType).toBe(false);
      expect(result.validation.hasStreamingHeaders).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty audio data', async () => {
      // Use non-audio content-type to force audio sampling
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/octet-stream', // Generic type
        }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 206,
        headers: new Headers(),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)), // Empty
      });

      const result = await validateRadioStream(mockClient, {
        url: 'https://example.com/empty-stream.mp3',
      });

      expect(result.validation.audioDataDetected).toBe(false);
      expect(result.warnings).toContain('Could not sample audio data from stream');
    });

    it('should slice oversize chunks to the 8KB cap', async () => {
      // HEAD returns inconclusive headers so the validator falls through to sampling.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/octet-stream' }),
      });

      // GET returns one giant 100KB chunk via getReader() — simulating a server
      // that ignores Range and dumps the whole file. The validator must NOT
      // accumulate the full chunk in memory.
      const giantChunk = new Uint8Array(100 * 1024);
      giantChunk[0] = 0xFF; // MP3 frame header so detect succeeds
      giantChunk[1] = 0xFB;

      const reader = {
        read: vi.fn()
          .mockResolvedValueOnce({ value: giantChunk, done: false })
          .mockResolvedValue({ value: undefined, done: true }),
        cancel: vi.fn().mockResolvedValue(undefined),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 206,
        headers: new Headers(),
        body: { getReader: () => reader },
      });

      const { fileTypeFromBuffer } = vi.mocked(await import('file-type'));
      fileTypeFromBuffer.mockResolvedValue(null); // Force manual signature path

      const result = await validateRadioStream(mockClient, {
        url: 'https://misbehaving.example.com/stream',
      });

      // Reader was canceled after first oversized chunk
      expect(reader.cancel).toHaveBeenCalled();
      // Format detection still found the MP3 signature in the truncated buffer
      expect(result.audioFormat?.format).toBe('mp3');
      expect(result.validation.audioDataDetected).toBe(true);
    });

    it('should work with HEAD request failure but successful sampling', async () => {
      // HEAD request fails
      mockFetch.mockRejectedValueOnce(new Error('HEAD failed'));

      // But audio sampling succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'audio/mpeg',
        }),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
      });

      const result = await validateRadioStream(mockClient, {
        url: 'https://head-restricted.com/stream.mp3',
      });

      expect(result.validation.httpAccessible).toBe(true);
      expect(result.warnings).toContain('HEAD request failed: HEAD failed');
    });
  });
});