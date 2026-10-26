// Each case pins a security invariant, such as the loopback-only privileged routes, the /healthz
// fingerprint gate, or the cover proxy's non-image rejection that blocks stored XSS.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { hostname } from 'node:os';
import type { Config } from '../../../src/config.js';
import type { SettingsFile } from '../../../src/config/store.js';
import { makeTestConfig } from '../../helpers/test-config.js';

// player.ts validates merged settings with the real SettingsFileSchema, so only disk I/O is fake.
vi.mock('../../../src/config/store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/config/store.js')>();
  return { ...actual, readSettings: vi.fn(), readRawSettings: vi.fn(), writeSettings: vi.fn() };
});

// Stubbed live flags keep each response deterministic and make each setter observable.
vi.mock('../../../src/web/player-runtime.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/web/player-runtime.js')>();
  return {
    ...actual,
    getPersist: vi.fn(() => false),
    setPersist: vi.fn(),
    getTheme: vi.fn(() => null),
    setTheme: vi.fn(),
    getVisualizer: vi.fn(() => true),
    setVisualizer: vi.fn(),
  };
});

// A test sets `interfaces` to stand in for this machine's network interfaces, so a host with no LAN still checks LAN URLs.
const osStub = vi.hoisted(() => ({ interfaces: null as NodeJS.Dict<import('node:os').NetworkInterfaceInfo[]> | null }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, networkInterfaces: () => osStub.interfaces ?? actual.networkInterfaces() };
});

// The cover proxy would otherwise send a real HTTP request.
vi.mock('../../../src/utils/fetch-with-timeout.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/utils/fetch-with-timeout.js')>();
  return {
    ...actual,
    fetchWithTimeout: vi.fn(),
    getNavidromeRequestTimeoutMs: vi.fn(() => 5000),
  };
});

// The real control impls would reach mpv IPC.
vi.mock('../../../src/tools/playback.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/tools/playback.js')>();
  return {
    ...actual,
    shuffleQueueFromTop: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    playQueueIndex: vi.fn(),
    listAudioDevices: vi.fn(),
    setAudioDevice: vi.fn(),
  };
});

import { readRawSettings, readSettings, writeSettings } from '../../../src/config/store.js';
import { getPersist, setPersist, setTheme, setVisualizer } from '../../../src/web/player-runtime.js';
import { fetchWithTimeout } from '../../../src/utils/fetch-with-timeout.js';
import { HEALTH_APP_ID, handleHealth } from '../../../src/webui/routes/health.js';
import {
  handleGetPlayerSettings,
  handleMcpLease,
  handlePlayerState,
  handleSetPlayerSettings,
  handleShutdown,
  MCP_LEASE_PATH,
} from '../../../src/webui/routes/player.js';
import { handleCover } from '../../../src/webui/routes/cover.js';
import { handlePlayQueueIndex, handleSeek, handleVolume } from '../../../src/webui/routes/controls.js';
import { handleNetworkInfo } from '../../../src/webui/routes/network-info.js';
import { isLanReachable } from '../../../src/webui/network.js';
import { playbackEngine } from '../../../src/services/playback/playback-engine.js';
import {
  listAudioDevices,
  playQueueIndex,
  seek,
  setAudioDevice,
  setVolume,
  shuffleQueueFromTop,
} from '../../../src/tools/playback.js';
import { AuthService, MAX_GUESTS_PER_CODE } from '../../../src/webui/auth/auth-service.js';
import { GuestQueue } from '../../../src/webui/jukebox/guest-queue.js';
import { connectionLimitsFor, createConnectionLimiter, createServer } from '../../../src/webui/server.js';

interface CapturedRes {
  res: ServerResponse;
  status: () => number | undefined;
  json: () => unknown;
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
      if (typeof chunk === 'string') body += chunk;
    },
  } as unknown as ServerResponse;
  return {
    res,
    status: () => status,
    json: () => (body === '' ? undefined : JSON.parse(body)),
  };
}

function fakeReq(remoteAddress: string, bodyChunks: Buffer[] = [], host = '127.0.0.1:8808'): IncomingMessage {
  const emitter = new EventEmitter() as IncomingMessage & {
    socket: { remoteAddress: string };
  };
  emitter.socket = { remoteAddress } as never;
  emitter.headers = { host };
  emitter.rawHeaders = ['Host', host];
  queueMicrotask(() => {
    for (const c of bodyChunks) emitter.emit('data', c);
    emitter.emit('end');
  });
  return emitter;
}

function configWith(webui: { expose: boolean; host: string; autoOpenBrowser?: boolean; allowedHosts?: string[]; publicUrl?: string }): Config {
  return makeTestConfig({
    webui: {
      enabled: true,
      host: webui.host,
      port: 8808,
      expose: webui.expose,
      allowedHosts: webui.allowedHosts ?? [],
      publicUrl: webui.publicUrl ?? null,
      autoOpenBrowser: webui.autoOpenBrowser ?? false,
      persistAfterMcpExit: false,
      theme: null,
      visualizer: true,
      tls: { certPath: null, keyPath: null },
      auth: { mode: 'none', adminPasswordHash: null, adminAccess: 'localhost' },
    },
  });
}

const LOOPBACK_CONFIG = configWith({ expose: false, host: '127.0.0.1' });

function fakeBroadcaster(): { broadcastNow: ReturnType<typeof vi.fn> } {
  return { broadcastNow: vi.fn() };
}

const LOOPBACK = '127.0.0.1';
const LAN_PEER = '192.168.1.50';
const INTERNET_PEER = '203.0.113.5';

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  osStub.interfaces = null;
});

describe('handleHealth loopback gate (resolved bind host matrix)', () => {
  it('serves 200 to a non-loopback peer when not LAN-reachable (expose=false, host=127.0.0.1)', () => {
    const cap = fakeRes();
    handleHealth(fakeReq(LAN_PEER), cap.res, configWith({ expose: false, host: '127.0.0.1' }));
    expect(cap.status()).toBe(200);
    expect((cap.json() as { app: string }).app).toBe(HEALTH_APP_ID);
  });

  it('hides itself (404) from a non-loopback peer when expose=true resolved the bind to 0.0.0.0', () => {
    const cap = fakeRes();
    handleHealth(fakeReq(LAN_PEER), cap.res, configWith({ expose: true, host: '0.0.0.0' }));
    expect(cap.status()).toBe(404);
  });

  it('serves 200 to a loopback peer even when expose=true', () => {
    const cap = fakeRes();
    handleHealth(fakeReq(LOOPBACK), cap.res, configWith({ expose: true, host: '0.0.0.0' }));
    expect(cap.status()).toBe(200);
  });

  it('serves 200 to a non-loopback peer when an explicit loopback host wins over expose=true', () => {
    const cap = fakeRes();
    handleHealth(fakeReq(LAN_PEER), cap.res, configWith({ expose: true, host: '127.0.0.1' }));
    expect(cap.status()).toBe(200);
  });

  it.each(['::', '192.168.1.10'])('hides itself (404) from a non-loopback peer on host %s with expose=false', (host) => {
    const cap = fakeRes();
    handleHealth(fakeReq(LAN_PEER), cap.res, configWith({ expose: false, host }));
    expect(cap.status()).toBe(404);
  });

  it('hides itself (404) from a non-loopback peer on a wildcard bind (host=0.0.0.0, expose=false)', () => {
    // A 0.0.0.0 bind is LAN-reachable even with expose=false, so the version fingerprint stays
    // loopback-only.
    const cap = fakeRes();
    handleHealth(fakeReq(LAN_PEER), cap.res, configWith({ expose: false, host: '0.0.0.0' }));
    expect(cap.status()).toBe(404);
  });

  it('serves 200 to a loopback peer on a wildcard bind (host=0.0.0.0)', () => {
    const cap = fakeRes();
    handleHealth(fakeReq('::1'), cap.res, configWith({ expose: false, host: '0.0.0.0' }));
    expect(cap.status()).toBe(200);
  });

  it('serves only the app signature and the version', () => {
    const cap = fakeRes();
    handleHealth(fakeReq(LOOPBACK), cap.res, configWith({ expose: false, host: '127.0.0.1' }));
    expect(Object.keys(cap.json() as object).sort()).toEqual(['app', 'version']);
    expect(cap.json()).toMatchObject({ app: HEALTH_APP_ID });
  });
});

