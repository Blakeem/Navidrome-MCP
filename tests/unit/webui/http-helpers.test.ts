/**
 * Unit tests for readJsonBody's size cap — in particular that the cap is
 * parameterized, so the MCP transport can accept bodies larger than the web UI's
 * tiny 16 KB control-route default while still bounding them.
 */

import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { readJsonBody } from '../../../src/webui/http-helpers.js';

/** Minimal IncomingMessage stand-in: emits the given chunks, then `end`. */
function fakeReq(chunks: Buffer[]): IncomingMessage {
  const emitter = new EventEmitter() as IncomingMessage & { destroy: () => void };
  emitter.destroy = (): void => { emitter.emit('error', new Error('destroyed')); };
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
