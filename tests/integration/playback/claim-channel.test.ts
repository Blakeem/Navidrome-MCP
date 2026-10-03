/**
 * Navidrome MCP Server - mpv claim channel integration test
 * Copyright (C) 2025
 *
 * The scrobble claim election relies on mpv delivering every script-message to
 * every IPC client, the sender included, in one order. mpv documents the delivery
 * but not the order, so this pins both on the installed mpv build. It sends only
 * messages and leaves the queue untouched.
 */

import { afterAll, beforeAll, expect } from 'vitest';

import { playbackEngine } from '../../../src/services/playback/playback-engine.js';
import { MpvIpc } from '../../../src/services/playback/mpv-ipc.js';
import { getDefaultIpcPath } from '../../../src/services/playback/mpv-process.js';
import { describePlayback, itPlayback, setupClientAndConfig, waitFor } from './helpers.js';

const TOPIC = 'navidrome-mcp-claim-order-test';
const ROUNDS = 50;

describePlayback('mpv claim channel (live)', () => {
  const clients: MpvIpc[] = [];

  beforeAll(async () => {
    await setupClientAndConfig();
    await playbackEngine.ensureRunning();
    for (let i = 0; i < 2; i++) {
      const ipc = new MpvIpc();
      await ipc.connect(getDefaultIpcPath());
      clients.push(ipc);
    }
  });

  afterAll(() => {
    for (const ipc of clients) ipc.close();
  });

  itPlayback('delivers concurrent claims to every client, the sender included, in one order', async () => {
    const seen: string[][] = clients.map(() => []);
    clients.forEach((ipc, slot) => {
      ipc.onEvent((evt) => {
        const args = evt['args'];
        if (evt.event !== 'client-message' || !Array.isArray(args) || args[0] !== TOPIC) return;
        seen[slot]?.push(`${String(args[1])}:${String(args[2])}`);
      });
    });

    const sends: Promise<unknown>[] = [];
    for (let round = 0; round < ROUNDS; round++) {
      clients.forEach((ipc, slot) => {
        sends.push(ipc.command('script-message', TOPIC, `key-${round % 10}`, `sender-${slot}`));
      });
    }
    await Promise.all(sends);

    const expected = ROUNDS * clients.length;
    await waitFor(() => seen.every((s) => s.length === expected));
    expect(seen[1]).toEqual(seen[0]);
    expect(seen[0]?.filter((m) => m.endsWith(':sender-0'))).toHaveLength(ROUNDS);
    expect(seen[0]?.filter((m) => m.endsWith(':sender-1'))).toHaveLength(ROUNDS);
  });
});