describe('LAN reachability follows the resolved bind host', () => {
  it.each([
    ['127.0.0.1', false],
    ['127.0.1.1', false],
    ['localhost', false],
    ['::1', false],
    ['0.0.0.0', true],
    ['::', true],
    ['192.168.1.10', true],
  ])('isLanReachable(%j) is %s', (host, expected) => {
    expect(isLanReachable(host)).toBe(expected);
  });

  it('reports lanReachable and no LAN interfaces for an explicit loopback host with expose=true', () => {
    const cap = fakeRes();
    handleNetworkInfo(cap.res, configWith({ expose: true, host: '127.0.0.1' }));
    expect(cap.json()).toMatchObject({ lanReachable: false, interfaces: [] });
  });

  it('links every listed address to the admin page', () => {
    const cap = fakeRes();
    osStub.interfaces = {
      lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' }],
      eth0: [{ address: '192.168.1.42', netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:01', internal: false, cidr: '192.168.1.42/24' }],
    };
    handleNetworkInfo(cap.res, configWith({ expose: true, host: '0.0.0.0' }));
    expect(cap.json()).toMatchObject({
      localhostUrl: 'http://127.0.0.1:8808/admin',
      interfaces: [{ iface: 'eth0', address: '192.168.1.42', url: 'http://192.168.1.42:8808/admin' }],
    });
  });

  it.each([
    'vEthernet (WSL)',
    'vEthernet (WSL (Hyper-V firewall))',
    'vEthernet (Default Switch)',
    'WSL',
    'VirtualBox Host-Only Network',
    'VMware Network Adapter VMnet8',
    'docker0',
    'vEthernet (DockerNAT)',
    'veth3f2a1b',
    'br-3f2a1b4c5d6e',
    'podman0',
    'cni-podman0',
    'vboxnet0',
    'vmnet8',
    'incusbr0',
    'virbr0',
    'virbr0-nic',
    'vEthernet (nat)',
    'VirtualBox Host-Only Network #2',
    'docker_gwbridge',
    'lxcbr0',
    'lxdbr0',
  ])(
    'leaves out the virtual adapter %j',
    (iface) => {
      const cap = fakeRes();
      const lan = { netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:01', internal: false } as const;
      osStub.interfaces = {
        [iface]: [{ ...lan, address: '172.28.0.1', cidr: '172.28.0.1/20' }],
        'Wi-Fi': [{ ...lan, address: '192.168.1.42', cidr: '192.168.1.42/24' }],
      };
      handleNetworkInfo(cap.res, configWith({ expose: true, host: '0.0.0.0' }));
      expect((cap.json() as { interfaces: unknown }).interfaces).toEqual([{ iface: 'Wi-Fi', address: '192.168.1.42', url: 'http://192.168.1.42:8808/admin' }]);
    },
  );

  it.each(['vEthernet (External Switch)', 'vEthernet (WSL Bridge)', 'vEthernet (Docker LAN)'])(
    'keeps the host vNIC %j of a Hyper-V external switch, which carries the LAN address',
    (iface) => {
      const cap = fakeRes();
      osStub.interfaces = {
        [iface]: [{ address: '192.168.1.42', netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:01', internal: false, cidr: '192.168.1.42/24' }],
      };
      handleNetworkInfo(cap.res, configWith({ expose: true, host: '0.0.0.0' }));
      expect((cap.json() as { interfaces: unknown }).interfaces).toEqual([
        { iface, address: '192.168.1.42', url: 'http://192.168.1.42:8808/admin' },
      ]);
    },
  );

  it('keeps the macOS bridge100, since Internet Sharing serves its hotspot clients on that address', () => {
    const cap = fakeRes();
    osStub.interfaces = {
      bridge100: [{ address: '192.168.2.1', netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:01', internal: false, cidr: '192.168.2.1/24' }],
    };
    handleNetworkInfo(cap.res, configWith({ expose: true, host: '0.0.0.0' }));
    expect((cap.json() as { interfaces: unknown }).interfaces).toEqual([
      { iface: 'bridge100', address: '192.168.2.1', url: 'http://192.168.2.1:8808/admin' },
    ]);
  });

  it('reports lanReachable for an IPv6 wildcard bind with expose=false', () => {
    const cap = fakeRes();
    handleNetworkInfo(cap.res, configWith({ expose: false, host: '::' }));
    expect(cap.json()).toMatchObject({ lanReachable: true });
  });
});

describe('player routes reject non-loopback peers in access mode none', () => {
  it('GET /api/player/settings returns 404 to a LAN peer without reading the store', async () => {
    const reply = await dispatchFrom(LAN_PEER, '/api/player/settings', LOOPBACK_CONFIG, '127.0.0.1:8808');
    expect(reply.status).toBe(404);
    expect(readSettings).not.toHaveBeenCalled();
  });

  it('POST /api/player/settings returns 404 to a LAN peer and never writes', async () => {
    const reply = await dispatchFrom(LAN_PEER, '/api/player/settings', LOOPBACK_CONFIG, '127.0.0.1:8808', {
      method: 'POST',
      body: { autoOpenBrowser: true },
    });
    expect(reply.status).toBe(404);
    expect(setPersist).not.toHaveBeenCalled();
    expect(writeSettings).not.toHaveBeenCalled();
  });

  it('POST /api/shutdown returns 404 to a LAN peer and never invokes the shutdown callback', async () => {
    const shutdown = vi.fn();
    const reply = await dispatchFrom(LAN_PEER, '/api/shutdown', LOOPBACK_CONFIG, '127.0.0.1:8808', { method: 'POST', body: {}, shutdown });
    expect(reply.status).toBe(404);
    expect(shutdown).not.toHaveBeenCalled();
  });

  it('handleShutdown answers 200 and defers the callback', () => {
    vi.useFakeTimers();
    const cap = fakeRes();
    const shutdown = vi.fn();
    handleShutdown(cap.res, shutdown);
    expect(cap.status()).toBe(200);
    expect(shutdown).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it('POST /api/shutdown accepts a loopback peer', async () => {
    const reply = await dispatchFrom(LOOPBACK, '/api/shutdown', LOOPBACK_CONFIG, '127.0.0.1:8808', { method: 'POST', body: {} });
    expect(reply.status).toBe(200);
  });

  it('handleMcpLease returns 404 to a LAN peer and opens no lease', () => {
    const cap = fakeRes();
    const leases = { open: vi.fn(), close: vi.fn() };
    handleMcpLease(fakeReq(LAN_PEER), cap.res, leases);
    expect(cap.status()).toBe(404);
    expect(leases.open).not.toHaveBeenCalled();
  });
});

describe('local-only routes reject a loopback peer with a foreign Host (DNS rebinding)', () => {
  const REBOUND_HOST = 'evil.example:8808';
  // A LAN bind lets the foreign Host past the host gate only when allowedHosts lists it, so the
  // loopback rule is the check under test.
  const REBOUND_BIND = configWith({ expose: true, host: '0.0.0.0', allowedHosts: ['evil.example'] });

  it('POST /api/shutdown returns 404 and never invokes the shutdown callback', async () => {
    const shutdown = vi.fn();
    const reply = await dispatchFrom(LOOPBACK, '/api/shutdown', REBOUND_BIND, REBOUND_HOST, { method: 'POST', body: {}, shutdown });
    expect(reply.status).toBe(404);
    expect(shutdown).not.toHaveBeenCalled();
  });

  it('handleMcpLease returns 404 and opens no lease', () => {
    const cap = fakeRes();
    const leases = { open: vi.fn(), close: vi.fn() };
    handleMcpLease(fakeReq(LOOPBACK, [], REBOUND_HOST), cap.res, leases);
    expect(cap.status()).toBe(404);
    expect(leases.open).not.toHaveBeenCalled();
  });

  it('GET /api/player/settings returns 404 without reading the store', async () => {
    const reply = await dispatchFrom(LOOPBACK, '/api/player/settings', REBOUND_BIND, REBOUND_HOST);
    expect(reply.status).toBe(404);
    expect(readSettings).not.toHaveBeenCalled();
  });

  it('POST /api/player/settings returns 404 and never writes', async () => {
    const reply = await dispatchFrom(LOOPBACK, '/api/player/settings', REBOUND_BIND, REBOUND_HOST, {
      method: 'POST',
      body: { theme: 'dark' },
    });
    expect(reply.status).toBe(404);
    expect(setTheme).not.toHaveBeenCalled();
    expect(writeSettings).not.toHaveBeenCalled();
  });

  it('handleHealth hides itself (404) on a 0.0.0.0 bind', () => {
    const cap = fakeRes();
    handleHealth(fakeReq(LOOPBACK, [], REBOUND_HOST), cap.res, configWith({ expose: false, host: '0.0.0.0' }));
    expect(cap.status()).toBe(404);
  });

  it('handlePlayerState reports isLocal false', () => {
    const cap = fakeRes();
    handlePlayerState(fakeReq(LOOPBACK, [], REBOUND_HOST), cap.res, configWith({ expose: false, host: '0.0.0.0' }));
    expect(cap.json()).toMatchObject({ isLocal: false });
  });

  it('GET /api/auth/session reports isLocal false', async () => {
    const reply = await dispatchFrom(LOOPBACK, '/api/auth/session', REBOUND_BIND, REBOUND_HOST);
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toMatchObject({ isLocal: false });
  });
});

describe('local-only routes reject a request relayed by a same-host proxy', () => {
  it('POST /api/shutdown returns 404 to a loopback peer that carries X-Forwarded-For', async () => {
    const shutdown = vi.fn();
    const reply = await dispatchFrom(LOOPBACK, '/api/shutdown', LOOPBACK_CONFIG, '127.0.0.1:8808', {
      method: 'POST',
      body: {},
      shutdown,
      headers: { 'x-forwarded-for': '203.0.113.5' },
    });
    expect(reply.status).toBe(404);
    expect(shutdown).not.toHaveBeenCalled();
  });
});

describe('handleSetPlayerSettings input validation', () => {
  it.each([
    ['a wrongly typed field', { persistAfterMcpExit: 'yes' }],
    ['an unknown key', { autoOpenBrowser: true, volume: 50 }],
    ['an array body', [1]],
  ])('rejects %s with 400 and applies nothing', async (_label, body) => {
    const cap = fakeRes();
    await handleSetPlayerSettings(fakeReq(LOOPBACK, [Buffer.from(JSON.stringify(body))]), cap.res, LOOPBACK_CONFIG, fakeBroadcaster());
    expect(cap.status()).toBe(400);
    expect(setPersist).not.toHaveBeenCalled();
    expect(writeSettings).not.toHaveBeenCalled();
  });
});

describe('handleSetPlayerSettings preserves unrelated stored settings', () => {
  it('merges only the touched webui key, keeping credentials and other keys intact', async () => {
    const stored: SettingsFile = {
      navidrome: { url: 'http://music.local', username: 'admin', password: 'super-secret' },
      webui: {
        enabled: true,
        host: '0.0.0.0',
        port: 9000,
        expose: true,
        autoOpenBrowser: false,
        persistAfterMcpExit: true,
      },
      advanced: { debug: true },
    };
    vi.mocked(readRawSettings).mockReturnValue(stored);
    let written: SettingsFile | undefined;
    vi.mocked(writeSettings).mockImplementation((s) => {
      written = s;
    });

    const cap = fakeRes();
    await handleSetPlayerSettings(
      fakeReq(LOOPBACK, [Buffer.from(JSON.stringify({ autoOpenBrowser: true }))]),
      cap.res,
      LOOPBACK_CONFIG,
      fakeBroadcaster(),
    );

    expect(cap.status()).toBe(200);
    expect(writeSettings).toHaveBeenCalledTimes(1);
    expect(written?.webui?.autoOpenBrowser).toBe(true);
    expect(written?.webui?.host).toBe('0.0.0.0');
    expect(written?.webui?.port).toBe(9000);
    expect(written?.webui?.expose).toBe(true);
    expect(written?.webui?.persistAfterMcpExit).toBe(true);
    expect(written?.navidrome?.password).toBe('super-secret');
    expect(written?.advanced?.debug).toBe(true);
    // Body didn't touch persistAfterMcpExit, so the live flag isn't flipped.
    expect(setPersist).not.toHaveBeenCalled();
    expect(getPersist).toHaveBeenCalled();
  });

  it('keeps stored keys the settings schema does not know', async () => {
    vi.mocked(readRawSettings).mockReturnValue({
      navidrome: { url: 'http://music.local', username: 'admin', password: 'super-secret' },
      webui: { theme: 'light', note: 'hand-added' },
      playback: { mpvPath: '/usr/bin/mpv', someFutureKey: 7 },
      futureSection: { flag: true },
    });
    let written: Record<string, unknown> | undefined;
    vi.mocked(writeSettings).mockImplementation((s) => {
      written = s;
    });

    const cap = fakeRes();
    await handleSetPlayerSettings(
      fakeReq(LOOPBACK, [Buffer.from(JSON.stringify({ theme: 'dark' }))]),
      cap.res,
      LOOPBACK_CONFIG,
      fakeBroadcaster(),
    );

    expect(cap.status()).toBe(200);
    expect(cap.json()).toMatchObject({ persisted: true });
    expect(written).toEqual({
      navidrome: { url: 'http://music.local', username: 'admin', password: 'super-secret' },
      webui: { theme: 'dark', note: 'hand-added' },
      playback: { mpvPath: '/usr/bin/mpv', someFutureKey: 7 },
      futureSection: { flag: true },
    });
  });
});

describe('handleSetPlayerSettings persistAfterMcpExit', () => {
  it('applies the flag to the running player and persists it', async () => {
    vi.mocked(readRawSettings).mockReturnValue({
      navidrome: { url: 'http://music.local', username: 'admin', password: 'p' },
      webui: { persistAfterMcpExit: false },
    });
    let written: SettingsFile | undefined;
    vi.mocked(writeSettings).mockImplementation((s) => {
      written = s;
    });

    const cap = fakeRes();
    await handleSetPlayerSettings(
      fakeReq(LOOPBACK, [Buffer.from(JSON.stringify({ persistAfterMcpExit: true }))]),
      cap.res,
      LOOPBACK_CONFIG,
      fakeBroadcaster(),
    );

    expect(cap.status()).toBe(200);
    expect(setPersist).toHaveBeenCalledWith(true);
    expect(written?.webui?.persistAfterMcpExit).toBe(true);
  });
});

describe('handleSetPlayerSettings theme', () => {
  it('applies the theme live, persists it, and broadcasts it to every remote', async () => {
    vi.mocked(readRawSettings).mockReturnValue({
      navidrome: { url: 'http://music.local', username: 'admin', password: 'super-secret' },
      webui: { persistAfterMcpExit: true },
    });
    let written: SettingsFile | undefined;
    vi.mocked(writeSettings).mockImplementation((s) => {
      written = s;
    });
    const broadcaster = fakeBroadcaster();

    const cap = fakeRes();
    await handleSetPlayerSettings(
      fakeReq(LOOPBACK, [Buffer.from(JSON.stringify({ theme: 'dark' }))]),
      cap.res,
      LOOPBACK_CONFIG,
      broadcaster,
    );

    expect(cap.status()).toBe(200);
    expect(setTheme).toHaveBeenCalledWith('dark');
    expect(written?.webui?.theme).toBe('dark');
    expect(written?.webui?.persistAfterMcpExit).toBe(true);
    expect(broadcaster.broadcastNow).toHaveBeenCalledTimes(1);
  });

  it('accepts a null theme, which returns every device to its own setting', async () => {
    vi.mocked(readRawSettings).mockReturnValue({
      navidrome: { url: 'http://music.local', username: 'admin', password: 'super-secret' },
      webui: { theme: 'dark' },
    });
    let written: SettingsFile | undefined;
    vi.mocked(writeSettings).mockImplementation((s) => {
      written = s;
    });

    const cap = fakeRes();
    await handleSetPlayerSettings(
      fakeReq(LOOPBACK, [Buffer.from(JSON.stringify({ theme: null }))]),
      cap.res,
      LOOPBACK_CONFIG,
      fakeBroadcaster(),
    );

    expect(cap.status()).toBe(200);
    expect(setTheme).toHaveBeenCalledWith(null);
    expect(written?.webui?.theme).toBeNull();
  });

  it('rejects an unknown theme with 400 and changes nothing', async () => {
    const broadcaster = fakeBroadcaster();
    const cap = fakeRes();
    await handleSetPlayerSettings(
      fakeReq(LOOPBACK, [Buffer.from(JSON.stringify({ theme: 'blue' }))]),
      cap.res,
      LOOPBACK_CONFIG,
      broadcaster,
    );

    expect(cap.status()).toBe(400);
    expect(setTheme).not.toHaveBeenCalled();
    expect(writeSettings).not.toHaveBeenCalled();
    expect(broadcaster.broadcastNow).not.toHaveBeenCalled();
  });
});

describe('handleSetPlayerSettings visualizer', () => {
  it('applies the setting live, syncs the mpv filter to it, persists it and broadcasts it', async () => {
    vi.mocked(readRawSettings).mockReturnValue({
      navidrome: { url: 'http://music.local', username: 'admin', password: 'super-secret' },
      webui: { theme: 'dark' },
    });
    const order: string[] = [];
    let written: SettingsFile | undefined;
    vi.mocked(writeSettings).mockImplementation((s) => {
      written = s;
    });
    vi.mocked(setVisualizer).mockImplementation(() => { order.push('set'); });
    const sync = vi.spyOn(playbackEngine, 'syncVisualizerFilter').mockImplementation(() => {
      order.push('sync');
      return Promise.resolve();
    });
    const broadcaster = fakeBroadcaster();

    try {
      const cap = fakeRes();
      await handleSetPlayerSettings(
        fakeReq(LOOPBACK, [Buffer.from(JSON.stringify({ visualizer: false }))]),
        cap.res,
        LOOPBACK_CONFIG,
        broadcaster,
      );

      expect(cap.status()).toBe(200);
      expect(setVisualizer).toHaveBeenCalledWith(false);
      expect(written?.webui).toEqual({ theme: 'dark', visualizer: false });
      expect(broadcaster.broadcastNow).toHaveBeenCalledTimes(1);
      expect(order).toEqual(['set', 'sync']);
    } finally {
      sync.mockRestore();
    }
  });

  it('leaves the mpv filter alone when the visualizer is not in the patch', async () => {
    vi.mocked(readRawSettings).mockReturnValue(null);
    const sync = vi.spyOn(playbackEngine, 'syncVisualizerFilter');

    try {
      await handleSetPlayerSettings(
        fakeReq(LOOPBACK, [Buffer.from(JSON.stringify({ theme: 'light' }))]),
        fakeRes().res,
        LOOPBACK_CONFIG,
        fakeBroadcaster(),
      );

      expect(sync).not.toHaveBeenCalled();
    } finally {
      sync.mockRestore();
    }
  });
});

describe('handleSetPlayerSettings reports autoOpenBrowser as stored', () => {
  const STORED: SettingsFile = {
    navidrome: { url: 'http://music.local', username: 'admin', password: 'super-secret' },
    webui: { autoOpenBrowser: false },
  };

  async function postAutoOpen(): Promise<unknown> {
    const cap = fakeRes();
    await handleSetPlayerSettings(
      fakeReq(LOOPBACK, [Buffer.from(JSON.stringify({ autoOpenBrowser: true }))]),
      cap.res,
      LOOPBACK_CONFIG,
      fakeBroadcaster(),
    );
    expect(cap.status()).toBe(200);
    return cap.json();
  }

  it('reports the written value once settings.json is saved', async () => {
    vi.mocked(readRawSettings).mockReturnValue(STORED);

    expect(await postAutoOpen()).toMatchObject({ autoOpenBrowser: true, persisted: true });
  });

  it('reports the stored value when the write fails', async () => {
    vi.mocked(readRawSettings).mockReturnValue(STORED);
    vi.mocked(writeSettings).mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    expect(await postAutoOpen()).toMatchObject({ autoOpenBrowser: false, persisted: false });
  });

  it('reports the launch config value when no settings.json exists to hold the value', async () => {
    vi.mocked(readRawSettings).mockReturnValue(null);

    expect(await postAutoOpen()).toMatchObject({ autoOpenBrowser: false, persisted: false });
    expect(writeSettings).not.toHaveBeenCalled();
  });
});

describe('handleGetPlayerSettings reports autoOpenBrowser', () => {
  it('reports the env-fallback launch config when no settings.json exists', () => {
    vi.mocked(readSettings).mockReturnValue(null);
    const cap = fakeRes();

    handleGetPlayerSettings(cap.res, configWith({ expose: false, host: '127.0.0.1', autoOpenBrowser: true }));

    expect(cap.status()).toBe(200);
    expect(cap.json()).toEqual({
      persistAfterMcpExit: false,
      autoOpenBrowser: true,
      theme: null,
      visualizer: true,
      visualizerUnsupported: false,
    });
  });
});

describe('handleCover content-type allowlist', () => {
  it('rejects a 200 upstream with a non-image content-type and cancels the body', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const upstream = {
      ok: true,
      status: 200,
      body: { cancel } as unknown as ReadableStream<Uint8Array>,
      headers: {
        get: (name: string): string | null =>
          name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null,
      },
    } as unknown as Response;
    vi.mocked(fetchWithTimeout).mockResolvedValue(upstream);

    const cap = fakeRes();
    await handleCover(cap.res, makeTestConfig(), 'album123', null);

    expect(cap.status()).toBe(502);
    expect((cap.json() as { error: string }).error).toContain('non-image');
    // Cancelling the body releases the fetch connection.
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe('handleCover size parameter', () => {
  async function requestedUrl(rawSize: string | null): Promise<URL> {
    vi.mocked(fetchWithTimeout).mockResolvedValue({
      ok: false,
      status: 404,
      body: null,
      headers: { get: (): string | null => null },
    } as unknown as Response);
    const cap = fakeRes();
    await handleCover(cap.res, makeTestConfig(), 'album123', rawSize);
    expect(cap.status()).toBe(404);
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    return new URL(String(vi.mocked(fetchWithTimeout).mock.calls[0]?.[0]));
  }

  it('sends no size upstream when the parameter is absent', async () => {
    const url = await requestedUrl(null);
    expect(url.searchParams.get('id')).toBe('album123');
    expect(url.searchParams.has('size')).toBe(false);
  });

  it('forwards a valid size to getCoverArt', async () => {
    const url = await requestedUrl('96');
    expect(url.pathname).toMatch(/\/rest\/getCoverArt\.view$/);
    expect(url.searchParams.get('size')).toBe('96');
  });

  it.each(['abc', '8', '2000', '12.5'])('rejects size %j with 400 and no upstream call', async (rawSize) => {
    const cap = fakeRes();
    await handleCover(cap.res, makeTestConfig(), 'album123', rawSize);
    expect(cap.status()).toBe(400);
    expect(cap.json()).toEqual({ error: 'Invalid size' });
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });
});

describe('control routes validate their body', () => {
  it.each([
    ['seek', handleSeek, seek, { seconds: 'ten' }],
    ['volume', handleVolume, setVolume, { level: 'loud' }],
    ['play-index', handlePlayQueueIndex, playQueueIndex, { index: -1 }],
  ] as const)('rejects an invalid %s body with 400 and never calls the impl', async (_label, handler, impl, body) => {
    const cap = fakeRes();
    await handler(fakeReq(LOOPBACK, [Buffer.from(JSON.stringify(body))]), cap.res);
    expect(cap.status()).toBe(400);
    expect((cap.json() as { error: string }).error).not.toBe('');
    expect(impl).not.toHaveBeenCalled();
  });

  it('passes a valid seek body to the impl with its defaults applied', async () => {
    vi.mocked(seek).mockResolvedValue({ success: true });
    const cap = fakeRes();
    await handleSeek(fakeReq(LOOPBACK, [Buffer.from(JSON.stringify({ seconds: 30 }))]), cap.res);
    expect(cap.status()).toBe(200);
    expect(seek).toHaveBeenCalledWith({ seconds: 30, mode: 'relative' });
  });
});

interface ServerRequestOptions {
  /** The bind host the dispatcher believes it has. The socket always listens on 127.0.0.1. */
  bindHost?: string;
  /** The configured web port. The socket always listens on an ephemeral port. */
  configuredPort?: number;
  allowedHosts?: string[];
  publicUrl?: string;
  /** Builds the Host header from the ephemeral port. Defaults to `127.0.0.1:<port>`. */
  hostHeader?: (port: number) => string;
  /** The function form builds headers, such as `Origin`, from the ephemeral port. */
  headers?: Record<string, string> | ((port: number) => Record<string, string>);
  body?: string;
  addVisualizerClient?: (res: ServerResponse) => void;
}

interface ServerReply {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
  /** False when the server aborted the response before its final chunk. */
  complete: boolean;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function testServer(
  config: Config = LOOPBACK_CONFIG,
  addVisualizerClient: (res: ServerResponse) => void = vi.fn(),
): ReturnType<typeof createServer> {
  return createServer({
    config,
    client: {} as never,
    broadcaster: {} as never,
    visualizer: { addClient: addVisualizerClient },
    shutdown: () => undefined,
    leases: { open: () => undefined, close: () => undefined },
    auth: new AuthService(config),
    guests: new GuestQueue(),
  });
}

async function requestServer(method: string, path: string, options: ServerRequestOptions = {}): Promise<ServerReply> {
  const config = configWith({ expose: false, host: options.bindHost ?? '127.0.0.1', allowedHosts: options.allowedHosts, publicUrl: options.publicUrl });
  if (options.configuredPort !== undefined) config.webui.port = options.configuredPort;
  const server = testServer(config, options.addVisualizerClient);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const extraHeaders = typeof options.headers === 'function' ? options.headers(port) : options.headers;
    const headers = { Host: options.hostHeader?.(port) ?? `127.0.0.1:${port}`, ...extraHeaders };
    return await new Promise((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path, method, headers }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('error', () => undefined);
        res.on('close', () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body, complete: res.complete });
        });
      });
      req.on('error', reject);
      req.end(options.body);
    });
  } finally {
    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => {
        resolve();
      });
    });
  }
}

describe('POST /api/controls/shuffle', () => {
  it('dispatches to the from-the-top shuffle and returns its result as 200 JSON', async () => {
    vi.mocked(shuffleQueueFromTop).mockResolvedValue({ success: true });

    const reply = await requestServer('POST', '/api/controls/shuffle', { headers: JSON_HEADERS, body: '{}' });

    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toEqual({ success: true });
    expect(shuffleQueueFromTop).toHaveBeenCalledTimes(1);
  });
});

describe('audio output routes', () => {
  it('GET /api/audio-devices returns the list tool result as 200 JSON', async () => {
    const result = {
      selected: { id: 'auto', name: null, connected: true },
      devices: [{ id: 'auto', name: 'Autoselect device' }, { id: 'wasapi/{a}', name: 'Speakers' }],
      source: 'probe' as const,
    };
    vi.mocked(listAudioDevices).mockResolvedValue(result);

    const reply = await requestServer('GET', '/api/audio-devices');

    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toEqual(result);
    expect(listAudioDevices).toHaveBeenCalledWith({});
  });

  it.each([
    ['a missing', {}],
    ['an empty', { id: '' }],
    ['a blank', { id: '   ' }],
  ])('POST /api/controls/audio-device rejects %s id with 400 and never calls the tool', async (_label, body) => {
    const reply = await requestServer('POST', '/api/controls/audio-device', { headers: JSON_HEADERS, body: JSON.stringify(body) });

    expect(reply.status).toBe(400);
    expect((JSON.parse(reply.body) as { error: string }).error).not.toBe('');
    expect(setAudioDevice).not.toHaveBeenCalled();
  });

  it('POST /api/controls/audio-device forwards a valid id and returns the tool result', async () => {
    const result = { success: true as const, device: { id: 'wasapi/{a}', name: 'Speakers' }, applied: 'now' as const, persisted: true };
    vi.mocked(setAudioDevice).mockResolvedValue(result);

    const reply = await requestServer('POST', '/api/controls/audio-device', {
      headers: JSON_HEADERS,
      body: JSON.stringify({ id: 'wasapi/{a}' }),
    });

    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toEqual(result);
    expect(setAudioDevice).toHaveBeenCalledWith({ id: 'wasapi/{a}' });
  });
});

describe('POST Content-Type gate', () => {
  it.each([
    ['text/plain', { 'Content-Type': 'text/plain' }],
    ['no', {}],
  ])('rejects a POST with %s Content-Type with 415 and runs no handler', async (_label, headers) => {
    const reply = await requestServer('POST', '/api/controls/shuffle', { headers, body: '{}' });

    expect(reply.status).toBe(415);
    expect(JSON.parse(reply.body)).toEqual({ error: 'Content-Type must be application/json' });
    expect(shuffleQueueFromTop).not.toHaveBeenCalled();
  });

  it('accepts a JSON Content-Type with a charset parameter', async () => {
    vi.mocked(shuffleQueueFromTop).mockResolvedValue({ success: true });

    const reply = await requestServer('POST', '/api/controls/shuffle', {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: '{}',
    });

    expect(reply.status).toBe(200);
  });
});

describe('Host allowlist', () => {
  it('rejects a foreign Host on a loopback bind with 403', async () => {
    const reply = await requestServer('GET', '/healthz', { hostHeader: (port) => `evil.example:${port}` });

    expect(reply.status).toBe(403);
    expect(JSON.parse(reply.body)).toEqual({ error: 'Forbidden host' });
  });

  it.each(['127.0.0.1', 'localhost', '[::1]'])('accepts Host %s:<port> on a loopback bind', async (host) => {
    const reply = await requestServer('GET', '/healthz', { hostHeader: (port) => `${host}:${port}` });

    expect(reply.status).toBe(200);
  });

  it.each(['127.0.0.1', 'localhost', '[::1]'])(
    'accepts a portless Host %s, the form a client sends for port 80',
    async (host) => {
      const reply = await requestServer('GET', '/healthz', { configuredPort: 80, hostHeader: () => host });

      expect(reply.status).toBe(200);
    },
  );

  it('rejects a portless foreign Host on a loopback bind with 403', async () => {
    const reply = await requestServer('GET', '/healthz', { configuredPort: 80, hostHeader: () => 'evil.example' });

    expect(reply.status).toBe(403);
  });

  // /healthz is local-only on a LAN bind, so a route every peer may read shows the Host gate
  // passed.
  it('accepts a LAN IP Host on a non-loopback bind, but the local-only flag stays off', async () => {
    const reply = await requestServer('GET', '/api/auth/session', {
      bindHost: '0.0.0.0',
      hostHeader: (port) => `192.168.1.20:${port}`,
    });

    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toMatchObject({ isLocal: false });
  });

  it('rejects a DNS name Host on a non-loopback bind with 403', async () => {
    const reply = await requestServer('GET', '/api/player-state', {
      bindHost: '0.0.0.0',
      hostHeader: () => 'evil.example:8808',
    });

    expect(reply.status).toBe(403);
    expect(JSON.parse(reply.body)).toEqual({
      error: 'Forbidden host. Add this host name to webui.allowedHosts to allow it.',
    });
  });

  it.each([
    ['an IPv4 literal', '192.168.1.20:8808'],
    ['a bracketed IPv6 literal', '[fe80::1]:8808'],
    ['localhost', 'localhost:8808'],
    ["this machine's name", `${hostname()}:8808`],
    ['a name listed in allowedHosts', 'music.home.lan:8808'],
    ['the host of webui.publicUrl', 'jukebox.example.org:8808'],
  ])('accepts %s as Host on a non-loopback bind', async (_label, host) => {
    const reply = await requestServer('GET', '/api/player-state', {
      bindHost: '0.0.0.0',
      allowedHosts: ['music.home.lan'],
      publicUrl: 'http://Jukebox.Example.org:8808',
      hostHeader: () => host,
    });

    expect(reply.status).toBe(200);
  });
});

describe('GET /api/cover stream failure', () => {
  it('aborts the response instead of ending it when the upstream body errors mid-stream', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0xff, 0xd8, 0xff]));
      },
      // The delay lets the 200 headers and first chunk reach the client before the failure.
      pull(controller) {
        return new Promise<void>((resolve) => {
          setTimeout(() => {
            controller.error(new Error('upstream reset'));
            resolve();
          }, 50);
        });
      },
    });
    vi.mocked(fetchWithTimeout).mockResolvedValue({
      ok: true,
      status: 200,
      body,
      headers: { get: (name: string): string | null => (name.toLowerCase() === 'content-type' ? 'image/jpeg' : null) },
    } as unknown as Response);

    const reply = await requestServer('GET', '/api/cover/album123');

    expect(reply.status).toBe(200);
    // An aborted chunked body never completes, so the browser does not cache a truncated image.
    expect(reply.complete).toBe(false);
  });
});

