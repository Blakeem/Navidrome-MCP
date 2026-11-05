/**
 * Navidrome MCP Server - Radio Stream Validation Tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// hostResolvesToPrivateIp resolves redirect targets through node:dns/promises.
const mockDnsLookup = vi.fn();
vi.mock('node:dns/promises', () => ({
  lookup: (...args: unknown[]) => mockDnsLookup(...args),
}));

// Only safeFetch is mocked, so the real scheme and redirect-target checks use the mocked DNS.
const mockFetch = vi.fn();
vi.mock('../../../src/utils/network-safety.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/utils/network-safety.js')>();
  return { ...actual, safeFetch: (...args: unknown[]) => mockFetch(...args) };
});

import { validateRadioStream } from '../../../src/tools/radio-validation.js';
import { classifyStream, type StreamProbe } from '../../../src/tools/radio-validation/validation-core.js';
import { detectAudioFormat, extractStreamingHeaders } from '../../../src/tools/radio-validation/stream-detector.js';
// The mock factory spreads the real module, so the mocked rejections below use the production text.
import { NON_STANDARD_HTTP_RESPONSE, PRIVATE_ADDRESS_REFUSAL } from '../../../src/utils/network-safety.js';

vi.mock('file-type', () => ({
  fileTypeFromBuffer: vi.fn(),
}));

describe('Radio Stream Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Input Validation', () => {
    it('should reject invalid URL', async () => {
      await expect(validateRadioStream({
        url: 'not-a-url',
      })).rejects.toThrow(/Tool 'validate_radio_stream' failed: Invalid arguments\. url: URL must be a valid URL/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should reject mms:// with a message pointing to the Navidrome web UI', async () => {
      await expect(validateRadioStream({
        url: 'mms://example.com/stream',
      })).rejects.toThrow(/Tool 'validate_radio_stream' failed: Invalid arguments\. url: URL must use http:\/\/ or https:\/\/[\s\S]*Navidrome web UI instead\./);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should reject rtsp:// before any fetch is attempted', async () => {
      await expect(validateRadioStream({
        url: 'rtsp://example.com/live',
      })).rejects.toThrow(/Tool 'validate_radio_stream' failed: Invalid arguments\. url: URL must use http:\/\/ or https:\/\//);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should reject file:// URLs', async () => {
      await expect(validateRadioStream({
        url: 'file:///etc/passwd',
      })).rejects.toThrow(/Tool 'validate_radio_stream' failed: Invalid arguments\. url: /);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should reject timeout too low', async () => {
      await expect(validateRadioStream({
        url: 'https://example.com/stream.mp3',
        timeout: 500,
      })).rejects.toThrow(/Tool 'validate_radio_stream' failed: Invalid arguments\. timeout: Too small: expected number to be >=1000/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should reject timeout too high', async () => {
      await expect(validateRadioStream({
        url: 'https://example.com/stream.mp3',
        timeout: 50000,
      })).rejects.toThrow(/Tool 'validate_radio_stream' failed: Invalid arguments\. timeout: Too big: expected number to be <=30000/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should name the rejected parameter, not [object Object]', async () => {
      const error: unknown = await validateRadioStream({
        url: 'mms://example.com/stream',
        timeout: 5000,
      }).catch((rejection: unknown) => rejection);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/Invalid arguments\. url: /);
      expect((error as Error).message).not.toContain('object Object');
    });

    it('should reject args that are not an object', async () => {
      await expect(validateRadioStream('not-an-object'))
        .rejects.toThrow(/Tool 'validate_radio_stream' failed: Invalid arguments\. arguments: Invalid input: expected object, received string/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should accept valid parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: 'https://example.com/stream.mp3',
        headers: new Headers({
          'content-type': 'audio/mpeg',
          'icy-name': 'Test Station',
        }),
      });

      const result = await validateRadioStream({
        url: 'https://example.com/stream.mp3',
        timeout: 5000,
        followRedirects: false,
      });

      expect(result.url).toBe('https://example.com/stream.mp3');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
    });
  });

  describe('HTTP Validation', () => {
    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await validateRadioStream({
        url: 'https://offline-station.com/stream.mp3',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('error');
      expect(result.validation.httpAccessible).toBe(false);
    });

    it("surfaces the safeFetch refusal reason instead of undici's generic 'fetch failed'", async () => {
      // undici wraps the dispatcher refusal in a bare "fetch failed" TypeError, so the validator
      // must report the cause. A reworded refusal constant breaks the recommendation match here.
      mockFetch.mockRejectedValue(new TypeError('fetch failed', {
        cause: new Error(`Refusing connection to ${PRIVATE_ADDRESS_REFUSAL} (127.0.0.1)`),
      }));

      const result = await validateRadioStream({
        url: 'http://127.0.0.1:4533/api/admin',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('error');
      const allMessages = [...result.errors, ...result.warnings];
      expect(allMessages.some((m) => m.includes(`Refusing connection to ${PRIVATE_ADDRESS_REFUSAL} (127.0.0.1)`))).toBe(true);
      expect(allMessages.some((m) => m.includes('fetch failed'))).toBe(false);
      expect(result.recommendations.some((r) => r.includes('SSRF protection'))).toBe(true);
      expect(result.recommendations).not.toContain('Try again later or check your network connection');
    });

    it('should handle timeout errors', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValue(abortError);

      const result = await validateRadioStream({
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

      const result = await validateRadioStream({
        url: 'https://example.com/missing-stream.mp3',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('invalid');
      expect(result.httpStatus).toBe(404);
      expect(result.errors).toEqual(['HTTP 404']);
      expect(result.recommendations).toContain('Stream URL appears to be offline or moved');
    });

    it('reports a sample HTTP status after a failed HEAD as invalid, not as a transport error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('HEAD failed'));
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers(),
      });

      const result = await validateRadioStream({
        url: 'https://example.com/gone-stream.mp3',
      });

      expect(result.status).toBe('invalid');
      expect(result.errors).toEqual(['HTTP 404: Not Found']);
      expect(result.recommendations).toContain('Stream URL appears to be offline or moved');
    });

    it('reports a 403 error page as an HTTP error, not as non-audio content', async () => {
      const forbidden = {
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        headers: new Headers({ 'content-type': 'text/html' }),
      };
      mockFetch.mockResolvedValueOnce(forbidden);
      mockFetch.mockResolvedValueOnce(forbidden);

      const result = await validateRadioStream({
        url: 'https://example.com/geo-blocked',
      });

      expect(result.status).toBe('invalid');
      expect(result.errors).toEqual(['HTTP 403']);
      expect(result.recommendations).toContain('The stream may be geo-restricted or require authentication');
      expect(result.recommendations.some((r) => r.includes('website URL'))).toBe(false);
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

      const result = await validateRadioStream({
        url: 'https://example.com/stream.mp3',
      });

      expect(result.validation.hasAudioContentType).toBe(true);
      expect(result.contentType).toBe('audio/mpeg');
    });

    it('should detect non-audio content type', async () => {
      // A text/html HEAD is inconclusive, so a GET sample runs. The sample's content-type
      // wins once sampling runs, so the mock repeats text/html there.
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
        headers: new Headers({
          'content-type': 'text/html',
        }),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
      });

      const result = await validateRadioStream({
        url: 'https://example.com/webpage.html',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('invalid');
      expect(result.validation.hasAudioContentType).toBe(false);
      expect(result.errors).toContain('Non-audio content type: text/html');
      expect(result.recommendations).toContain('URL does not serve audio content');
    });

    it('validates an HLS playlist served as application/x-mpegURL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/x-mpegURL' }),
      });

      const result = await validateRadioStream({ url: 'https://hls.example.com/live.m3u8' });

      expect(result.success).toBe(true);
      expect(result.validation.hasAudioContentType).toBe(true);
    });

    it('marks a response the HTTP parser rejected as non-standard, not a network outage', async () => {
      const parserError = new Error('Response does not match the HTTP/1.1 protocol (Invalid header token)');
      parserError.name = 'HTTPParserError';
      mockFetch.mockRejectedValue(new TypeError('fetch failed', { cause: parserError }));

      const result = await validateRadioStream({ url: 'http://legacy-shoutcast.example.com:8400/' });

      expect(result.status).toBe('error');
      const allMessages = [...result.errors, ...result.warnings];
      expect(allMessages.some((m) => m.includes(NON_STANDARD_HTTP_RESPONSE))).toBe(true);
      expect(result.recommendations.some((r) => r.includes('legacy ICY or non-standard HTTP'))).toBe(true);
      expect(result.recommendations).not.toContain('Try again later or check your network connection');
    });

    it('names the failing parameter instead of always blaming the URL', async () => {
      const error: unknown = await validateRadioStream({ url: 'https://example.com/stream.mp3', timeout: 60000 })
        .catch((rejection: unknown) => rejection);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/Invalid arguments\. timeout: /);
      expect((error as Error).message).not.toMatch(/url: /);
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

      const result = await validateRadioStream({
        url: 'https://shoutcast.example.com/stream',
      });

      expect(result.validation.hasStreamingHeaders).toBe(true);
      expect(result.streamingHeaders['icy-name']).toBe('Test Radio Station');
      expect(result.streamingHeaders['icy-br']).toBe('128');
      expect(result.streamingHeaders['icy-genre']).toBe('Pop');
      expect(result.recommendations).toContain('Station: Test Radio Station');
      expect(result.recommendations).toContain('Bitrate: 128kbps');
    });

    it('treats ICY headers on a non-2xx HEAD response as a valid stream', async () => {
      // Icecast and Shoutcast mounts often reject HEAD with 400 and an HTML body but still send
      // the ICY headers, which prove a stream.
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: new Headers({
          'content-type': 'text/html; charset=utf-8',
          'icy-name': 'Classic Vinyl HD',
          'icy-br': '320',
          'icy-genre': 'Lounge',
        }),
      });

      const result = await validateRadioStream({
        url: 'https://icecast.example.com:8443/classic',
        timeout: 2000,
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('valid');
      expect(result.validation.hasStreamingHeaders).toBe(true);
      expect(result.validation.httpAccessible).toBe(false);
      expect(result.httpStatus).toBe(400);
      expect(result.errors).toEqual([]);
      // Conclusive ICY headers skip the audio-sampling GET.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('does not treat Shoutcast icy-notice banners on an error response as a stream', async () => {
      const unavailable = {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers({
          'icy-notice1': '<BR>This stream requires <a href="http://www.winamp.com">Winamp</a><BR>',
          'icy-notice2': 'The resource requested is currently unavailable<BR>',
        }),
      };
      mockFetch.mockResolvedValueOnce(unavailable);
      mockFetch.mockResolvedValueOnce(unavailable);

      const result = await validateRadioStream({ url: 'http://offline-shoutcast.example.com:8042/stream/7/' });

      expect(result.success).toBe(false);
      expect(result.validation.hasStreamingHeaders).toBe(false);
      expect(result.streamingHeaders).toEqual({});
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

      const result = await validateRadioStream({
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

      // A generic content-type leaves HEAD inconclusive, so the validator samples audio with a GET.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/octet-stream',
        }),
      });

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

      const result = await validateRadioStream({
        url: 'https://example.com/stream.mp3',
      });

      expect(result.validation.audioDataDetected).toBe(true);
      expect(result.audioFormat?.format).toBe('mp3');
      expect(result.audioFormat?.mime).toBe('audio/mpeg');
      expect(result.recommendations).toContain('Format: MP3');
    });

    it('should handle file-type detection failure', async () => {
      const { fileTypeFromBuffer } = vi.mocked(await import('file-type'));

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/octet-stream',
        }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 206,
        headers: new Headers(),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
      });

      fileTypeFromBuffer.mockResolvedValue(undefined);

      const result = await validateRadioStream({
        url: 'https://example.com/unknown-format.stream',
      });

      expect(result.validation.audioDataDetected).toBe(false);
      expect(result.audioFormat?.detected ?? false).toBe(false);
    });

    it('should detect MP3 signature manually via audio sampling', async () => {
      const { fileTypeFromBuffer } = vi.mocked(await import('file-type'));

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/octet-stream',
        }),
      });

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

      fileTypeFromBuffer.mockResolvedValue(undefined);

      const result = await validateRadioStream({
        url: 'https://example.com/stream.mp3',
      });

      expect(result.validation.audioDataDetected).toBe(true);
      expect(result.audioFormat?.format).toBe('mp3');
      expect(result.audioFormat?.mime).toBe('audio/mpeg');
    });

    it('validates an octet-stream stream by its audio data with no content-type error', async () => {
      const { fileTypeFromBuffer } = vi.mocked(await import('file-type'));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/octet-stream' }),
      });
      const mp3Data = new Uint8Array([0xFF, 0xFB, 0x90, 0x00]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 206,
        headers: new Headers({ 'content-type': 'application/octet-stream' }),
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
      fileTypeFromBuffer.mockResolvedValue(undefined);

      const result = await validateRadioStream({
        url: 'https://example.com/octet-stream',
      });

      expect(result.success).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe('Redirect Handling', () => {
    it('should follow a public 302 to a public final URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 302,
        statusText: 'Found',
        headers: new Headers({ 'location': 'https://final-destination.com/stream.mp3' }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'audio/mpeg' }),
      });
      mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);

      const result = await validateRadioStream({
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

      const result = await validateRadioStream({
        url: 'https://malicious.example.com/stream',
        followRedirects: true,
      });

      // The refused HEAD leaves the probe inconclusive, so sampleAudioData retries the same
      // redirect and is refused again.
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
      // The HEAD and the sampleAudioData GET both receive this 302.
      const redirectMock = {
        ok: false,
        status: 302,
        statusText: 'Found',
        headers: new Headers({ 'location': 'file:///etc/passwd' }),
      };
      mockFetch.mockResolvedValueOnce(redirectMock);
      mockFetch.mockResolvedValueOnce(redirectMock);

      const result = await validateRadioStream({
        url: 'https://shady.example.com/stream',
        followRedirects: true,
      });

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

      const result = await validateRadioStream({
        url: 'https://perfect-radio.com/stream.mp3',
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.status).toBe('valid');
      expect(result.validation.httpAccessible).toBe(true);
      expect(result.validation.hasAudioContentType).toBe(true);
      expect(result.validation.hasStreamingHeaders).toBe(true);
      // A skipped sample reads no stream bytes, so audioDataDetected stays false.
      expect(result.validation.audioDataDetected).toBe(false);
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
        return callCount === 1 ? 1000 : 1100;
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

      const result = await validateRadioStream({
        url: 'https://example.com/stream.mp3',
      });

      expect(result.testDurationMs).toBe(100);
      mockDateNow.mockRestore();
    });
  });

  describe('Smart Header-Based Validation', () => {
    it('should skip audio sampling for Shoutcast streams with full headers', async () => {
      // A GET sample can hang on a Shoutcast stream like this one, so conclusive headers skip it.
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

      const result = await validateRadioStream({
        url: 'http://188.40.97.185:8179/stream',
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.status).toBe('valid');
      expect(result.validation.httpAccessible).toBe(true);
      expect(result.validation.hasAudioContentType).toBe(true);
      expect(result.validation.hasStreamingHeaders).toBe(true);
      expect(result.validation.audioDataDetected).toBe(false);
      expect(result.streamingHeaders['icy-br']).toBe('320');
      expect(result.streamingHeaders['icy-genre']).toBe('Synthwave');
      expect(result.audioFormat).toBeUndefined();
      expect(result.recommendations).toContain('Stream validated successfully');
    });

    it('should skip audio sampling when only content-type indicates audio', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'audio/mpeg',
        }),
      });

      const result = await validateRadioStream({
        url: 'https://simple-audio-stream.com/stream.mp3',
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.validation.hasAudioContentType).toBe(true);
      expect(result.validation.hasStreamingHeaders).toBe(false);
      expect(result.validation.audioDataDetected).toBe(false);
    });

    it('should fall back to audio sampling when headers are inconclusive', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/octet-stream',
        }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 206,
        headers: new Headers(),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
      });

      const result = await validateRadioStream({
        url: 'https://mystery-stream.com/audio',
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.validation.hasAudioContentType).toBe(false);
      expect(result.validation.hasStreamingHeaders).toBe(false);
    });

    it('prefers the GET sample response over an inconclusive HEAD when sampling ran', async () => {
      // The merge must not fall back to the HEAD response, which is also present, and drop the
      // sample's headers.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/octet-stream',
        }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'audio/mpeg',
          'icy-name': 'Sampled Station',
          'icy-br': '128',
        }),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
      });

      const result = await validateRadioStream({
        url: 'https://cdn-generic.example.com/stream',
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.contentType).toBe('audio/mpeg');
      expect(result.streamingHeaders['icy-name']).toBe('Sampled Station');
      expect(result.validation.hasStreamingHeaders).toBe(true);
      expect(result.success).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty audio data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/octet-stream',
        }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 206,
        headers: new Headers(),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });

      const result = await validateRadioStream({
        url: 'https://example.com/empty-stream.mp3',
      });

      expect(result.validation.audioDataDetected).toBe(false);
      expect(result.warnings).toContain('Could not sample audio data from stream');
    });

    it('should slice oversize chunks to the 8KB cap', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/octet-stream' }),
      });

      // A server that ignores Range can send one oversized chunk, which the validator must not
      // hold in memory.
      const giantChunk = new Uint8Array(100 * 1024);
      giantChunk[0] = 0xFF; // MP3 frame sync bytes
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
      fileTypeFromBuffer.mockResolvedValue(undefined); // forces the manual signature check

      const result = await validateRadioStream({
        url: 'https://misbehaving.example.com/stream',
      });

      expect(reader.cancel).toHaveBeenCalled();
      expect(result.audioFormat?.format).toBe('mp3');
      expect(result.validation.audioDataDetected).toBe(true);
    });

    it('keeps the chunks read before an abort and still detects the format', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/octet-stream' }),
      });

      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      const firstChunk = new Uint8Array([0xFF, 0xFB, 0x90, 0x00]);
      const reader = {
        read: vi.fn()
          .mockResolvedValueOnce({ value: firstChunk, done: false })
          .mockRejectedValueOnce(abortError),
        cancel: vi.fn().mockResolvedValue(undefined),
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        body: { getReader: () => reader },
      });

      const { fileTypeFromBuffer } = vi.mocked(await import('file-type'));
      fileTypeFromBuffer.mockResolvedValue(undefined);

      const result = await validateRadioStream({ url: 'https://slow-stream.example.com/live' });

      expect(result.audioFormat?.format).toBe('mp3');
      expect(result.validation.audioDataDetected).toBe(true);
      expect(result.success).toBe(true);
    });

    it('should work with HEAD request failure but successful sampling', async () => {
      mockFetch.mockRejectedValueOnce(new Error('HEAD failed'));

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'audio/mpeg',
        }),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
      });

      const result = await validateRadioStream({
        url: 'https://head-restricted.com/stream.mp3',
      });

      expect(result.validation.httpAccessible).toBe(true);
      expect(result.warnings).toContain('HEAD request failed: HEAD failed');
    });
  });
});

describe('classifyStream', () => {
  const emptyProbe: StreamProbe = {
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

  it('accepts a conclusive HEAD with an audio content type', () => {
    const headers = new Headers({ 'content-type': 'audio/mpeg' });
    const result = classifyStream('https://a.example/stream', { ...emptyProbe, headResponse: { headers, status: 200 }, headers }, null);

    expect(result).toMatchObject({ success: true, status: 'valid', httpStatus: 200, contentType: 'audio/mpeg' });
    expect(result.warnings).toEqual([]);
  });

  it('lets the sample status and headers win over an inconclusive HEAD', () => {
    const result = classifyStream('https://a.example/stream', {
      ...emptyProbe,
      headResponse: { headers: new Headers({ 'content-type': 'application/octet-stream' }), status: 405 },
      headers: new Headers({ 'content-type': 'audio/aac', 'icy-name': 'Sampled' }),
      sampledStatus: 200,
      sampled: true,
    }, { detected: true, format: 'aac', mime: 'audio/aac' });

    expect(result).toMatchObject({ success: true, httpStatus: 200, contentType: 'audio/aac' });
    expect(result.streamingHeaders).toEqual({ 'icy-name': 'Sampled' });
    expect(result.validation.audioDataDetected).toBe(true);
  });

  it('reports a transport failure as an error with the sampler reason', () => {
    const result = classifyStream('https://a.example/stream', {
      ...emptyProbe,
      headError: 'HEAD request failed: getaddrinfo ENOTFOUND a.example',
      sampleError: 'Audio sampling failed: getaddrinfo ENOTFOUND a.example',
      sampled: true,
      transportFailed: true,
    }, null);

    expect(result.status).toBe('error');
    expect(result.errors).toEqual(['Audio sampling failed: getaddrinfo ENOTFOUND a.example']);
    expect(result.warnings).toEqual(['HEAD request failed: getaddrinfo ENOTFOUND a.example']);
  });

  it('gives an invalid result a reason even when no probe step recorded one', () => {
    const headers = new Headers();
    const result = classifyStream('https://a.example/stream', {
      ...emptyProbe,
      headResponse: { headers, status: 200 },
      headers,
      sampledStatus: 200,
      sampled: true,
    }, null);

    expect(result.status).toBe('invalid');
    expect(result.errors).toEqual(['No audio content type, streaming headers, or audio data detected']);
    expect(result.warnings).toContain('Could not sample audio data from stream');
  });
});

describe('extractStreamingHeaders', () => {
  it('re-decodes UTF-8 ICY bytes that arrive as latin1', () => {
    const latin1View = Buffer.from('Café Радио', 'utf8').toString('latin1');

    expect(extractStreamingHeaders(new Headers({ 'icy-name': latin1View }))).toEqual({ 'icy-name': 'Café Радио' });
  });

  it('keeps a value a latin1 server sent as latin1', () => {
    expect(extractStreamingHeaders(new Headers({ 'icy-name': 'Café' }))).toEqual({ 'icy-name': 'Café' });
  });

  it('collapses a header the server sent twice with the same value', () => {
    const headers = new Headers();
    headers.append('icy-br', '320');
    headers.append('icy-br', '320');
    expect(extractStreamingHeaders(headers)).toEqual({ 'icy-br': '320' });
  });

  it('keeps a comma-separated value whose parts differ', () => {
    expect(extractStreamingHeaders(new Headers({ 'icy-genre': 'Synthwave, Retro' }))).toEqual({ 'icy-genre': 'Synthwave, Retro' });
  });
});

describe('detectAudioFormat on a sample that starts mid-stream', () => {
  // Filler bytes never form a sync pattern, so detection depends on the frames alone.
  function stream(lead: number, frame: readonly number[], frameLength: number, frames: number): Uint8Array {
    const bytes = new Uint8Array(lead + frameLength * frames).fill(0x11);
    for (let i = 0; i < frames; i++) bytes.set(frame, lead + i * frameLength);
    return bytes;
  }

  it('finds MP3 frames after a partial frame', async () => {
    // MPEG-1 Layer III at 128 kbps and 44.1 kHz without padding makes 417-byte frames.
    const result = await detectAudioFormat(stream(100, [0xff, 0xfb, 0x90, 0x00], 417, 4));
    expect(result).toEqual({ detected: true, format: 'mp3', mime: 'audio/mpeg' });
  });

  it('finds padded MP3 frames', async () => {
    // MPEG-1 Layer III at 128 kbps and 44.1 kHz with the padding bit set makes 418-byte frames.
    const result = await detectAudioFormat(stream(100, [0xff, 0xfb, 0x92, 0x00], 418, 4));
    expect(result).toEqual({ detected: true, format: 'mp3', mime: 'audio/mpeg' });
  });

  it('finds MPEG-2 Layer III frames, which use the half-size frame coefficient', async () => {
    // MPEG-2 Layer III at 64 kbps and 22.05 kHz makes 208-byte frames.
    const result = await detectAudioFormat(stream(100, [0xff, 0xf3, 0x80, 0x00], 208, 4));
    expect(result).toEqual({ detected: true, format: 'mp3', mime: 'audio/mpeg' });
  });

  it('finds MPEG-1 Layer II frames', async () => {
    // MPEG-1 Layer II at 192 kbps and 48 kHz makes 576-byte frames.
    const result = await detectAudioFormat(stream(100, [0xff, 0xfd, 0xa4, 0x00], 576, 4));
    expect(result).toEqual({ detected: true, format: 'mp2', mime: 'audio/mpeg' });
  });

  it('finds ADTS AAC frames after a partial frame', async () => {
    // 200-byte ADTS frames at 44.1 kHz.
    const result = await detectAudioFormat(stream(57, [0xff, 0xf1, 0x50, 0x80, 0x19, 0x1f, 0xfc], 200, 4));
    expect(result).toEqual({ detected: true, format: 'aac', mime: 'audio/aac' });
  });

  it('finds an Ogg page mid-sample', async () => {
    const bytes = new Uint8Array(400).fill(0x11);
    bytes.set([0x4f, 0x67, 0x67, 0x53, 0x00], 123);
    expect((await detectAudioFormat(bytes)).format).toBe('ogg');
  });

  it('rejects a lone sync pattern with no frame after it', async () => {
    const bytes = new Uint8Array(4096).fill(0x11);
    bytes.set([0xff, 0xfb, 0x90, 0x00], 300);
    expect(await detectAudioFormat(bytes)).toEqual({ detected: false });
  });
});
