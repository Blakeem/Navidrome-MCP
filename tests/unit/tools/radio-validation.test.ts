/**
 * Navidrome MCP Server - Radio Stream Validation Tests
 * Copyright (C) 2025
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from 'vitest';
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
      expect(result.recommendations[0]).toBe('❌ Please provide a valid URL');
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
      expect(result.recommendations).toContain('🔍 Stream URL appears to be offline or moved');
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
      expect(result.recommendations).toContain('⚠️ Stream validation encountered an error');
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
      expect(result.recommendations).toContain('🎵 Station: Test Radio Station');
      expect(result.recommendations).toContain('📊 Bitrate: 128kbps');
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

    it('should detect MP3 format', async () => {
      const { fileTypeFromBuffer } = vi.mocked(await import('file-type'));
      
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
      expect(result.recommendations).toContain('🎧 Format: MP3');
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

    it('should detect MP3 signature manually', async () => {
      const { fileTypeFromBuffer } = vi.mocked(await import('file-type'));
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'audio/mpeg',
        }),
      });

      // Create buffer with MP3 signature
      const mp3Buffer = new ArrayBuffer(1024);
      const view = new Uint8Array(mp3Buffer);
      view[0] = 0xFF; // MP3 frame header
      view[1] = 0xFB;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 206,
        headers: new Headers(),
        arrayBuffer: () => Promise.resolve(mp3Buffer),
      });

      fileTypeFromBuffer.mockResolvedValue(null); // file-type fails

      const result = await validateRadioStream(mockClient, {
        url: 'https://example.com/stream.mp3',
      });

      expect(result.validation.audioDataDetected).toBe(true);
      expect(result.audioFormat?.format).toBe('mp3');
      expect(result.audioFormat?.mime).toBe('audio/mpeg');
    });
  });

  describe('Redirect Handling', () => {
    it('should follow redirects when enabled', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: 'https://final-destination.com/stream.mp3', // After redirect
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
        url: 'https://redirect.example.com/stream',
        followRedirects: true,
      });

      expect(result.finalUrl).toBe('https://final-destination.com/stream.mp3');
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

      const mp3Buffer = new ArrayBuffer(1024);
      const view = new Uint8Array(mp3Buffer);
      view[0] = 0xFF;
      view[1] = 0xFB;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 206,
        headers: new Headers(),
        arrayBuffer: () => Promise.resolve(mp3Buffer),
      });

      const result = await validateRadioStream(mockClient, {
        url: 'https://perfect-radio.com/stream.mp3',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('valid');
      expect(result.validation.httpAccessible).toBe(true);
      expect(result.validation.hasAudioContentType).toBe(true);
      expect(result.validation.hasStreamingHeaders).toBe(true);
      expect(result.validation.audioDataDetected).toBe(true);
      expect(result.recommendations).toContain('✅ Stream validated successfully');
      expect(result.recommendations).toContain('🎵 Station: Perfect FM');
      expect(result.recommendations).toContain('📊 Bitrate: 320kbps');
      expect(result.recommendations).toContain('✨ Ready to add as radio station');
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
      expect(result.validation.audioDataDetected).toBe(true);
      expect(result.streamingHeaders['icy-br']).toBe('320');
      expect(result.streamingHeaders['icy-genre']).toBe('Synthwave');
      expect(result.audioFormat?.format).toBe('mp3');
      expect(result.audioFormat?.mime).toBe('audio/mpeg');
      expect(result.recommendations).toContain('✅ Stream validated successfully');
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
      expect(result.validation.audioDataDetected).toBe(true); // Inferred from content-type
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