// The MCP transport needs a cap above the 16 KB control-route default, so the cap is a parameter.
// The CSP names every directive instead of inheriting default-src, so dropping one fails here.

import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, setSecurityHeaders, writeTooManyRequests } from '../../../src/webui/http-helpers.js';

function fakeReq(chunks: Buffer[]): IncomingMessage {
  const emitter = new EventEmitter() as IncomingMessage;
  emitter.destroy = (): IncomingMessage => {
    emitter.emit('error', new Error('destroyed'));
    return emitter;
  };
  queueMicrotask(() => {
    for (const c of chunks) emitter.emit('data', c);
    emitter.emit('end');
  });
  return emitter;
}

const DEFAULT_CAP = 16 * 1024;

describe('readJsonBody size cap', () => {
  it('rejects a body over the default 16 KB cap', async () => {
    const big = Buffer.from(JSON.stringify({ pad: 'x'.repeat(DEFAULT_CAP) }));
    await expect(readJsonBody(fakeReq([big]))).rejects.toThrow();
  });

  it('accepts a >16 KB body when given a larger explicit cap', async () => {
    const payload = { pad: 'x'.repeat(64 * 1024) };
    const body = Buffer.from(JSON.stringify(payload));
    expect(body.byteLength).toBeGreaterThan(DEFAULT_CAP);
    await expect(readJsonBody(fakeReq([body]), 4 * 1024 * 1024)).resolves.toEqual(payload);
  });

  it('still rejects a body that exceeds the larger cap', async () => {
    const body = Buffer.from('x'.repeat(2 * 1024));
    await expect(readJsonBody(fakeReq([body]), 1024)).rejects.toThrow();
  });
});

function securityHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const res = {
    setHeader(name: string, value: string): ServerResponse {
      headers[name] = value;
      return res;
    },
  } as unknown as ServerResponse;
  setSecurityHeaders(res);
  return headers;
}

describe('setSecurityHeaders', () => {
  it.each([
    ['X-Content-Type-Options', 'nosniff'],
    ['Referrer-Policy', 'no-referrer'],
    ['X-Frame-Options', 'DENY'],
    ['Cross-Origin-Opener-Policy', 'same-origin'],
    ['Cross-Origin-Resource-Policy', 'same-origin'],
    ['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'],
  ])('sets %s to %s', (name, value) => {
    expect(securityHeaders()[name]).toBe(value);
  });

  it.each([
    ["default-src 'self'"],
    ["script-src 'self'"],
    ["style-src 'self'"],
    ["img-src 'self' data:"],
    ['media-src data:'],
    ["connect-src 'self'"],
    ["frame-ancestors 'none'"],
    ["object-src 'none'"],
    ["base-uri 'none'"],
    ["form-action 'self'"],
  ])('names the %s CSP directive', (directive) => {
    const policy = securityHeaders()['Content-Security-Policy'] ?? '';
    expect(policy.split('; ')).toContain(directive);
  });
});

describe('writeTooManyRequests', () => {
  it('answers 429 with Retry-After rounded up to whole seconds and names the refused attempts', () => {
    const headers: Record<string, string> = {};
    let status = 0;
    let body = '';
    const res = {
      setHeader: (name: string, value: string): void => { headers[name] = value; },
      writeHead: (code: number): void => { status = code; },
      end: (chunk: string): void => { body = chunk; },
    } as unknown as ServerResponse;

    writeTooManyRequests(res, 4001, 'searches');

    expect(status).toBe(429);
    expect(headers['Retry-After']).toBe('5');
    expect(JSON.parse(body)).toEqual({ error: 'Too many searches. Try again in 5 seconds.' });
  });
});
