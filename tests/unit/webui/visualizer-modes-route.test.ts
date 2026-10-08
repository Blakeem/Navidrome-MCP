/**
 * GET /api/visualizer/modes reads the plugin folder, so these drive it against a throwaway folder.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleVisualizerModes } from '../../../src/webui/routes/visualizer-modes.js';

interface CapturedRes {
  res: ServerResponse;
  status: () => number | undefined;
  body: () => unknown;
}

function fakeRes(): CapturedRes {
  let status: number | undefined;
  let body = '';
  const res = {
    writableEnded: false,
    writeHead(code: number): ServerResponse {
      status = code;
      return res;
    },
    end(chunk?: string): void {
      body = chunk ?? '';
    },
  } as unknown as ServerResponse;
  return { res, status: () => status, body: () => JSON.parse(body) };
}

describe('handleVisualizerModes', () => {
  let publicDir = '';

  beforeEach(() => {
    publicDir = mkdtempSync(join(tmpdir(), 'viz-modes-'));
  });

  afterEach(() => {
    rmSync(publicDir, { recursive: true, force: true });
  });

  it('lists each mode file by id, sorted, and leaves out the template and other files', async () => {
    mkdirSync(join(publicDir, 'visualizers'));
    for (const name of ['warp.js', 'bars.js', '_template.js', 'notes.md', 'Bad Name.js', 'neon-grid.js']) {
      writeFileSync(join(publicDir, 'visualizers', name), '');
    }
    const cap = fakeRes();
    await handleVisualizerModes(cap.res, publicDir);

    expect(cap.status()).toBe(200);
    expect(cap.body()).toEqual({ modes: ['bars', 'neon-grid', 'warp'] });
  });

  it('answers 500 when the folder is missing', async () => {
    const cap = fakeRes();
    await handleVisualizerModes(cap.res, publicDir);

    expect(cap.status()).toBe(500);
  });

  it('lists the modes the web remote ships', async () => {
    const cap = fakeRes();
    await handleVisualizerModes(cap.res);

    expect(cap.body()).toEqual({ modes: expect.arrayContaining(['bars', 'ribbon', 'ring']) as unknown });
  });
});
