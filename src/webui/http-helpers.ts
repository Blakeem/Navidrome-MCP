/**
 * Navidrome MCP Server - Web UI HTTP Helpers
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

import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Body-size cap for control-route JSON payloads. Our largest body is a seek
 * (`{seconds, mode}`) — well under a hundred bytes. Anything bigger is a
 * misconfigured client or a malicious one, and we'd rather fail fast than
 * buffer arbitrary input on a localhost-default server.
 */
const MAX_BODY_BYTES = 16 * 1024;

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

/**
 * Run a route action and map its result to an HTTP response with consistent
 * error-to-status handling. Errors from the engine or the reused Zod schemas
 * flow through as 500 with their message preserved. Shared by control and
 * playlist routes so every web action behaves identically.
 */
export async function runAction(res: ServerResponse, action: () => Promise<unknown>): Promise<void> {
  try {
    const result = await action();
    writeJson(res, 200, result);
  } catch (err) {
    writeError(res, 500, err instanceof Error ? err.message : 'unknown error');
  }
}

/**
 * Read a JSON request body with a hard size cap. Empty bodies resolve to
 * `null` so caller can distinguish "no body provided" from "{}" — useful for
 * routes that accept no input. Beyond `MAX_BODY_BYTES`, the connection is
 * destroyed (no partial JSON parse) and the promise rejects.
 */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
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
