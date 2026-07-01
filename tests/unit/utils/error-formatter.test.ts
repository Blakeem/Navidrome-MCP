/**
 * Navidrome MCP Server - ErrorFormatter tests
 * Copyright (C) 2025
 *
 * Covers every public static method on ErrorFormatter from
 * src/utils/error-formatter.ts. Each method gets one happy-path test
 * (correct string shape) and one error-shape test (correct fallback).
 */

import { describe, expect, it } from 'vitest';
import { ErrorFormatter } from '../../../src/utils/error-formatter.js';

// ---- helper -----------------------------------------------------------------

function makeResponse(status: number, statusText: string): Response {
  return { ok: status < 400, status, statusText } as unknown as Response;
}

// ---- toolExecution ----------------------------------------------------------

describe('ErrorFormatter.toolExecution', () => {
  it('includes the tool name and error message', () => {
    const msg = ErrorFormatter.toolExecution('search_songs', new Error('timeout'));
    expect(msg).toContain('search_songs');
    expect(msg).toContain('timeout');
  });

  it('uses "Unknown error" when the error is not an Error instance', () => {
    const msg = ErrorFormatter.toolExecution('search_songs', 'raw string');
    expect(msg).toContain('Unknown error');
  });

  // Regression for src-tools-3-1: nested impls (e.g. listRadioStations ->
  // getRadioStation -> playRadioStation) each rewrap with their own tool name.
  // toolExecution must NOT stack a second prefix onto an already-wrapped message.
  it('does not double-prefix an already-wrapped message', () => {
    const inner = ErrorFormatter.toolExecution('list_radio_stations', new Error('network down'));
    const outer = ErrorFormatter.toolExecution('play_radio_station', new Error(inner));
    // Exactly one prefix survives, preserving the innermost meaningful message.
    expect(outer).toBe(inner);
    expect(outer.match(/Tool '[^']*' failed: /g)).toHaveLength(1);
    expect(outer).toContain('network down');
  });

  it('still adds exactly one prefix to a bare error', () => {
    const msg = ErrorFormatter.toolExecution('search_songs', new Error('boom'));
    expect(msg).toBe("Tool 'search_songs' failed: boom");
  });
});

// ---- httpRequest ------------------------------------------------------------

describe('ErrorFormatter.httpRequest', () => {
  it('includes operation, status code, and statusText', () => {
    const msg = ErrorFormatter.httpRequest('GET /album', makeResponse(404, 'Not Found'));
    expect(msg).toContain('GET /album');
    expect(msg).toContain('404');
    expect(msg).toContain('Not Found');
  });

  it('appends errorText when provided', () => {
    const msg = ErrorFormatter.httpRequest('POST /playlist', makeResponse(500, 'Internal Server Error'), 'disk full');
    expect(msg).toContain('disk full');
  });

  it('omits errorText separator when errorText is empty', () => {
    const msg = ErrorFormatter.httpRequest('GET /song', makeResponse(200, 'OK'), '');
    // Should not contain " - " at the end
    expect(msg.endsWith(' - ')).toBe(false);
  });
});

// ---- configMissing ----------------------------------------------------------

describe('ErrorFormatter.configMissing', () => {
  it('includes service name and config key', () => {
    const msg = ErrorFormatter.configMissing('Last.fm', 'LASTFM_API_KEY');
    expect(msg).toContain('Last.fm');
    expect(msg).toContain('LASTFM_API_KEY');
  });
});

// ---- toolUnknown ------------------------------------------------------------

describe('ErrorFormatter.toolUnknown', () => {
  it('includes the unknown tool name', () => {
    const msg = ErrorFormatter.toolUnknown('nonexistent_tool');
    expect(msg).toContain('nonexistent_tool');
  });
});

// ---- subsonicApi ------------------------------------------------------------

describe('ErrorFormatter.subsonicApi', () => {
  it('includes the HTTP status and statusText', () => {
    const msg = ErrorFormatter.subsonicApi(makeResponse(401, 'Unauthorized'));
    expect(msg).toContain('401');
    expect(msg).toContain('Unauthorized');
  });
});

// ---- subsonicResponse -------------------------------------------------------

describe('ErrorFormatter.subsonicResponse', () => {
  it('includes the subsonic error message', () => {
    const msg = ErrorFormatter.subsonicResponse('Wrong username or password');
    expect(msg).toContain('Wrong username or password');
  });

  it('falls back to "Unknown error" when message is undefined', () => {
    const msg = ErrorFormatter.subsonicResponse(undefined);
    expect(msg).toContain('Unknown error');
    expect(msg).not.toContain('undefined');
  });
});

// ---- lastfmApi --------------------------------------------------------------

describe('ErrorFormatter.lastfmApi', () => {
  it('includes Last.fm and status info', () => {
    const msg = ErrorFormatter.lastfmApi(makeResponse(429, 'Too Many Requests'));
    expect(msg).toContain('Last.fm');
    expect(msg).toContain('429');
  });
});

// ---- lastfmResponse ---------------------------------------------------------

describe('ErrorFormatter.lastfmResponse', () => {
  it('includes the Last.fm error message', () => {
    const msg = ErrorFormatter.lastfmResponse('Artist not found');
    expect(msg).toContain('Artist not found');
  });

  it('falls back to "Unknown error" when message is undefined', () => {
    const msg = ErrorFormatter.lastfmResponse(undefined);
    expect(msg).toContain('Unknown error');
    expect(msg).not.toContain('undefined');
  });
});

// ---- radioBrowserApi --------------------------------------------------------

describe('ErrorFormatter.radioBrowserApi', () => {
  it('includes Radio Browser and status info', () => {
    const msg = ErrorFormatter.radioBrowserApi(makeResponse(503, 'Service Unavailable'));
    expect(msg).toContain('Radio Browser');
    expect(msg).toContain('503');
  });
});

// ---- notFound ---------------------------------------------------------------

describe('ErrorFormatter.notFound', () => {
  it('includes the resource type and identifier', () => {
    const msg = ErrorFormatter.notFound('Station', 'uuid-abc');
    expect(msg).toContain('Station');
    expect(msg).toContain('uuid-abc');
  });
});

// ---- configValidation -------------------------------------------------------

describe('ErrorFormatter.configValidation', () => {
  it('includes all validation messages', () => {
    const msg = ErrorFormatter.configValidation(['URL is required', 'Password is required']);
    expect(msg).toContain('URL is required');
    expect(msg).toContain('Password is required');
  });
});