describe('MCP lease route over a live dispatcher', () => {
  it('counts a lease while its connection is open and releases it on close', async () => {
    vi.useRealTimers();
    const leases = { open: vi.fn(), close: vi.fn() };
    const config = configWith({ expose: false, host: '127.0.0.1' });
    const server = createServer({
      config,
      client: {} as never,
      broadcaster: {} as never,
      visualizer: { addClient: vi.fn() },
      shutdown: () => undefined,
      leases,
      auth: new AuthService(config),
      guests: new GuestQueue(),
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const req = httpRequest({ host: '127.0.0.1', port, path: MCP_LEASE_PATH, method: 'POST', headers: JSON_HEADERS });
      req.on('error', () => undefined);
      const status = await new Promise<number>((resolve) => {
        req.on('response', (res) => {
          res.on('error', () => undefined);
          resolve(res.statusCode ?? 0);
        });
        req.end('{}');
      });
      expect(status).toBe(200);
      expect(leases.open).toHaveBeenCalledTimes(1);
      expect(leases.close).not.toHaveBeenCalled();

      req.destroy();
      await vi.waitFor(() => expect(leases.close).toHaveBeenCalledTimes(1));
    } finally {
      await new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      });
    }
  });
});

describe('server socket limits', () => {
  it('sets the timeouts and the header, request and connection caps', () => {
    const server = testServer();

    expect(server.headersTimeout).toBe(10_000);
    expect(server.requestTimeout).toBe(30_000);
    expect(server.keepAliveTimeout).toBe(5_000);
    expect(server.maxHeadersCount).toBe(64);
    expect(server.maxRequestsPerSocket).toBe(1000);
    // A socket inactivity timeout would cut an idle SSE stream.
    expect(server.timeout).toBe(0);
  });

  it('accepts a request with 12 KiB of cookies, such as a jar other local apps filled', async () => {
    const reply = await requestServer('GET', '/healthz', { headers: { Cookie: `pad=${'a'.repeat(12 * 1024)}` } });

    expect(reply.status).toBe(200);
  });

  it('refuses a request at the header-count cap with 431, so junk lines cannot push out X-Forwarded-For', async () => {
    const junk = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`A-${i}`, '1']));
    const headers = { ...JSON_HEADERS, ...junk, 'X-Forwarded-For': '203.0.113.5' };

    const reply = await requestServer('POST', '/api/shutdown', { headers, body: '{}' });

    expect(reply.status).toBe(431);
  });

  it('serves a proxied shutdown request under the header-count cap as non-local', async () => {
    const headers = { ...JSON_HEADERS, 'X-Forwarded-For': '203.0.113.5' };

    const reply = await requestServer('POST', '/api/shutdown', { headers, body: '{}' });

    expect(reply.status).toBe(404);
  });

  it('refuses a request whose headers exceed 16 KiB with 431', async () => {
    const reply = await requestServer('GET', '/healthz', { headers: { 'X-Pad': 'a'.repeat(17 * 1024) } });

    expect(reply.status).toBe(431);
  });

  it('answers a loopback health probe while more than 256 idle loopback sockets are open', async () => {
    const server = testServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const idleSockets: Socket[] = [];
    try {
      // Connecting one at a time keeps the burst under the Windows listen backlog.
      while (idleSockets.length < 257) {
        idleSockets.push(await new Promise<Socket>((resolve, reject) => {
          const socket = connect(port, '127.0.0.1', () => {
            resolve(socket);
          });
          socket.on('error', reject);
        }));
      }

      const status = await new Promise<number>((resolve, reject) => {
        httpRequest({ host: '127.0.0.1', port, path: '/healthz', headers: { Host: `127.0.0.1:${port}` } }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        }).on('error', reject).end();
      });

      expect(status).toBe(200);
    } finally {
      for (const socket of idleSockets) socket.destroy();
      await new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      });
    }
  });
});

