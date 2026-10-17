/**
 * Navidrome MCP Server - Web UI HTTP Helpers
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { z } from 'zod';

// A bounded body makes a misbehaving client fail fast instead of making the server buffer it all.
const DEFAULT_MAX_BODY_BYTES = 16 * 1024;

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
