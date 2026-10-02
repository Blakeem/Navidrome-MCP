/**
 * Regression coverage for the loopback-gated privileged web-UI routes and the
 * cover-art content-type allowlist. These surfaces are security-relevant and
 * previously had zero tests:
 *
 *  - health.ts     — /healthz must 404 (hide its version fingerprint) for any
 *                    non-loopback peer whenever the server is LAN-reachable,
 *                    which is true for BOTH `expose=true` AND a wildcard
 *                    `host==='0.0.0.0'` bind (the latter regressed before).
 *  - player.ts     — settings/shutdown routes must reject non-loopback peers
 *                    with 404, and the settings writer must merge (never
 *                    clobber) unrelated `webui` keys and other stored settings
 *                    (credentials included).
 *  - cover.ts      — a 200 upstream with a non-allowlisted content-type must be
 *                    rejected (stored-XSS defense) and its body cancelled so the
 *                    fetch connection is released.
 *  - server.ts       POST /api/controls/shuffle must reach the from-the-top
 *                    shuffle through the dispatcher. A POST without a JSON
 *                    Content-Type gets 415, and a loopback bind rejects a
 *                    foreign Host header with 403 (DNS rebinding).
 *  - controls.ts     an invalid seek, volume or play-index body is a 400.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Config } from '../../../src/config.js';
import type { SettingsFile } from '../../../src/config/store.js';
import { makeTestConfig } from '../../helpers/test-config.js';

// Mock the settings store: keep the REAL SettingsFileSchema (player.ts validates
// the merged object against it before writing) but stub the disk I/O so tests
// neither read nor write the real store.
vi.mock('../../../src/config/store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/config/store.js')>();
  return { ...actual, readSettings: vi.fn(), writeSettings: vi.fn() };
});

// Mock the live flags so the response is deterministic and each setter is observable.
vi.mock('../../../src/web/player-runtime.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/web/player-runtime.js')>();
  return {
    ...actual,
    getPersist: vi.fn(() => false),
    setPersist: vi.fn(),
    getTheme: vi.fn(() => null),
    setTheme: vi.fn(),
  };
});

// Mock the network fetch used by the cover proxy so no real HTTP is issued.
vi.mock('../../../src/utils/fetch-with-timeout.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/utils/fetch-with-timeout.js')>();
  return {
    ...actual,
    fetchWithTimeout: vi.fn(),
    getNavidromeRequestTimeoutMs: vi.fn(() => 5000),
  };
});

// Mock the control impls so the route tests never reach mpv IPC.
vi.mock('../../../src/tools/playback.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/tools/playback.js')>();
  return {
    ...actual,
    shuffleQueueFromTop: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    playQueueIndex: vi.fn(),
  };
});

import { readSettings, writeSettings } from '../../../src/config/store.js';
import { getPersist, setPersist, setTheme } from '../../../src/web/player-runtime.js';
import { fetchWithTimeout } from '../../../src/utils/fetch-with-timeout.js';
import { HEALTH_APP_ID, handleHealth } from '../../../src/webui/routes/health.js';
import {
  handleGetPlayerSettings,
  handleSetPlayerSettings,
  handleShutdown,
} from '../../../src/webui/routes/player.js';
import { handleCover } from '../../../src/webui/routes/cover.js';
import { handlePlayQueueIndex, handleSeek, handleVolume } from '../../../src/webui/routes/controls.js';
import { handleNetworkInfo } from '../../../src/webui/routes/network-info.js';
import { isLanReachable } from '../../../src/webui/network.js';
import { playQueueIndex, seek, setVolume, shuffleQueueFromTop } from '../../../src/tools/playback.js';
import { createServer } from '../../../src/webui/server.js';

/** Capture status + body written to a ServerResponse without a real socket. */
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

/** IncomingMessage stand-in with a fixed peer address and an optional JSON body. */
function fakeReq(remoteAddress: string, bodyChunks: Buffer[] = []): IncomingMessage {
  const emitter = new EventEmitter() as IncomingMessage & {
    socket: { remoteAddress: string };
  };
  emitter.socket = { remoteAddress } as never;
  queueMicrotask(() => {
    for (const c of bodyChunks) emitter.emit('data', c);
    emitter.emit('end');
  });
  return emitter;
}

function configWith(webui: { expose: boolean; host: string }): Config {
  return makeTestConfig({
    webui: {
      enabled: true,
      host: webui.host,
      port: 8808,
      expose: webui.expose,
      autoOpenBrowser: false,
      persistAfterMcpExit: false,
      theme: null,
    },
  });
}

function fakeBroadcaster(): { broadcastNow: ReturnType<typeof vi.fn> } {
  return { broadcastNow: vi.fn() };
}

const LOOPBACK = '127.0.0.1';
const LAN_PEER = '203.0.113.5';

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
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
    // Regression guard: a 0.0.0.0 bind is LAN-reachable even with expose=false,
    // so the version fingerprint must still be gated to loopback.
    const cap = fakeRes();
    handleHealth(fakeReq(LAN_PEER), cap.res, configWith({ expose: false, host: '0.0.0.0' }));
    expect(cap.status()).toBe(404);
  });

  it('serves 200 to a loopback peer on a wildcard bind (host=0.0.0.0)', () => {
    const cap = fakeRes();
    handleHealth(fakeReq('::1'), cap.res, configWith({ expose: false, host: '0.0.0.0' }));
    expect(cap.status()).toBe(200);
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

  it('reports lanReachable for an IPv6 wildcard bind with expose=false', () => {
    const cap = fakeRes();
    handleNetworkInfo(cap.res, configWith({ expose: false, host: '::' }));
    expect(cap.json()).toMatchObject({ lanReachable: true });
  });
});