class FakeSocket extends EventEmitter {
  destroyed = false;

  constructor(readonly remoteAddress: string | undefined) {
    super();
  }

  destroy(): void {
    this.destroyed = true;
    this.emit('close');
  }
}

function openSockets(limit: (socket: Socket) => void, addresses: Array<string | undefined>): FakeSocket[] {
  return addresses.map((address) => {
    const socket = new FakeSocket(address);
    limit(socket as unknown as Socket);
    return socket;
  });
}

describe('createConnectionLimiter', () => {
  it('reads the limits for each new socket, so a jukebox code that starts widens the internet budget', () => {
    let limits = { lan: 1, perPeer: 1, public: 1, perPublicNetwork: 1 };
    const limit = createConnectionLimiter(() => limits);

    const narrow = openSockets(limit, ['203.0.113.5', '198.51.100.7']);
    limits = { ...limits, public: 4, perPublicNetwork: 4 };
    const wide = openSockets(limit, ['198.51.100.7', '203.0.113.5']);

    expect(narrow.map((socket) => socket.destroyed)).toEqual([false, true]);
    expect(wide.map((socket) => socket.destroyed)).toEqual([false, false]);
  });

  it('never counts or refuses a loopback socket', () => {
    const limit = createConnectionLimiter(() => ({ lan: 1, perPeer: 1, public: 1, perPublicNetwork: 1 }));

    const sockets = openSockets(limit, ['192.168.1.20', '127.0.0.1', '::1', '::ffff:127.0.0.1']);

    expect(sockets.map((socket) => socket.destroyed)).toEqual([false, false, false, false]);
  });

  it('refuses a LAN socket past the LAN cap', () => {
    const limit = createConnectionLimiter(() => ({ lan: 2, perPeer: 2, public: 1, perPublicNetwork: 1 }));

    const sockets = openSockets(limit, ['192.168.1.20', '192.168.1.21', '192.168.1.22']);

    expect(sockets.map((socket) => socket.destroyed)).toEqual([false, false, true]);
  });

  it('refuses a socket past the per-peer cap while another peer still connects', () => {
    const limit = createConnectionLimiter(() => ({ lan: 10, perPeer: 2, public: 1, perPublicNetwork: 1 }));

    const sockets = openSockets(limit, ['192.168.1.20', '192.168.1.20', '192.168.1.20', '192.168.1.21']);

    expect(sockets.map((socket) => socket.destroyed)).toEqual([false, false, true, false]);
  });

  it('counts each IPv6 LAN peer separately, since a LAN shares one /64', () => {
    const limit = createConnectionLimiter(() => ({ lan: 10, perPeer: 1, public: 1, perPublicNetwork: 1 }));

    const sockets = openSockets(limit, ['fd00:1:2:3::a', 'fd00:1:2:3::b', 'fe80::1', 'fe80::2', 'fd00:1:2:3::a']);

    expect(sockets.map((socket) => socket.destroyed)).toEqual([false, false, false, false, true]);
  });

  it('keeps internet sockets out of the LAN budget', () => {
    const limit = createConnectionLimiter(() => ({ lan: 1, perPeer: 1, public: 2, perPublicNetwork: 2 }));

    const sockets = openSockets(limit, ['203.0.113.5', '198.51.100.7', '2001:db8::1', '192.168.1.20']);

    expect(sockets.map((socket) => socket.destroyed)).toEqual([false, false, true, false]);
  });

  it('refuses an internet socket past the per-network cap while another network still connects', () => {
    const limit = createConnectionLimiter(() => ({ lan: 1, perPeer: 1, public: 10, perPublicNetwork: 2 }));

    const sockets = openSockets(limit, ['203.0.113.5', '203.0.113.5', '203.0.113.5', '198.51.100.7']);

    expect(sockets.map((socket) => socket.destroyed)).toEqual([false, false, true, false]);
  });

  it('counts every internet address in one IPv6 /64 as one network', () => {
    const limit = createConnectionLimiter(() => ({ lan: 1, perPeer: 1, public: 10, perPublicNetwork: 2 }));

    const sockets = openSockets(limit, ['2001:db8:1:2::a', '2001:db8:1:2::b', '2001:db8:1:2::c', '2001:db8:1:3::a']);

    expect(sockets.map((socket) => socket.destroyed)).toEqual([false, false, true, false]);
  });

  it('frees a per-network slot when its socket closes', () => {
    const limit = createConnectionLimiter(() => ({ lan: 1, perPeer: 1, public: 10, perPublicNetwork: 1 }));
    const [first] = openSockets(limit, ['203.0.113.5']);
    first?.emit('close');

    const sockets = openSockets(limit, ['203.0.113.5', '203.0.113.5']);

    expect(sockets.map((socket) => socket.destroyed)).toEqual([false, true]);
  });

  it('counts a socket with no remote address against the internet budget', () => {
    const limit = createConnectionLimiter(() => ({ lan: 1, perPeer: 1, public: 1, perPublicNetwork: 1 }));

    const sockets = openSockets(limit, [undefined, undefined, '192.168.1.20']);

    expect(sockets.map((socket) => socket.destroyed)).toEqual([false, true, false]);
  });

  it('frees the slot when a counted socket closes', () => {
    const limit = createConnectionLimiter(() => ({ lan: 1, perPeer: 1, public: 1, perPublicNetwork: 1 }));
    const [lanSocket, publicSocket] = openSockets(limit, ['192.168.1.20', '203.0.113.5']);
    lanSocket?.emit('close');
    publicSocket?.emit('close');

    const sockets = openSockets(limit, ['192.168.1.21', '198.51.100.7']);

    expect(sockets.map((socket) => socket.destroyed)).toEqual([false, false]);
  });

  it.each([
    ['none', 'anywhere', true],
    ['password', 'lan', true],
    ['password', 'anywhere', false],
    ['jukebox', 'lan', true],
    ['jukebox', 'anywhere', false],
  ] as const)('in mode %s at level %s, a ninth internet socket is refused: %s', (mode, adminAccess, refused) => {
    const config = configWith({ expose: true, host: '0.0.0.0' });
    config.webui.auth = { mode, adminPasswordHash: null, adminAccess };
    const limit = testServer(config).listeners('connection').at(-1) as (socket: Socket) => void;

    const sockets = openSockets(limit, Array.from({ length: 9 }, (_, index) => `203.0.113.${String(index + 1)}`));

    expect(sockets.at(-1)?.destroyed).toBe(refused);
  });

  it('in mode password at level anywhere, one internet network cannot take every internet slot', () => {
    const config = configWith({ expose: true, host: '0.0.0.0' });
    config.webui.auth = { mode: 'password', adminPasswordHash: null, adminAccess: 'anywhere' };
    const limit = testServer(config).listeners('connection').at(-1) as (socket: Socket) => void;

    const flood = openSockets(limit, Array.from({ length: 17 }, () => '203.0.113.5'));
    const [admin] = openSockets(limit, ['198.51.100.7']);

    expect(flood.filter((socket) => socket.destroyed)).toHaveLength(1);
    expect(admin?.destroyed).toBe(false);
  });
});

