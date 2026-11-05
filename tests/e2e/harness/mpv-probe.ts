/**
 * Navidrome MCP Server - e2e mpv probe
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Reads and sets mpv properties on the instance's private pipe only. The instance spawns mpv on its
 * first playback request, so every call connects on demand.
 */

import { expect } from '@playwright/test';

import { MpvIpc } from '../../../src/services/playback/mpv-ipc.js';

// A connect fails at once when mpv is not running, so one attempt answers "not running".
const CONNECT_ATTEMPTS = 1;
const UNAVAILABLE = 'mpv command error: property unavailable';
const PLAYING_TIMEOUT_MS = 30_000;
const NULL_AUDIO_OUTPUT = 'null';

function songIdOf(filename: unknown): string | null {
  if (typeof filename !== 'string' || !URL.canParse(filename)) return null;
  return new URL(filename).searchParams.get('id');
}

export class MpvProbe {
  private ipc: MpvIpc | null = null;
  // The scrobble guard and the test read at once, so concurrent callers share one connect.
  private connecting: Promise<MpvIpc> | null = null;

  constructor(readonly ipcPath: string) {}

  private connected(): Promise<MpvIpc> {
    if (this.ipc?.isConnected() === true) return Promise.resolve(this.ipc);
    this.connecting ??= this.connect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async connect(): Promise<MpvIpc> {
    const ipc = new MpvIpc();
    await ipc.connect(this.ipcPath, CONNECT_ATTEMPTS, 0);
    this.ipc = ipc;
    return ipc;
  }

  async isRunning(): Promise<boolean> {
    try {
      await this.connected();
      return true;
    } catch {
      return false;
    }
  }

  /** Null when mpv reports the property unavailable, such as `time-pos` with nothing loaded. */
  async read(name: string): Promise<unknown> {
    const ipc = await this.connected();
    try {
      return await ipc.command('get_property', name);
    } catch (err) {
      if (err instanceof Error && err.message === UNAVAILABLE) return null;
      throw err;
    }
  }

  async readNumber(name: string): Promise<number | null> {
    const value = await this.read(name);
    return typeof value === 'number' ? value : null;
  }

  /**
   * The song id of each playlist entry, in queue order. Each stream URL carries the Subsonic login, so
   * only the id leaves this method, and an entry with no id reads as null.
   */
  async queueSongIds(): Promise<Array<string | null>> {
    const playlist = await this.read('playlist');
    if (!Array.isArray(playlist)) return [];
    return playlist.map((entry: { filename?: unknown }) => songIdOf(entry.filename));
  }

  async set(name: string, value: string | number | boolean): Promise<void> {
    const ipc = await this.connected();
    await ipc.command('set_property', name, value);
  }

  /** A no-op when mpv is not running, so a test end with no playback passes. */
  async pauseIfRunning(): Promise<void> {
    if (await this.isRunning()) await this.set('pause', true);
  }

  async quitIfRunning(): Promise<void> {
    if (!(await this.isRunning())) return;
    // mpv closes the pipe as it quits, which rejects the pending command.
    await this.ipc?.command('quit').catch(() => undefined);
    this.close();
  }

  /**
   * mpv falls back to the null output when no audio device opens (`--audio-fallback-to-null=yes`),
   * so a playing state alone does not prove audible output.
   */
  async waitUntilPlaying(): Promise<void> {
    await expect.poll(async () => ({
      pause: await this.read('pause'),
      idle: await this.read('idle-active'),
      audioOutput: await this.read('current-ao'),
    }), { message: 'mpv never reached unpaused, non-idle playback', timeout: PLAYING_TIMEOUT_MS })
      .toEqual({ pause: false, idle: false, audioOutput: expect.any(String) });
    expect(await this.read('current-ao'), 'mpv plays on the null audio output, so no audio device opened').not.toBe(NULL_AUDIO_OUTPUT);
    const start = await this.readNumber('time-pos') ?? 0;
    await expect.poll(() => this.readNumber('time-pos'), { message: 'mpv time-pos did not rise', timeout: PLAYING_TIMEOUT_MS })
      .toBeGreaterThan(start);
  }

  close(): void {
    this.ipc?.close();
    this.ipc = null;
  }
}
