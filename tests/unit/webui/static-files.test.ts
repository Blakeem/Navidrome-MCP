// A refactor of the resolveStaticPath traversal checks could reopen directory traversal unnoticed.

import { describe, expect, it } from 'vitest';
import type { ServerResponse } from 'node:http';
import { handleStatic } from '../../../src/webui/routes/static-files.js';

interface CapturedRes {
  res: ServerResponse;
  status: () => number | undefined;
}

function fakeRes(): CapturedRes {
  let status: number | undefined;
  const res = {
    writableEnded: false,
    writeHead(code: number): ServerResponse {
      status = code;
      return res;
    },
    end(): void {
      // These tests read only the status.
    },
  } as unknown as ServerResponse;
  return { res, status: () => status };
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