describe('connectionLimitsFor', () => {
  const GUEST_PAGE_SOCKETS = 3;
  const jukeboxAuth = { mode: 'jukebox', adminAccess: 'lan', hasJukeboxCode: () => true } as const;
  const addresses = (prefix: string, count: number): string[] =>
    Array.from({ length: count }, (_, index) => `${prefix}.${String(Math.floor(index / 200))}.${String((index % 200) + 1)}`);

  it('while a jukebox code is active, the internet budget holds a guest page for every admitted guest', () => {
    const limit = createConnectionLimiter(() => connectionLimitsFor(jukeboxAuth));

    const sockets = openSockets(limit, addresses('8.8', MAX_GUESTS_PER_CODE * GUEST_PAGE_SOCKETS));

    expect(sockets.filter((socket) => socket.destroyed)).toHaveLength(0);
  });

  it('while a jukebox code is active, the LAN budget holds every admitted guest beside the base LAN budget', () => {
    const base = connectionLimitsFor({ ...jukeboxAuth, hasJukeboxCode: () => false });
    const limit = createConnectionLimiter(() => connectionLimitsFor(jukeboxAuth));

    const sockets = openSockets(limit, addresses('10.0', base.lan + MAX_GUESTS_PER_CODE * GUEST_PAGE_SOCKETS));

    expect(sockets.filter((socket) => socket.destroyed)).toHaveLength(0);
  });

  it('while a jukebox code is active, one carrier-NAT address holds twenty guest pages', () => {
    const limit = createConnectionLimiter(() => connectionLimitsFor(jukeboxAuth));

    const sockets = openSockets(limit, Array.from({ length: 20 * GUEST_PAGE_SOCKETS }, () => '203.0.113.5'));

    expect(sockets.filter((socket) => socket.destroyed)).toHaveLength(0);
  });

  it('while a jukebox code is active, one LAN address behind NAT loopback holds twenty guest pages beside its base cap', () => {
    const base = connectionLimitsFor({ ...jukeboxAuth, hasJukeboxCode: () => false });
    const limit = createConnectionLimiter(() => connectionLimitsFor(jukeboxAuth));

    const sockets = openSockets(limit, Array.from({ length: base.perPeer + 20 * GUEST_PAGE_SOCKETS }, () => '192.168.1.1'));

    expect(sockets.filter((socket) => socket.destroyed)).toHaveLength(0);
  });

  it.each(['none', 'password'] as const)('in mode %s, a jukebox code never widens the internet budget', (mode) => {
    const limits = connectionLimitsFor({ ...jukeboxAuth, mode });

    expect(limits).toEqual(connectionLimitsFor({ ...jukeboxAuth, hasJukeboxCode: () => false }));
  });

  it('in mode password at level anywhere, a jukebox code leaves the remote admin budget', () => {
    const passwordAuth = { mode: 'password', adminAccess: 'anywhere' } as const;

    expect(connectionLimitsFor({ ...passwordAuth, hasJukeboxCode: () => true }))
      .toEqual(connectionLimitsFor({ ...passwordAuth, hasJukeboxCode: () => false }));
    expect(connectionLimitsFor({ ...passwordAuth, hasJukeboxCode: () => true }))
      .not.toEqual(connectionLimitsFor({ ...jukeboxAuth, adminAccess: 'anywhere' }));
  });
});

