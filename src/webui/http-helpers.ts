/**
 * Navidrome MCP Server - Web UI HTTP Helpers
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { TLSSocket } from 'node:tls';
import type { z } from 'zod';

// A bounded body makes a misbehaving client fail fast instead of making the server buffer it all.
const DEFAULT_MAX_BODY_BYTES = 16 * 1024;
export const SSE_END_FLUSH_GRACE_MS = 2_000;

/**
 * Every directive is named, so none silently inherits `default-src`. `data:` serves the inline SVG
 * favicon in `img-src` and the wake-lock fallback video in `media-src`.
 */
const CONTENT_SECURITY_POLICY: string = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  'media-src data:',
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};

/** Set before routing, since `writeHead` merges these into every response a handler writes. */
export function setSecurityHeaders(res: ServerResponse): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
}

// `none` is a request the user started, such as typing the URL.
const ALLOWED_FETCH_SITES: ReadonlySet<string> = new Set(['same-origin', 'none']);

// The web remote may serve HTTPS, so the listener's own scheme comes from the socket.
function isSameOrigin(origin: string, req: IncomingMessage): boolean {
  const scheme = req.socket instanceof TLSSocket ? 'https' : 'http';
  try {
    return new URL(origin).origin === new URL(`${scheme}://${req.headers.host ?? ''}`).origin;
  } catch {
    return false;
  }
}

/**
 * A browser labels a cross-site POST with `Origin` or `Sec-Fetch-Site`. A client that sends neither
 * is not a browser, so no page can make it act with the user's access. An opaque origin sends
 * `Origin: null`, which fails the URL parse.
 */
export function isCrossOriginPost(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  const fetchSite = req.headers['sec-fetch-site'];
  if (origin !== undefined && !isSameOrigin(origin, req)) return true;
  if (fetchSite === undefined) return false;
  return typeof fetchSite !== 'string' || !ALLOWED_FETCH_SITES.has(fetchSite.trim().toLowerCase());
}

export function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload).toString(),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

export function writeError(res: ServerResponse, status: number, message: string): void {
  writeJson(res, status, { error: message });
}

/** The target can depend on the session, so no browser or proxy may reuse the answer. */
export function writeRedirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', 'Content-Length': '0' });
  res.end();
}

/** `refused` names what was refused, such as "login attempts" or "searches", in the message the page shows. */
export function writeTooManyRequests(res: ServerResponse, waitMs: number, refused: string): void {
  const retryAfterSeconds = Math.ceil(waitMs / 1000);
  res.setHeader('Retry-After', String(retryAfterSeconds));
  writeError(res, 429, `Too many ${refused}. Try again in ${String(retryAfterSeconds)} seconds.`);
}

/** The retry directive goes first, so the browser learns it even if the stream drops at once. */
export function openSseStream(res: ServerResponse, retryMs: number): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // nginx buffers a proxied response unless this header says not to.
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: ${retryMs}\n\n`);
}

/**
 * Ends the stream with a last event instead of destroying it, so the frames queued before the event
 * still flush. A peer that never reads them is destroyed after `SSE_END_FLUSH_GRACE_MS`.
 */
export function endSseStream(res: ServerResponse, event: string, data: unknown): void {
  // A second end on an ended stream would emit an unhandled write-after-end error.
  if (res.destroyed || res.writableEnded) return;
  res.end(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const reaper = setTimeout(() => { res.destroy(); }, SSE_END_FLUSH_GRACE_MS);
  reaper.unref();
  res.once('close', () => { clearTimeout(reaper); });
}

export function isJsonContentType(contentType: string | undefined): boolean {
  const baseType = contentType?.split(';')[0]?.trim().toLowerCase();
  return baseType === 'application/json';
}

export async function runAction(res: ServerResponse, action: () => Promise<unknown>): Promise<void> {
  try {
    const result = await action();
    writeJson(res, 200, result);
  } catch (err) {
    writeError(res, 500, err instanceof Error ? err.message : 'unknown error');
  }
}

/** An empty body resolves to null, so the caller can tell a missing body from `{}`. */
export async function readJsonBody(
  req: IncomingMessage,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      received += chunk.length;
      if (received > maxBytes) {
        aborted = true;
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      if (chunks.length === 0) { resolve(null); return; }
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (raw === '') { resolve(null); return; }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    req.on('error', (err) => {
      if (!aborted) reject(err);
    });
  });
}

/**
 * Invalid input answers 400 here, because runAction maps every thrown error to 500, the impls' own
 * ZodErrors included. Resolves to null once the 400 response is written.
 */
export async function readValidBody<T>(req: IncomingMessage, res: ServerResponse, schema: z.ZodType<T>): Promise<T | null> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    writeError(res, 400, err instanceof Error ? err.message : 'invalid JSON body');
    return null;
  }

  const validation = schema.safeParse(body);
  if (!validation.success) {
    const message = validation.error.issues.map((issue) => issue.message).join('; ');
    writeError(res, 400, message !== '' ? message : 'invalid request body');
    return null;
  }
  return validation.data;
}
