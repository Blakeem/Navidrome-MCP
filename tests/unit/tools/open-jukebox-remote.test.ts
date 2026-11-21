/**
 * Navidrome MCP Server - open_jukebox_remote tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// The spawn, the owner probe and the browser launch are stubs, so no test starts a player or opens a tab.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { WebOwnerProbe } from '../../../src/web/acquire.js';
import { makeTestConfig } from '../../helpers/test-config.js';

const { ensureWebForPlaybackMock, probeWebOwnerMock, openBrowserMock, readSavedWebuiSettingsMock, listLanInterfacesMock } = vi.hoisted(() => ({
  ensureWebForPlaybackMock: vi.fn(),
  probeWebOwnerMock: vi.fn(),
  openBrowserMock: vi.fn(),
  readSavedWebuiSettingsMock: vi.fn(),
  listLanInterfacesMock: vi.fn(),
}));

vi.mock('../../../src/web/spawn.js', () => ({ ensureWebForPlayback: ensureWebForPlaybackMock }));
vi.mock('../../../src/web/acquire.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/web/acquire.js')>();
  return { ...actual, probeWebOwner: probeWebOwnerMock };
});
vi.mock('../../../src/utils/open-browser.js', () => ({ openBrowser: openBrowserMock }));
vi.mock('../../../src/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/config.js')>();
  return { ...actual, readSavedWebuiSettings: readSavedWebuiSettingsMock };
});
vi.mock('../../../src/webui/network.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/webui/network.js')>();
  return { ...actual, listLanInterfaces: listLanInterfacesMock };
});

const { openJukeboxRemote } = await import('../../../src/tools/jukebox-remote.js');
const { JUKEBOX_REMOTE_START_TIMEOUT_MS } = await import('../../../src/constants/timeouts.js');
const { jukeboxLogPath } = await import('../../../src/web/log-path.js');
const { createLaunchKey, writeLaunchKey } = await import('../../../src/web/launch-key.js');

const PORT = 8808;
const ADMIN_URL = `http://127.0.0.1:${String(PORT)}/admin`;

function probe(outcome: WebOwnerProbe['outcome'], secure = false): WebOwnerProbe {
  return { outcome, port: PORT, secure };
}

function configWith(webui: Record<string, unknown> = {}): ReturnType<typeof makeTestConfig> {
  const base = makeTestConfig({ features: { playback: true } });
  return { ...base, webui: { ...base.webui, port: PORT, host: '127.0.0.1', autoOpenBrowser: false, ...webui } };
}

// A private folder, so no launch key file another test or a running player wrote reaches these tests.
let dir: string;
let savedPath: string | undefined;

beforeEach(() => {
  savedPath = process.env['NAVIDROME_CONFIG_PATH'];
  dir = mkdtempSync(join(tmpdir(), 'nd-open-remote-'));
  process.env['NAVIDROME_CONFIG_PATH'] = join(dir, 'settings.json');
  readSavedWebuiSettingsMock.mockReturnValue(null);
  listLanInterfacesMock.mockReturnValue([{ iface: 'eth0', address: '192.168.1.20', url: `http://192.168.1.20:${String(PORT)}` }]);
});

afterEach(() => {
  if (savedPath === undefined) delete process.env['NAVIDROME_CONFIG_PATH'];
  else process.env['NAVIDROME_CONFIG_PATH'] = savedPath;
  rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('openJukeboxRemote', () => {
  it('opens and returns the admin address of a running player', async () => {
    const config = configWith();
    ensureWebForPlaybackMock.mockResolvedValue('running');
    probeWebOwnerMock.mockResolvedValue(probe('ours'));

    const result = await openJukeboxRemote(config);

    expect(ensureWebForPlaybackMock).toHaveBeenCalledWith(config);
    expect(result).toEqual({ url: ADMIN_URL, lanUrls: [] });
    expect(openBrowserMock).toHaveBeenCalledExactlyOnceWith(ADMIN_URL);
  });

  it('opens the address with the launch key the player wrote, and returns only the plain address to the AI', async () => {
    const key = createLaunchKey();
    writeLaunchKey(PORT, key);
    ensureWebForPlaybackMock.mockResolvedValue('running');
    probeWebOwnerMock.mockResolvedValue({ ...probe('ours'), lan: true });

    const result = await openJukeboxRemote(configWith());

    expect(openBrowserMock).toHaveBeenCalledExactlyOnceWith(`${ADMIN_URL}?launch=${key}`);
    expect(result).toEqual({ url: ADMIN_URL, lanUrls: [`http://192.168.1.20:${String(PORT)}/admin`] });
    expect(JSON.stringify(result)).not.toContain(key);
  });

  it('waits for a spawned player to answer before it opens the address', async () => {
    vi.useFakeTimers();
    ensureWebForPlaybackMock.mockResolvedValue('spawned');
    probeWebOwnerMock
      .mockResolvedValueOnce(probe('refused'))
      .mockResolvedValueOnce(probe('foreign'))
      .mockResolvedValue(probe('ours'));

    const pending = openJukeboxRemote(configWith());
    await vi.advanceTimersByTimeAsync(0);
    expect(openBrowserMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);

    await expect(pending).resolves.toEqual({ url: ADMIN_URL, lanUrls: [] });
    expect(probeWebOwnerMock).toHaveBeenCalledTimes(3);
    expect(openBrowserMock).toHaveBeenCalledExactlyOnceWith(ADMIN_URL);
  });

  it('returns the conflict text and opens nothing when another program holds the port', async () => {
    ensureWebForPlaybackMock.mockResolvedValue('unavailable');
    probeWebOwnerMock.mockResolvedValue(probe('foreign'));

    await expect(openJukeboxRemote(configWith())).rejects.toThrow(
      `Tool 'open_jukebox_remote' failed: Web UI port ${String(PORT)} is in use by another application. Change webui.port in settings, or stop the conflicting process.`,
    );
    expect(probeWebOwnerMock).toHaveBeenCalledTimes(1);
    expect(openBrowserMock).not.toHaveBeenCalled();
  });

  it('names the log when a spawned player never answers', async () => {
    vi.useFakeTimers();
    ensureWebForPlaybackMock.mockResolvedValue('spawned');
    probeWebOwnerMock.mockResolvedValue(probe('refused'));

    const pending = openJukeboxRemote(configWith());
    const assertion = expect(pending).rejects.toThrow(`The Jukebox Remote did not start. Its log is at ${jukeboxLogPath()}.`);
    await vi.advanceTimersByTimeAsync(JUKEBOX_REMOTE_START_TIMEOUT_MS + 1000);

    await assertion;
    expect(openBrowserMock).not.toHaveBeenCalled();
  });

  it('adds the LAN admin addresses when the running player reports a LAN bind that settings.json no longer holds', async () => {
    ensureWebForPlaybackMock.mockResolvedValue('running');
    probeWebOwnerMock.mockResolvedValue({ ...probe('ours'), lan: true });

    const result = await openJukeboxRemote(configWith());

    expect(result.lanUrls).toEqual([`http://192.168.1.20:${String(PORT)}/admin`]);
  });

  it('returns no LAN address when the running player reports a loopback bind that settings.json exposes', async () => {
    const config = configWith({ host: '0.0.0.0' });
    ensureWebForPlaybackMock.mockResolvedValue('running');
    probeWebOwnerMock.mockResolvedValue({ ...probe('ours'), lan: false });
    readSavedWebuiSettingsMock.mockReturnValue(config.webui);

    const result = await openJukeboxRemote(config);

    expect(result.lanUrls).toEqual([]);
  });

  it('reads the bind host from the startup config when an older player sends no LAN field', async () => {
    ensureWebForPlaybackMock.mockResolvedValue('running');
    probeWebOwnerMock.mockResolvedValue(probe('ours'));

    const result = await openJukeboxRemote(configWith({ host: '0.0.0.0' }));

    expect(result.lanUrls).toEqual([`http://192.168.1.20:${String(PORT)}/admin`]);
  });

  it('reads the bind host from settings.json when an older player on its port sends no LAN field', async () => {
    const config = configWith();
    ensureWebForPlaybackMock.mockResolvedValue('running');
    probeWebOwnerMock.mockResolvedValue(probe('ours'));
    readSavedWebuiSettingsMock.mockReturnValue({ ...config.webui, host: '0.0.0.0' });

    const result = await openJukeboxRemote(config);

    expect(result.lanUrls).toHaveLength(1);
  });

  it('leaves the tab to a spawned player that opens its own', async () => {
    ensureWebForPlaybackMock.mockResolvedValue('spawned');
    probeWebOwnerMock.mockResolvedValue(probe('ours'));

    const result = await openJukeboxRemote(configWith({ autoOpenBrowser: true }));

    expect(result.url).toBe(ADMIN_URL);
    expect(openBrowserMock).not.toHaveBeenCalled();
  });

  it('adds the certificate note for an HTTPS player', async () => {
    ensureWebForPlaybackMock.mockResolvedValue('running');
    probeWebOwnerMock.mockResolvedValue(probe('ours', true));

    const result = await openJukeboxRemote(configWith());

    expect(result.url).toBe(`https://127.0.0.1:${String(PORT)}/admin`);
    expect(result.tlsNote).toContain('This warning is expected for this player.');
  });
});