const SECURITY_HEADER_NAMES = [
  'content-security-policy',
  'x-content-type-options',
  'referrer-policy',
  'x-frame-options',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'permissions-policy',
];

function expectSecurityHeaders(headers: IncomingHttpHeaders | Record<string, string>): void {
  for (const name of SECURITY_HEADER_NAMES) expect(headers[name], name).toBeDefined();
  expect(headers['x-frame-options']).toBe('DENY');
}

describe('security headers on every response', () => {
  it('sends them with a JSON response', async () => {
    const reply = await requestServer('GET', '/healthz');

    expect(reply.status).toBe(200);
    expectSecurityHeaders(reply.headers);
  });

  it('sends them with a static file, its content headers intact', async () => {
    const reply = await requestServer('GET', '/admin');

    expect(reply.status).toBe(200);
    expect(reply.headers['content-type']).toContain('text/html');
    expect(reply.headers['cache-control']).toBe('no-cache, must-revalidate');
    expectSecurityHeaders(reply.headers);
  });

  it('sends them with an error response', async () => {
    const reply = await requestServer('GET', '/healthz', { hostHeader: () => 'evil.example' });

    expect(reply.status).toBe(403);
    expectSecurityHeaders(reply.headers);
  });

  it('sends them with a 404', async () => {
    const reply = await requestServer('GET', '/api/does-not-exist');

    expect(reply.status).toBe(404);
    expectSecurityHeaders(reply.headers);
  });

  it('sends them with an SSE stream, its stream headers intact', async () => {
    const reply = await requestServer('GET', '/api/visualizer', {
      addVisualizerClient: (res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
        res.end();
      },
    });

    expect(reply.headers['content-type']).toContain('text/event-stream');
    expectSecurityHeaders(reply.headers);
  });
});

