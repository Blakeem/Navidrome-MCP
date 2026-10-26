/**
 * /api/settings/test only receives inputs that fail before a request leaves the process,
 * such as a validation failure or a URL that carries credentials, so no test reaches the network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startConfigServer } from '../../../src/config-app/server.js';
import { readSettings } from '../../../src/config/store.js';
import { WEBUI_AUTH_MODES } from '../../../src/constants/defaults.js';
import { verifyPassword } from '../../../src/utils/secrets.js';
import { probeAudioDevices } from '../../../src/services/playback/audio-devices.js';
import { resolveMpvBinary } from '../../../src/services/playback/mpv-process.js';

// The audio device route would otherwise shell out to a real mpv.
vi.mock('../../../src/services/playback/audio-devices.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/services/playback/audio-devices.js')>();
  return { ...actual, probeAudioDevices: vi.fn() };
});
vi.mock('../../../src/services/playback/mpv-process.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/services/playback/mpv-process.js')>();
  return { ...actual, resolveMpvBinary: vi.fn(() => null) };
});

// A test sets this to stand in for a Node.js whose OpenSSL lacks Argon2.
const argon2Failure = vi.hoisted(() => ({ current: null as Error | null }));
vi.mock('../../../src/utils/secrets.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/utils/secrets.js')>();
  const failOr = <T>(run: () => Promise<T>): Promise<T> =>
    argon2Failure.current === null ? run() : Promise.reject(argon2Failure.current);
  return {
    ...actual,
    assertArgon2Available: vi.fn(() => failOr(actual.assertArgon2Available)),
    hashPassword: vi.fn((password: string) => failOr(() => actual.hashPassword(password))),
  };
});

const MASK = '********';

describe('settings server seed/save', () => {
  let dir: string;
  let file: string;
  const saved: Record<string, string | undefined> = {};
  let server: { url: string; close: () => Promise<void> } | null = null;

  beforeEach(() => {
    for (const k of ['NAVIDROME_CONFIG_PATH', 'NAVIDROME_URL', 'NAVIDROME_USERNAME', 'NAVIDROME_PASSWORD']) {
      saved[k] = process.env[k];
    }
    dir = mkdtempSync(join(tmpdir(), 'nd-srv-'));
    file = join(dir, 'settings.json');
    process.env['NAVIDROME_CONFIG_PATH'] = file;
  });

  afterEach(async () => {
    vi.clearAllMocks();
    if (server) { await server.close(); server = null; }
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  async function start(options?: { idleTimeoutMs?: number; onIdleTimeout?: () => void }): Promise<string> {
    server = await startConfigServer(options);
    return server.url.replace(/\/$/, '');
  }

  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  const getJson = async (r: Response): Promise<any> => r.json();
  const post = (base: string, body: unknown): Promise<Response> =>
    fetch(`${base}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('masks the password in the seed response', async () => {
    writeFileSync(file, JSON.stringify({ navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' } }));
    const base = await start();
    const seed = await getJson(await fetch(`${base}/api/settings/seed`));
    expect(seed.navidrome.password).toBe(MASK);
    expect(seed.navidrome.url).toBe('http://h:4533');
  });

  it('masks the MCP auth token in the seed response', async () => {
    writeFileSync(file, JSON.stringify({
      navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' },
      transport: { authToken: 'tok-secret' },
    }));
    const base = await start();
    const seed = await getJson(await fetch(`${base}/api/settings/seed`));
    expect(seed.transport.authToken).toBe(MASK);
  });

  it('keeps the stored MCP auth token when the form re-submits the mask sentinel', async () => {
    writeFileSync(file, JSON.stringify({
      navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' },
      transport: { authToken: 'tok-secret' },
    }));
    const base = await start();
    const res = await post(base, {
      navidrome: { url: 'http://h:4533', username: 'u', password: MASK },
      transport: { authToken: MASK },
    });
    expect(res.status).toBe(200);
    expect(readSettings()?.transport?.authToken).toBe('tok-secret');
  });

  it('serves recommended values for the optional radio/lyrics fields', async () => {
    const base = await start();
    const sug = await getJson(await fetch(`${base}/api/settings/suggestions`));
    expect(sug['features.radioBrowserUserAgent']).toBe('Navidrome-MCP');
    expect(sug['features.lyricsProvider']).toBe('lrclib');
    expect(sug['features.lrclibUserAgent']).toBe('Navidrome-MCP');
    expect(sug['features.lrclibBase']).toBe('https://lrclib.net');
    // A blank radio base selects a mirror by SRV lookup, so the form suggests none.
    expect(sug['features.radioBrowserBase']).toBeUndefined();
  });

  it('keeps the stored password when the form re-submits the mask sentinel', async () => {
    writeFileSync(file, JSON.stringify({ navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' } }));
    const base = await start();
    const res = await post(base, { navidrome: { url: 'http://h:4533', username: 'u', password: MASK } });
    expect(res.status).toBe(200);
    expect(readSettings()?.navidrome?.password).toBe('secret');
  });

  it('keeps the stored player theme, which the form does not carry', async () => {
    writeFileSync(file, JSON.stringify({
      navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' },
      webui: { theme: 'dark' },
    }));
    const base = await start();
    const res = await post(base, { navidrome: { url: 'http://h:4533', username: 'u', password: MASK }, webui: { expose: true } });
    expect(res.status).toBe(200);
    expect(readSettings()?.webui).toMatchObject({ expose: true, theme: 'dark' });
  });

  it('keeps a stored top-level key and the player theme, which the form does not post', async () => {
    writeFileSync(file, JSON.stringify({
      navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' },
      webui: { theme: 'light', port: 8808 },
      handAdded: { note: 'kept' },
    }));
    const base = await start();
    const res = await post(base, { navidrome: { url: 'http://h:4533', username: 'u', password: MASK }, webui: { port: 9000 } });
    expect(res.status).toBe(200);
    const after = readSettings();
    expect(after?.['handAdded']).toEqual({ note: 'kept' });
    expect(after?.webui).toEqual({ theme: 'light', port: 9000 });
  });

  it('keeps stored nested keys the settings schema does not know', async () => {
    writeFileSync(file, JSON.stringify({
      navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' },
      playback: { outputHint: 'kept' },
      webui: { port: 8808, note: 'kept', auth: { enabled: true } },
    }));
    const base = await start();
    const res = await post(base, { navidrome: { url: 'http://h:4533', username: 'u', password: MASK }, webui: { port: 9000 } });
    expect(res.status).toBe(200);
    const written = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(written['playback']).toEqual({ outputHint: 'kept' });
    expect(written['webui']).toEqual({ port: 9000, note: 'kept', auth: { enabled: true } });
  });

  it('keeps a cleared field cleared and replaces a stored value with a posted one', async () => {
    writeFileSync(file, JSON.stringify({
      navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' },
      transport: { allowedHosts: ['mcp.example.com'], port: 3000 },
      features: { lastFmApiKey: 'lastfm-secret', lrclibBase: 'https://old.example' },
    }));
    const base = await start();
    const res = await post(base, {
      navidrome: { url: 'http://new:4533', username: 'u', password: MASK },
      transport: { allowedHosts: [] },
      features: { lastFmApiKey: null, lrclibBase: 'https://new.example' },
    });
    expect(res.status).toBe(200);
    const after = readSettings();
    expect(after?.navidrome?.url).toBe('http://new:4533');
    expect(after?.transport).toEqual({ allowedHosts: [], port: 3000 });
    expect(after?.features).toEqual({ lastFmApiKey: null, lrclibBase: 'https://new.example' });
  });

  it('lists the probed audio devices narrowed to one driver, using the stored mpv path', async () => {
    writeFileSync(file, JSON.stringify({
      navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' },
      playback: { mpvPath: '/opt/mpv/mpv' },
    }));
    vi.mocked(resolveMpvBinary).mockReturnValue('/opt/mpv/mpv');
    vi.mocked(probeAudioDevices).mockResolvedValue([
      { id: 'auto', name: 'Autoselect device' },
      { id: 'wasapi/{a}', name: 'Speakers' },
      { id: 'openal/Speakers', name: 'Speakers (OpenAL)' },
      { id: 'wasapi/{b}', name: 'Headphones' },
    ]);
    const base = await start();
    const res = await fetch(`${base}/api/settings/audio-devices`);
    expect(res.status).toBe(200);
    expect(await getJson(res)).toEqual({
      devices: [
        { id: 'auto', name: 'Autoselect device' },
        { id: 'wasapi/{a}', name: 'Speakers' },
        { id: 'wasapi/{b}', name: 'Headphones' },
      ],
    });
    expect(resolveMpvBinary).toHaveBeenCalledWith('/opt/mpv/mpv');
    expect(probeAudioDevices).toHaveBeenCalledWith('/opt/mpv/mpv');
  });

  it("narrows the probed audio devices to the saved device's driver", async () => {
    writeFileSync(file, JSON.stringify({
      navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' },
      playback: { audioDevice: { id: 'openal/Speakers', name: 'Speakers (OpenAL)' } },
    }));
    vi.mocked(resolveMpvBinary).mockReturnValue('/usr/bin/mpv');
    vi.mocked(probeAudioDevices).mockResolvedValue([
      { id: 'auto', name: 'System default' },
      { id: 'wasapi/{a}', name: 'Speakers' },
      { id: 'openal/Speakers', name: 'Speakers (OpenAL)' },
    ]);
    const base = await start();
    const res = await fetch(`${base}/api/settings/audio-devices`);
    expect(await getJson(res)).toEqual({
      devices: [
        { id: 'auto', name: 'System default' },
        { id: 'openal/Speakers', name: 'Speakers (OpenAL)' },
      ],
    });
  });

  it('answers an empty audio device list with a message when no mpv is found', async () => {
    vi.mocked(resolveMpvBinary).mockReturnValue(null);
    const base = await start();
    const res = await fetch(`${base}/api/settings/audio-devices`);
    expect(res.status).toBe(200);
    expect(await getJson(res)).toEqual({ devices: [], message: 'mpv was not found' });
    expect(probeAudioDevices).not.toHaveBeenCalled();
  });

  it('answers an empty audio device list with the error text when the probe fails', async () => {
    vi.mocked(resolveMpvBinary).mockReturnValue('/usr/bin/mpv');
    vi.mocked(probeAudioDevices).mockRejectedValue(new Error('mpv audio device probe exited with code 1'));
    const base = await start();
    const res = await fetch(`${base}/api/settings/audio-devices`);
    expect(res.status).toBe(200);
    expect(await getJson(res)).toEqual({ devices: [], message: 'mpv audio device probe exited with code 1' });
  });

  it('stores a posted audio device and clears it when the form posts null', async () => {
    writeFileSync(file, JSON.stringify({
      navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' },
      playback: { audioDevice: { id: 'wasapi/{old}', name: 'Old speakers' }, mpvPath: '/opt/mpv/mpv' },
    }));
    const base = await start();
    const navidrome = { url: 'http://h:4533', username: 'u', password: MASK };

    const chosen = await post(base, { navidrome, playback: { audioDevice: { id: 'wasapi/{b}', name: null } } });
    expect(chosen.status).toBe(200);
    expect(readSettings()?.playback).toEqual({ audioDevice: { id: 'wasapi/{b}', name: null }, mpvPath: '/opt/mpv/mpv' });

    const cleared = await post(base, { navidrome, playback: { audioDevice: null } });
    expect(cleared.status).toBe(200);
    expect(readSettings()?.playback).toEqual({ audioDevice: null, mpvPath: '/opt/mpv/mpv' });
  });

  it('masks the Last.fm API key in the seed response', async () => {
    writeFileSync(file, JSON.stringify({
      navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' },
      features: { lastFmApiKey: 'lastfm-secret' },
    }));
    const base = await start();
    const seed = await getJson(await fetch(`${base}/api/settings/seed`));
    expect(seed.features.lastFmApiKey).toBe(MASK);
  });

  it('keeps the stored Last.fm API key when the form re-submits the mask sentinel', async () => {
    writeFileSync(file, JSON.stringify({
      navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' },
      features: { lastFmApiKey: 'lastfm-secret' },
    }));
    const base = await start();
    const res = await post(base, {
      navidrome: { url: 'http://h:4533', username: 'u', password: MASK },
      features: { lastFmApiKey: MASK },
    });
    expect(res.status).toBe(200);
    expect(readSettings()?.features?.lastFmApiKey).toBe('lastfm-secret');
  });

  it('stores a new Last.fm API key posted by the form', async () => {
    writeFileSync(file, JSON.stringify({
      navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' },
      features: { lastFmApiKey: 'lastfm-secret' },
    }));
    const base = await start();
    const res = await post(base, {
      navidrome: { url: 'http://h:4533', username: 'u', password: MASK },
      features: { lastFmApiKey: 'lastfm-new' },
    });
    expect(res.status).toBe(200);
    expect(readSettings()?.features?.lastFmApiKey).toBe('lastfm-new');
  });

  it('rejects an unsupported web host and writes nothing', async () => {
    const base = await start();
    const res = await post(base, {
      navidrome: { url: 'http://h:4533', username: 'u', password: 'p' },
      webui: { host: '192.168.1.20' },
    });
    expect(res.status).toBe(400);
    expect((await getJson(res)).error).toMatch(/webui\.host: "192\.168\.1\.20" is not supported/);
    expect(readSettings()).toBeNull();
  });

  it('rejects a web TLS pair with only one path set and writes nothing', async () => {
    const base = await start();
    const res = await post(base, {
      navidrome: { url: 'http://h:4533', username: 'u', password: 'p' },
      webui: { tls: { certPath: '/etc/ssl/full.pem', keyPath: null } },
    });
    expect(res.status).toBe(400);
    expect((await getJson(res)).error).toMatch(/webui.tls: Set both certPath and keyPath/);
    expect(readSettings()).toBeNull();
  });

  it('saves a web TLS pair with both paths set', async () => {
    const base = await start();
    const tls = { certPath: '/etc/ssl/full.pem', keyPath: '/etc/ssl/key.pem' };
    const res = await post(base, { navidrome: { url: 'http://h:4533', username: 'u', password: 'p' }, webui: { tls } });
    expect(res.status).toBe(200);
    expect(readSettings()?.webui?.tls).toEqual(tls);
  });

  it('rejects a public URL with a path and writes nothing', async () => {
    const base = await start();
    const res = await post(base, {
      navidrome: { url: 'http://h:4533', username: 'u', password: 'p' },
      webui: { publicUrl: 'https://jukebox.example.org/guest' },
    });
    expect(res.status).toBe(400);
    expect((await getJson(res)).error).toMatch(/webui\.publicUrl: Must be an http/);
    expect(readSettings()).toBeNull();
  });

  it('saves a public URL with no path', async () => {
    const base = await start();
    const res = await post(base, {
      navidrome: { url: 'http://h:4533', username: 'u', password: 'p' },
      webui: { publicUrl: 'https://jukebox.example.org:8808', tls: { certPath: '/etc/ssl/full.pem', keyPath: '/etc/ssl/key.pem' } },
    });
    expect(res.status).toBe(200);
    expect(readSettings()?.webui?.publicUrl).toBe('https://jukebox.example.org:8808');
  });

  it('saves a guest song limit, and rejects one outside 1 to 20 without writing', async () => {
    const base = await start();
    const navidrome = { url: 'http://h:4533', username: 'u', password: 'p' };

    const rejected = await post(base, { navidrome, jukebox: { guestQueueLimit: 25 } });
    expect(rejected.status).toBe(400);
    expect((await getJson(rejected)).error).toMatch(/jukebox\.guestQueueLimit: Must be a whole number from 1 to 20/);
    expect(readSettings()).toBeNull();

    const saved = await post(base, { navidrome, jukebox: { guestQueueLimit: 5 } });
    expect(saved.status).toBe(200);
    expect(readSettings()?.jukebox?.guestQueueLimit).toBe(5);
  });

  it('rejects an https:// public URL on an HTTP player and writes nothing', async () => {
    const base = await start();
    const res = await post(base, {
      navidrome: { url: 'http://h:4533', username: 'u', password: 'p' },
      webui: { publicUrl: 'https://jukebox.example.org:8808' },
    });
    expect(res.status).toBe(400);
    expect((await getJson(res)).error).toMatch(/webui\.publicUrl: Must start with https:\/\//);
    expect(readSettings()).toBeNull();
  });

  it('drops a legacy stored theme on save', async () => {
    writeFileSync(file, JSON.stringify({
      navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' },
      webui: { theme: 'system' },
    }));
    const base = await start();
    const res = await post(base, { navidrome: { url: 'http://h:4533', username: 'u', password: MASK } });
    expect(res.status).toBe(200);
    expect(readSettings()?.webui?.theme).toBeUndefined();
  });

  it('persists an explicitly changed password', async () => {
    writeFileSync(file, JSON.stringify({ navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' } }));
    const base = await start();
    const res = await post(base, { navidrome: { url: 'http://h:4533', username: 'u', password: 'newpass' } });
    expect(res.status).toBe(200);
    expect(readSettings()?.navidrome?.password).toBe('newpass');
  });

  // With no store, env supplies the seed password, so a saved mask sentinel must resolve to it.
  it('un-masks from the env seed on first run (no store yet)', async () => {
    process.env['NAVIDROME_URL'] = 'http://first:4533';
    process.env['NAVIDROME_USERNAME'] = 'firstuser';
    process.env['NAVIDROME_PASSWORD'] = 'firstrunpass';
    const base = await start();
    const res = await post(base, { navidrome: { url: 'http://first:4533', username: 'firstuser', password: MASK } });
    expect(res.status).toBe(200);
    expect(readSettings()?.navidrome?.password).toBe('firstrunpass');
  });

  it('backs up an unreadable store before a save replaces it', async () => {
    const original = '{"navidrome": {},}';
    writeFileSync(file, original);
    const base = await start();
    const res = await post(base, { navidrome: { url: 'http://h:4533', username: 'u', password: 'p' } });
    expect(res.status).toBe(200);
    expect(readFileSync(`${file}.bak`, 'utf8')).toBe(original);
    expect((await getJson(res)).message).toContain(`kept as ${file}.bak`);
    expect(readSettings()?.navidrome?.url).toBe('http://h:4533');
  });

  it('keeps no backup when the store was usable', async () => {
    writeFileSync(file, JSON.stringify({ navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' } }));
    const base = await start();
    const res = await post(base, { navidrome: { url: 'http://h:4533', username: 'u', password: MASK } });
    expect(res.status).toBe(200);
    expect(existsSync(`${file}.bak`)).toBe(false);
  });

  it('rejects a save that would not satisfy the runtime config', async () => {
    const base = await start();
    const res = await post(base, { navidrome: { url: '', username: 'u', password: 'p' } });
    expect(res.status).toBe(400);
  });

  it('reports every validation issue on Test connection, in the Save format', async () => {
    const base = await start();
    const res = await fetch(`${base}/api/settings/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ navidrome: { url: '', username: '', password: 'p' } }),
    });
    const body = await getJson(res);
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Configuration validation failed');
    expect(body.error).toContain('navidromeUrl: Navidrome URL must be a valid URL');
    expect(body.error).toContain('navidromeUsername: Navidrome username is required');
  });

  // fetch rejects a URL with credentials before any network I/O and echoes it in the error.
  it('redacts URL credentials from a failed Test connection', async () => {
    const base = await start();
    const res = await fetch(`${base}/api/settings/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ navidrome: { url: 'http://u:hunter2@127.0.0.1:1', username: 'u', password: 'p' } }),
    });
    const body = await getJson(res);
    expect(body.ok).toBe(false);
    expect(body.error).not.toContain('hunter2');
    expect(body.error).toContain('<REDACTED>');
  });

  it('rejects a text/plain POST with 415 and leaves the store unchanged', async () => {
    const stored = { navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' } };
    writeFileSync(file, JSON.stringify(stored));
    const base = await start();
    const res = await fetch(`${base}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ navidrome: { url: 'http://attacker.example', username: 'u', password: MASK } }),
    });
    expect(res.status).toBe(415);
    expect(readSettings()).toEqual(stored);
  });

  it('rejects a POST from a foreign Origin with 403 and leaves the store unchanged', async () => {
    const stored = { navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' } };
    writeFileSync(file, JSON.stringify(stored));
    const base = await start();
    const res = await fetch(`${base}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://attacker.example' },
      body: JSON.stringify({ navidrome: { url: 'http://attacker.example', username: 'u', password: MASK } }),
    });
    expect(res.status).toBe(403);
    expect(readSettings()).toEqual(stored);
  });

  it('rejects a non-loopback Host header with 403', async () => {
    const base = await start();
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(`${base}/api/settings/seed`, { headers: { Host: 'attacker.example' } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it('rejects a loopback request relayed by a same-host proxy with 403', async () => {
    const base = await start();
    const res = await fetch(`${base}/api/settings/seed`, { headers: { 'X-Forwarded-For': '203.0.113.5' } });
    expect(res.status).toBe(403);
  });

  // Setup mode in the standalone web player passes idleTimeoutMs, so an idle settings page exits.
  it('self-reaps after the idle timeout when there is no activity', async () => {
    let reaped = 0;
    await start({ idleTimeoutMs: 100, onIdleTimeout: () => { reaped += 1; } });
    await sleep(300);
    expect(reaped).toBe(1);
  });

  it('stays alive while requests keep arriving (idle timer resets each request)', async () => {
    let reaped = 0;
    const base = await start({ idleTimeoutMs: 200, onIdleTimeout: () => { reaped += 1; } });
    for (let i = 0; i < 5; i++) {
      await fetch(`${base}/api/settings/seed`);
      await sleep(70);
    }
    expect(reaped).toBe(0);
  });

  it('does not install a reaper unless idleTimeoutMs is set', async () => {
    let reaped = 0;
    const base = await start({ onIdleTimeout: () => { reaped += 1; } });
    await sleep(200);
    expect(reaped).toBe(0);
    expect((await fetch(`${base}/api/settings/seed`)).status).toBe(200);
  });

  it('serves the settings form on GET /', async () => {
    const base = await start();
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('<form');
  });

  it('sends the shared Content-Security-Policy with the settings page', async () => {
    const base = await start();
    const res = await fetch(`${base}/`);
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('serves static assets and 404s unknown paths', async () => {
    const base = await start();
    expect((await fetch(`${base}/styles.css`)).status).toBe(200);
    expect((await fetch(`${base}/app.js`)).status).toBe(200);
    expect((await fetch(`${base}/does-not-exist.js`)).status).toBe(404);
  });

  it('offers every access mode the store accepts in the Access select', async () => {
    const base = await start();
    const html = await (await fetch(`${base}/`)).text();

    const select = /<select id="webuiAuthMode">([\s\S]*?)<\/select>/.exec(html)?.[1] ?? '';
    const values = [...select.matchAll(/<option value="([^"]+)">/g)].map((match) => match[1]);
    expect(values).toEqual([...WEBUI_AUTH_MODES]);
  });
});

describe('settings server admin password', () => {
  const NAV = { url: 'http://h:4533', username: 'u', password: 'secret' };
  const STORED_HASH = '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  let dir: string;
  let file: string;
  let savedPath: string | undefined;
  let server: { url: string; close: () => Promise<void> } | null = null;

  beforeEach(() => {
    savedPath = process.env['NAVIDROME_CONFIG_PATH'];
    dir = mkdtempSync(join(tmpdir(), 'nd-srv-auth-'));
    file = join(dir, 'settings.json');
    process.env['NAVIDROME_CONFIG_PATH'] = file;
  });

  afterEach(async () => {
    argon2Failure.current = null;
    if (server) { await server.close(); server = null; }
    if (savedPath === undefined) delete process.env['NAVIDROME_CONFIG_PATH'];
    else process.env['NAVIDROME_CONFIG_PATH'] = savedPath;
    rmSync(dir, { recursive: true, force: true });
  });

  async function start(): Promise<string> {
    server = await startConfigServer();
    return server.url.replace(/\/$/, '');
  }

  const save = (base: string, auth: Record<string, unknown>): Promise<Response> =>
    fetch(`${base}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ navidrome: { ...NAV, password: MASK }, webui: { auth } }),
    });
  const storedAuth = (): Record<string, unknown> | undefined =>
    (JSON.parse(readFileSync(file, 'utf8')) as { webui?: { auth?: Record<string, unknown> } }).webui?.auth;

  it.each([
    ['an Argon2id hash', STORED_HASH, true],
    ['a value that is not an Argon2id hash', '$argon2id$stored', false],
  ])('reports only whether a hash is set in the seed, for %s', async (_label, adminPasswordHash, adminPasswordSet) => {
    writeFileSync(file, JSON.stringify({ navidrome: NAV, webui: { auth: { mode: 'jukebox', adminPasswordHash } } }));
    const base = await start();

    const seed = await (await fetch(`${base}/api/settings/seed`)).json() as { webui: { auth: Record<string, unknown> } };

    expect(seed.webui.auth).toEqual({ mode: 'jukebox', adminPasswordSet });
  });

  it('hashes a new password with Argon2id and stores only the hash', async () => {
    writeFileSync(file, JSON.stringify({ navidrome: NAV }));
    const base = await start();

    const res = await save(base, { mode: 'password', adminAccess: 'lan', adminPassword: 'correct horse battery' });

    expect(res.status).toBe(200);
    const auth = storedAuth();
    expect(auth).toMatchObject({ mode: 'password', adminAccess: 'lan' });
    expect(auth).not.toHaveProperty('adminPassword');
    expect(await verifyPassword('correct horse battery', String(auth?.['adminPasswordHash']))).toBe(true);
    expect(readFileSync(file, 'utf8')).not.toContain('correct horse battery');
  });

  it('keeps the stored hash for a blank password and ignores a posted hash', async () => {
    writeFileSync(file, JSON.stringify({ navidrome: NAV, webui: { auth: { mode: 'jukebox', adminPasswordHash: STORED_HASH } } }));
    const base = await start();

    const res = await save(base, { mode: 'jukebox', adminPassword: '', adminPasswordHash: '$argon2id$forged' });

    expect(res.status).toBe(200);
    expect(storedAuth()?.['adminPasswordHash']).toBe(STORED_HASH);
  });

  it('refuses mode password when the stored value is not an Argon2id hash and no new password is given', async () => {
    writeFileSync(file, JSON.stringify({ navidrome: NAV, webui: { auth: { mode: 'none', adminPasswordHash: 'hand-edited' } } }));
    const base = await start();

    const res = await save(base, { mode: 'password', adminPassword: '' });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('Access with the admin password needs an admin password');
  });

  it('opens without Argon2 and reports the cause when a new password needs hashing', async () => {
    argon2Failure.current = new Error('Argon2 password hashing is unavailable (ERR_CRYPTO_ARGON2_NOT_SUPPORTED).');
    writeFileSync(file, JSON.stringify({ navidrome: NAV }));
    const base = await start();

    const mode = await save(base, { mode: 'none' });
    const res = await save(base, { mode: 'password', adminPassword: 'correct horse battery' });

    expect(mode.status).toBe(200);
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toContain('ERR_CRYPTO_ARGON2_NOT_SUPPORTED');
    expect(storedAuth()).toMatchObject({ mode: 'none' });
  });

  it.each([
    ['11 characters', 'x'.repeat(11)],
    ['129 characters', 'x'.repeat(129)],
  ])('refuses a new password of %s', async (_label, adminPassword) => {
    writeFileSync(file, JSON.stringify({ navidrome: NAV }));
    const base = await start();

    const res = await save(base, { mode: 'password', adminPassword });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('12 to 128 characters');
    expect(storedAuth()).toBeUndefined();
  });

  it.each(['password', 'jukebox'])('refuses mode %s with no stored hash and no new password', async (mode) => {
    writeFileSync(file, JSON.stringify({ navidrome: NAV }));
    const base = await start();

    const res = await save(base, { mode, adminPassword: '' });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('Access with the admin password needs an admin password');
  });

  it('refuses a password field that is not a string', async () => {
    writeFileSync(file, JSON.stringify({ navidrome: NAV }));
    const base = await start();

    const res = await save(base, { mode: 'none', adminPassword: 12345678901234 });

    expect(res.status).toBe(400);
  });
});
