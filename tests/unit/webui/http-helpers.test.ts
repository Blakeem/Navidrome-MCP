// The MCP transport needs a cap above the 16 KB control-route default, so the cap is a parameter.

import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { readJsonBody } from '../../../src/webui/http-helpers.js';

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