type HeadersForPort = (port: number) => Record<string, string>;

describe('POST Origin gate', () => {
  const shuffle = (headers: HeadersForPort): Promise<ServerReply> =>
    requestServer('POST', '/api/controls/shuffle', { headers: (port) => ({ ...JSON_HEADERS, ...headers(port) }), body: '{}' });

  it.each<[string, HeadersForPort]>([
    ['a foreign Origin', () => ({ Origin: 'http://evil.example' })],
    ['an Origin on another port', () => ({ Origin: 'http://127.0.0.1:1' })],
    ['an Origin with another scheme', (port) => ({ Origin: `https://127.0.0.1:${port}` })],
    ['an Origin of null', () => ({ Origin: 'null' })],
    ['Sec-Fetch-Site cross-site', () => ({ 'Sec-Fetch-Site': 'cross-site' })],
    ['Sec-Fetch-Site same-site', () => ({ 'Sec-Fetch-Site': 'same-site' })],
    ['its own Origin with Sec-Fetch-Site cross-site', (port) => ({ Origin: `http://127.0.0.1:${port}`, 'Sec-Fetch-Site': 'cross-site' })],
  ])('refuses a POST with %s with 403 and runs no handler', async (_label, headers) => {
    const reply = await shuffle(headers);

    expect(reply.status).toBe(403);
    expect(JSON.parse(reply.body)).toEqual({ error: 'Cross-origin request refused' });
    expect(shuffleQueueFromTop).not.toHaveBeenCalled();
  });

  it.each<[string, HeadersForPort]>([
    ['its own Origin', (port) => ({ Origin: `http://127.0.0.1:${port}` })],
    ['its own Origin with an upper-case scheme', (port) => ({ Origin: `HTTP://127.0.0.1:${port}` })],
    ['its own Origin with Sec-Fetch-Site same-origin', (port) => ({ Origin: `http://127.0.0.1:${port}`, 'Sec-Fetch-Site': 'same-origin' })],
    ['Sec-Fetch-Site none', () => ({ 'Sec-Fetch-Site': 'none' })],
    ['neither header, as a non-browser client sends', () => ({})],
  ])('accepts a POST with %s', async (_label, headers) => {
    vi.mocked(shuffleQueueFromTop).mockResolvedValue({ success: true });

    const reply = await shuffle(headers);

    expect(reply.status).toBe(200);
  });

  it('leaves a GET with a foreign Origin to the route', async () => {
    const reply = await requestServer('GET', '/healthz', { headers: { Origin: 'http://evil.example' } });

    expect(reply.status).toBe(200);
  });
});

