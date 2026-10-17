// A refactor of the resolveStaticPath traversal checks could reopen directory traversal unnoticed.
// The CSP names every directive instead of inheriting default-src, so dropping one fails here.

import { describe, expect, it } from 'vitest';
import type { ServerResponse } from 'node:http';
import { handleStatic } from '../../../src/webui/routes/static-files.js';

interface CapturedRes {
  res: ServerResponse;
  status: () => number | undefined;
  headers: () => Record<string, string>;
}

function fakeRes(): CapturedRes {
  let status: number | undefined;
  let headers: Record<string, string> = {};
  const res = {
    writableEnded: false,
    writeHead(code: number, sent?: Record<string, string>): ServerResponse {
      status = code;
      headers = sent ?? {};
      return res;
    },
    end(): void {
      // These tests read only the status and headers.
    },
  } as unknown as ServerResponse;
  return { res, status: () => status, headers: () => headers };
}

describe('handleStatic path-traversal guard', () => {
  it.each([
    '../../etc/passwd',
    '/../../etc/passwd',
    '/../secret',
    '/assets/../../secret',
  ])('rejects traversal path %s with 400', async (pathname) => {
    const cap = fakeRes();
    await handleStatic(cap.res, pathname);
    expect(cap.status()).toBe(400);
  });

  it.each([
    '/.env',
    '/.git/config',
    '/assets/.secret',
  ])('rejects dotfile path %s with 400', async (pathname) => {
    const cap = fakeRes();
    await handleStatic(cap.res, pathname);
    expect(cap.status()).toBe(400);
  });

  it('serves 200 for the bundled index.html', async () => {
    const cap = fakeRes();
    await handleStatic(cap.res, '/index.html');
    expect(cap.status()).toBe(200);
  });

  it('maps a bare / to index.html (200)', async () => {
    const cap = fakeRes();
    await handleStatic(cap.res, '/');
    expect(cap.status()).toBe(200);
  });

  it('returns 404 for a legitimate but missing path', async () => {
    const cap = fakeRes();
    await handleStatic(cap.res, '/does-not-exist.js');
    expect(cap.status()).toBe(404);
  });
});

describe('handleStatic Content-Security-Policy', () => {
  it.each([
    ["default-src 'self'"],
    ["script-src 'self'"],
    ["style-src 'self'"],
    ["img-src 'self' data:"],
    ['media-src data:'],
    ["connect-src 'self'"],
    ["frame-ancestors 'none'"],
    ["object-src 'none'"],
  ])('names the %s directive', async (directive) => {
    const cap = fakeRes();
    await handleStatic(cap.res, '/index.html');
    const policy = cap.headers()['Content-Security-Policy'] ?? '';
    expect(policy.split('; ')).toContain(directive);
  });

  it('serves the policy on every asset, not just the document', async () => {
    const cap = fakeRes();
    await handleStatic(cap.res, '/styles.css');
    expect(cap.status()).toBe(200);
    expect(cap.headers()['Content-Security-Policy']).toBeDefined();
  });
});