describe('player routes reject non-loopback peers', () => {
  it('handleGetPlayerSettings returns 404 to a LAN peer without reading the store', () => {
    const cap = fakeRes();
    handleGetPlayerSettings(fakeReq(LAN_PEER), cap.res);
    expect(cap.status()).toBe(404);
    expect(readSettings).not.toHaveBeenCalled();
  });

  it('handleSetPlayerSettings returns 404 to a LAN peer and never writes', async () => {
    const cap = fakeRes();
    await handleSetPlayerSettings(
      fakeReq(LAN_PEER, [Buffer.from(JSON.stringify({ autoOpenBrowser: true }))]),
      cap.res,
      fakeBroadcaster(),
    );
    expect(cap.status()).toBe(404);
    expect(setPersist).not.toHaveBeenCalled();
    expect(writeSettings).not.toHaveBeenCalled();
  });

  it('handleShutdown returns 404 to a LAN peer and never invokes the shutdown callback', () => {
    const cap = fakeRes();
    const shutdown = vi.fn();
    handleShutdown(fakeReq(LAN_PEER), cap.res, shutdown);
    expect(cap.status()).toBe(404);
    expect(shutdown).not.toHaveBeenCalled();
  });

  it('handleShutdown accepts a loopback peer (200) and defers the callback', () => {
    vi.useFakeTimers();
    const cap = fakeRes();
    const shutdown = vi.fn();
    handleShutdown(fakeReq(LOOPBACK), cap.res, shutdown);
    expect(cap.status()).toBe(200);
    expect(shutdown).not.toHaveBeenCalled(); // deferred, not synchronous
    vi.advanceTimersByTime(50);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });
});

describe('handleSetPlayerSettings input validation', () => {
  it.each([
    ['a wrongly typed field', { persistAfterMcpExit: 'yes' }],
    ['an unknown key', { autoOpenBrowser: true, volume: 50 }],
    ['an array body', [1]],
  ])('rejects %s with 400 and applies nothing', async (_label, body) => {
    const cap = fakeRes();
    await handleSetPlayerSettings(fakeReq(LOOPBACK, [Buffer.from(JSON.stringify(body))]), cap.res, fakeBroadcaster());
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
    vi.mocked(readSettings).mockReturnValue(stored);
    let written: SettingsFile | undefined;
    vi.mocked(writeSettings).mockImplementation((s) => {
      written = s;
    });

    const cap = fakeRes();
    await handleSetPlayerSettings(
      fakeReq(LOOPBACK, [Buffer.from(JSON.stringify({ autoOpenBrowser: true }))]),
      cap.res,
      fakeBroadcaster(),
    );

    expect(cap.status()).toBe(200);
    expect(writeSettings).toHaveBeenCalledTimes(1);
    // The one touched key changed...
    expect(written?.webui?.autoOpenBrowser).toBe(true);
    // ...while every unrelated key survived the read-merge-write.
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
});

describe('handleSetPlayerSettings theme', () => {
  it('applies the theme live, persists it, and broadcasts it to every remote', async () => {
    vi.mocked(readSettings).mockReturnValue({
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
      broadcaster,
    );

    expect(cap.status()).toBe(200);
    expect(setTheme).toHaveBeenCalledWith('dark');
    expect(written?.webui?.theme).toBe('dark');
    expect(written?.webui?.persistAfterMcpExit).toBe(true);
    expect(broadcaster.broadcastNow).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown theme with 400 and changes nothing', async () => {
    const broadcaster = fakeBroadcaster();
    const cap = fakeRes();
    await handleSetPlayerSettings(
      fakeReq(LOOPBACK, [Buffer.from(JSON.stringify({ theme: 'blue' }))]),
      cap.res,
      broadcaster,
    );

    expect(cap.status()).toBe(400);
    expect(setTheme).not.toHaveBeenCalled();
    expect(writeSettings).not.toHaveBeenCalled();
    expect(broadcaster.broadcastNow).not.toHaveBeenCalled();
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
    // The rejected upstream stream must be released, not leaked.
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe('handleCover size parameter', () => {
  /** Run the handler against a 404 upstream and return the upstream URL it requested. */
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
  /** Builds the Host header from the ephemeral port. Defaults to `127.0.0.1:<port>`. */
  hostHeader?: (port: number) => string;
  headers?: Record<string, string>;
  body?: string;
}

interface ServerReply {
  status: number;
  body: string;
  /** False when the server aborted the response before its final chunk. */
  complete: boolean;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** Send one request through a live dispatcher on an ephemeral loopback port. */
async function requestServer(method: string, path: string, options: ServerRequestOptions = {}): Promise<ServerReply> {
  const config = configWith({ expose: false, host: options.bindHost ?? '127.0.0.1' });
  if (options.configuredPort !== undefined) config.webui.port = options.configuredPort;
  const server = createServer({
    config,
    client: {} as never,
    broadcaster: {} as never,
    shutdown: () => undefined,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const headers = { Host: options.hostHeader?.(port) ?? `127.0.0.1:${port}`, ...options.headers };
    return await new Promise((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path, method, headers }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('error', () => undefined);
        res.on('close', () => {
          resolve({ status: res.statusCode ?? 0, body, complete: res.complete });
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

  it('accepts any Host on a non-loopback bind', async () => {
    const reply = await requestServer('GET', '/healthz', {
      bindHost: '0.0.0.0',
      hostHeader: (port) => `evil.example:${port}`,
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