interface FakeReply {
  status: number | undefined;
  headers: Record<string, string>;
  body: string;
}

interface DispatchOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  headers?: Record<string, string>;
  shutdown?: () => void;
}

/** A real socket here is always loopback, so a fake request carries the chosen peer address. */
async function dispatchFrom(
  remoteAddress: string,
  path: string,
  config: Config,
  host: string,
  options: DispatchOptions = {},
): Promise<FakeReply> {
  const reply: FakeReply = { status: undefined, headers: {}, body: '' };
  const bodyChunks = options.body === undefined ? [] : [Buffer.from(JSON.stringify(options.body))];
  const req = fakeReq(remoteAddress, bodyChunks, host);
  req.url = path;
  req.method = options.method ?? 'GET';
  if (options.body !== undefined) req.headers['content-type'] = 'application/json';
  Object.assign(req.headers, options.headers);
  const res = {
    headersSent: false,
    writableEnded: false,
    setHeader(name: string, value: string): ServerResponse {
      reply.headers[name.toLowerCase()] = value;
      return res;
    },
    writeHead(code: number, headers: Record<string, string> = {}): ServerResponse {
      reply.status = code;
      for (const [name, value] of Object.entries(headers)) reply.headers[name.toLowerCase()] = value;
      return res;
    },
    end(chunk?: string): void {
      if (typeof chunk === 'string') reply.body += chunk;
    },
  } as unknown as ServerResponse;
  createServer({
    config,
    client: {} as never,
    broadcaster: { broadcastNow: vi.fn() } as never,
    visualizer: { addClient: vi.fn() },
    shutdown: options.shutdown ?? ((): void => undefined),
    leases: { open: () => undefined, close: () => undefined },
    auth: new AuthService(config),
    guests: new GuestQueue(),
  }).emit('request', req, res);
  await vi.waitFor(() => expect(reply.status).toBeDefined());
  return reply;
}

describe('public sources without access control', () => {
  const LAN_BIND = configWith({ expose: true, host: '0.0.0.0' });

  it.each([INTERNET_PEER, '::ffff:203.0.113.5', '2001:db8::1'])(
    'refuses the internet peer %s with 403 and the refusal message',
    async (peer) => {
      const reply = await dispatchFrom(peer, '/api/player-state', LAN_BIND, '192.168.1.20:8808');

      expect(reply.status).toBe(403);
      expect((JSON.parse(reply.body) as { error: string }).error).toContain('refuses internet addresses');
      expectSecurityHeaders(reply.headers);
    },
  );

  it.each([LAN_PEER, '10.0.0.8', 'fe80::1', LOOPBACK])('serves the local peer %s as before', async (peer) => {
    const reply = await dispatchFrom(peer, '/api/player-state', LAN_BIND, '192.168.1.20:8808');

    expect(reply.status).toBe(200);
  });
});

describe('GET /api/cover caching', () => {
  it('marks a cover private, so a shared cache never stores it', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue({
      ok: true,
      status: 200,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([0xff, 0xd8, 0xff]));
          controller.close();
        },
      }),
      headers: { get: (name: string): string | null => (name.toLowerCase() === 'content-type' ? 'image/jpeg' : null) },
    } as unknown as Response);

    const reply = await requestServer('GET', '/api/cover/album123');

    expect(reply.status).toBe(200);
    expect(reply.headers['cache-control']).toBe('private, max-age=86400');
  });
});

describe('join path responses', () => {
  it('redirects / with no-store, so a browser never reuses a landing page another session chose', async () => {
    const reply = await requestServer('GET', '/');

    expect(reply.status).toBe(302);
    expect(reply.headers['location']).toBe('/admin');
    expect(reply.headers['cache-control']).toBe('no-store');
    expectSecurityHeaders(reply.headers);
  });

  it.each(['/guest', '/guest.html'])('serves the guest page at %s with no-store and noindex', async (path) => {
    const reply = await requestServer('GET', path);

    expect(reply.status).toBe(200);
    expect(reply.headers['content-type']).toContain('text/html');
    expect(reply.headers['cache-control']).toBe('no-store');
    expect(reply.headers['x-robots-tag']).toBe('noindex');
    expect(reply.body).toContain('/guest.js');
  });

  it('serves a robots.txt that disallows everything', async () => {
    const reply = await requestServer('GET', '/robots.txt');

    expect(reply.status).toBe(200);
    expect(reply.headers['content-type']).toContain('text/plain');
    expect(reply.body).toMatch(/User-agent: \*\s+Disallow: \/\s*$/);
  });

  it('marks the join answer noindex and no-store even in mode none, where it answers 404', async () => {
    const reply = await requestServer('POST', '/api/auth/join', { headers: JSON_HEADERS, body: JSON.stringify({ key: 'k' }) });

    expect(reply.status).toBe(404);
    expect(reply.headers['cache-control']).toBe('no-store');
    expect(reply.headers['x-robots-tag']).toBe('noindex');
  });
});
