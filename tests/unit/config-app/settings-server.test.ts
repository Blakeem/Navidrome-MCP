/**
 * /api/settings/test only receives inputs that fail before a request leaves the process,
 * such as a validation failure or a URL that carries credentials, so no test reaches the network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostStartError, type SaveTakeover } from '../../../src/config-app/save-message.js';
import { startConfigServer } from '../../../src/config-app/server.js';
import { CROSS_ORIGIN_REFUSAL } from '../../../src/webui/http-helpers.js';
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
    for (const k of [
      'NAVIDROME_CONFIG_PATH', 'NAVIDROME_URL', 'NAVIDROME_USERNAME', 'NAVIDROME_PASSWORD', 'MUSICBRAINZ_USER_AGENT',
      'WEBUI_PERSIST_AFTER_MCP_EXIT', 'WEBUI_VISUALIZER', 'JUKEBOX_GUEST_QUEUE_LIMIT', 'TOKEN_EXPIRY',
      'MCP_HTTP_PORT', 'MCP_HTTP_AUTH_TOKEN', 'PLAYBACK_TRANSCODE_BITRATE', 'WEBUI_ADMIN_ACCESS',
    ]) {
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

  async function start(options: Partial<Parameters<typeof startConfigServer>[0]> = {}): Promise<string> {
    server = await startConfigServer({ host: 'settings-command', ...options });
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

  it('names the field that voids an unusable store in the seed response', async () => {
    writeFileSync(file, JSON.stringify({ navidrome: { url: 'http://h:4533' }, webui: { auth: { mode: 'Jukebox' } } }));
    const base = await start();
    const seed = await getJson(await fetch(`${base}/api/settings/seed`));
    expect(seed.storeProblem).toEqual(expect.stringContaining('webui.auth.mode'));
    expect(seed.storeUnreadable).toBe(false);
    expect(seed.storeSalvaged).toBe(true);
  });

  it('marks a store the server cannot read as unreadable in the seed response', async () => {
    mkdirSync(file);
    const base = await start();
    const seed = await getJson(await fetch(`${base}/api/settings/seed`));
    expect(seed.storeProblem).toMatch(/is unreadable \(EISDIR\)/);
    expect(seed.storeUnreadable).toBe(true);
    expect(seed.storeSalvaged).toBe(false);
  });

  it('answers a null store problem for a usable store and for no store', async () => {
    const base = await start();
    expect(await getJson(await fetch(`${base}/api/settings/seed`))).toMatchObject({ storeProblem: null, storeUnreadable: false, storeSalvaged: false });
    writeFileSync(file, JSON.stringify({ navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' } }));
    expect(await getJson(await fetch(`${base}/api/settings/seed`))).toMatchObject({ storeProblem: null, storeUnreadable: false, storeSalvaged: false });
  });

  it('reports the settings file and Jukebox Remote log paths in the seed response', async () => {
    const base = await start();
    const seed = await getJson(await fetch(`${base}/api/settings/seed`));
    expect(seed.storePath).toBe(file);
    expect(seed.logPath).toBe(join(dir, 'jukebox-remote.log'));
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

  it('checks radio and lyrics on first run, and the first Save writes both as true', async () => {
    const base = await start();
    const seed = await getJson(await fetch(`${base}/api/settings/seed`));
    expect(seed.features).toMatchObject({ radio: true, lyrics: true });
    expect(seed.features.radioBrowserUserAgent ?? null).toBeNull();
    expect(seed.features.lrclibUserAgent ?? null).toBeNull();

    const res = await post(base, {
      navidrome: { url: 'http://h:4533', username: 'u', password: 'p' },
      features: { radio: seed.features.radio, lyrics: seed.features.lyrics, radioBrowserUserAgent: null, lrclibUserAgent: null },
    });
    expect(res.status).toBe(200);
    expect(readSettings()?.features).toEqual({ radio: true, lyrics: true });
  });

  it.each([
    [{ radioBrowserUserAgent: 'UA/1.0' }, { radio: true, lyrics: false }],
    [{ lyricsProvider: 'lrclib', lrclibUserAgent: 'UA/1.0' }, { radio: false, lyrics: true }],
    [{}, { radio: false, lyrics: false }],
  ])('seeds the radio and lyrics boxes of a file without the booleans from %j', async (features, expected) => {
    writeFileSync(file, JSON.stringify({ navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' }, features }));
    const base = await start();
    const seed = await getJson(await fetch(`${base}/api/settings/seed`));
    expect(seed.features).toMatchObject(expected);
  });

  it('writes the booleans over a legacy file, keeps its user agent override and drops lyricsProvider', async () => {
    writeFileSync(file, JSON.stringify({
      navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' },
      features: { lyricsProvider: 'lrclib', lrclibUserAgent: 'Custom/1.0', musicBrainzUserAgent: 'Mb/1.0' },
    }));
    const base = await start();
    const res = await post(base, {
      navidrome: { url: 'http://h:4533', username: 'u', password: MASK },
      features: { radio: false, lyrics: true, lrclibUserAgent: 'Custom/1.0' },
    });
    expect(res.status).toBe(200);
    expect(readSettings()?.features).toEqual({
      radio: false,
      lyrics: true,
      lrclibUserAgent: 'Custom/1.0',
      musicBrainzUserAgent: 'Mb/1.0',
    });
  });

  it.each([
    ['no store', null],
    ['a voided store', { navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' }, webui: { port: 'abc' } }],
  ])('keeps the env MusicBrainz user agent, which the page does not show, on a save over %s', async (_label, storeContent) => {
    process.env['MUSICBRAINZ_USER_AGENT'] = 'MyApp/1.0 (me@example.com)';
    if (storeContent !== null) writeFileSync(file, JSON.stringify(storeContent));
    const base = await start();
    const res = await post(base, { navidrome: { url: 'http://h:4533', username: 'u', password: 'p' } });
    expect(res.status).toBe(200);
    expect(readSettings()?.features?.musicBrainzUserAgent).toBe('MyApp/1.0 (me@example.com)');
  });

  it('keeps the stored MusicBrainz user agent over the env one', async () => {
    process.env['MUSICBRAINZ_USER_AGENT'] = 'Env/1.0';
    writeFileSync(file, JSON.stringify({
      navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' },
      features: { musicBrainzUserAgent: 'Stored/1.0' },
    }));
    const base = await start();
    const res = await post(base, { navidrome: { url: 'http://h:4533', username: 'u', password: MASK } });
    expect(res.status).toBe(200);
    expect(readSettings()?.features?.musicBrainzUserAgent).toBe('Stored/1.0');
  });

  it('marks only a usable store as usable in the seed response', async () => {
    const base = await start();
    expect(await getJson(await fetch(`${base}/api/settings/seed`))).toMatchObject({ storeUsable: false });
    writeFileSync(file, JSON.stringify({ navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' } }));
    expect(await getJson(await fetch(`${base}/api/settings/seed`))).toMatchObject({ storeUsable: true });
    writeFileSync(file, JSON.stringify({ navidrome: { url: 'http://h:4533' }, webui: { port: 'abc' } }));
    expect(await getJson(await fetch(`${base}/api/settings/seed`))).toMatchObject({ storeUsable: false });
  });

  it('keeps each key a changed-fields save omits, such as a gear-menu value and the player-owned settings', async () => {
    const stored = {
      navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' },
      webui: { port: 8808, autoOpenBrowser: true, persistAfterMcpExit: true, visualizer: false },
      jukebox: { guestQueueLimit: 7 },
      advanced: { tokenExpiry: 600 },
    };
    writeFileSync(file, JSON.stringify(stored));
    const base = await start();

    const res = await post(base, { webui: { port: 9000 } });

    expect(res.status).toBe(200);
    expect(readSettings()).toMatchObject({
      navidrome: stored.navidrome,
      webui: { port: 9000, autoOpenBrowser: true, persistAfterMcpExit: true, visualizer: false },
      jukebox: { guestQueueLimit: 7 },
      advanced: { tokenExpiry: 600 },
    });
  });

  it('writes the radio and lyrics state the page showed when a save over a legacy file posts neither', async () => {
    writeFileSync(file, JSON.stringify({
      navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' },
      features: { radioBrowserUserAgent: 'UA/1.0' },
    }));
    const base = await start();

    const res = await post(base, { webui: { port: 9000 } });

    expect(res.status).toBe(200);
    expect(readSettings()?.features).toEqual({ radio: true, lyrics: false, radioBrowserUserAgent: 'UA/1.0' });
  });

  it('keeps the env values of the player-owned settings and the token expiry on a first save', async () => {
    process.env['WEBUI_PERSIST_AFTER_MCP_EXIT'] = 'true';
    process.env['WEBUI_VISUALIZER'] = 'false';
    process.env['JUKEBOX_GUEST_QUEUE_LIMIT'] = '7';
    process.env['TOKEN_EXPIRY'] = '600';
    const base = await start();

    const res = await post(base, { navidrome: { url: 'http://h:4533', username: 'u', password: 'p' } });

    expect(res.status).toBe(200);
    expect(readSettings()).toMatchObject({
      webui: { persistAfterMcpExit: true, visualizer: false },
      jukebox: { guestQueueLimit: 7 },
      advanced: { tokenExpiry: 600 },
    });
  });

  it('skips an out-of-range env value the page cannot edit on a first save', async () => {
    process.env['JUKEBOX_GUEST_QUEUE_LIMIT'] = '25';
    process.env['TOKEN_EXPIRY'] = '0';
    process.env['MCP_HTTP_PORT'] = '70000';
    const base = await start();

    const res = await post(base, {
      navidrome: { url: 'http://h:4533', username: 'u', password: 'p' },
      transport: { type: 'stdio' },
      webui: { auth: { mode: 'none' } },
    });

    expect(res.status).toBe(200);
    const stored = readSettings();
    expect(stored?.jukebox?.guestQueueLimit).toBeUndefined();
    expect(stored?.advanced?.tokenExpiry).toBeUndefined();
    expect(stored?.transport).toMatchObject({ type: 'stdio' });
    expect(stored?.transport?.port).toBeUndefined();
  });

  it('keeps the env values of the fields the page disables, such as the http port, on a first save', async () => {
    process.env['MCP_HTTP_PORT'] = '4000';
    process.env['MCP_HTTP_AUTH_TOKEN'] = 'env-token';
    process.env['PLAYBACK_TRANSCODE_BITRATE'] = '256';
    process.env['WEBUI_ADMIN_ACCESS'] = 'lan';
    const base = await start();

    const res = await post(base, {
      navidrome: { url: 'http://h:4533', username: 'u', password: 'p' },
      transport: { type: 'stdio' },
      playback: { transcodeFormat: 'raw' },
      webui: { auth: { mode: 'none' } },
    });

    expect(res.status).toBe(200);
    expect(readSettings()).toMatchObject({
      transport: { type: 'stdio', port: 4000, authToken: 'env-token' },
      playback: { transcodeFormat: 'raw', transcodeBitrate: '256' },
      webui: { auth: { mode: 'none', adminAccess: 'lan' } },
    });
  });

  it('writes a posted http field over its env value on a first save', async () => {
    process.env['MCP_HTTP_PORT'] = '4000';
    const base = await start();

    const res = await post(base, {
      navidrome: { url: 'http://h:4533', username: 'u', password: 'p' },
      transport: { type: 'http', port: 5000 },
    });

    expect(res.status).toBe(200);
    expect(readSettings()?.transport).toMatchObject({ type: 'http', port: 5000 });
  });

  it('serves no suggestions route', async () => {
    const base = await start();
    expect((await fetch(`${base}/api/settings/suggestions`)).status).toBe(404);
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

  it('drops a cleared field from the file and replaces a stored value with a posted one', async () => {
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
    expect(after?.transport).toEqual({ port: 3000 });
    expect(after?.features).toEqual({ radio: false, lyrics: false, lrclibBase: 'https://new.example' });
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
    expect(readSettings()?.playback).toEqual({ audioDevice: { id: 'wasapi/{b}' }, mpvPath: '/opt/mpv/mpv' });

    const cleared = await post(base, { navidrome, playback: { audioDevice: null } });
    expect(cleared.status).toBe(200);
    expect(readSettings()?.playback).toEqual({ mpvPath: '/opt/mpv/mpv' });
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
    expect((await getJson(res)).message).toContain(`could not be read, so it was kept as ${file}.bak`);
    expect(readSettings()?.navidrome?.url).toBe('http://h:4533');
  });

  it('seeds the valid values of a voided store, and a save keeps them, its unknown keys and the admin password hash', async () => {
    const hash = '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    writeFileSync(file, JSON.stringify({
      navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' },
      webui: { port: 'abc', expose: true, newFeature: true, auth: { mode: 'password', adminPasswordHash: hash, adminAccess: 'everywhere' } },
      futureSection: { a: 1 },
    }));
    const base = await start();
    const seed = await getJson(await fetch(`${base}/api/settings/seed`));
    expect(seed.storeProblem).toEqual(expect.stringContaining('webui.port'));
    expect(seed.navidrome).toEqual({ url: 'http://h:4533', username: 'u', password: MASK });
    expect(seed.webui.expose).toBe(true);
    expect(seed.webui.auth).toMatchObject({ mode: 'password', adminPasswordSet: true });

    const res = await post(base, { navidrome: seed.navidrome, webui: { port: 8808, expose: true, auth: { mode: 'password' } } });

    expect(res.status).toBe(200);
    expect(readSettings()).toMatchObject({
      navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' },
      webui: { port: 8808, expose: true, auth: { mode: 'password', adminPasswordHash: hash } },
    });
    const written = JSON.parse(readFileSync(file, 'utf8'));
    expect(written.webui.newFeature).toBe(true);
    expect(written.futureSection).toEqual({ a: 1 });
    expect(existsSync(`${file}.bak`)).toBe(true);
    const { message } = await getJson(res);
    expect(message).toContain(`The previous settings.json failed validation. This save kept each of its valid values. The old file is kept as ${file}.bak.`);
    expect(message).not.toContain('could not be read');
  });

  it('lists the hand-edit notices of the store in the seed response', async () => {
    writeFileSync(file, JSON.stringify({ navidrome: { url: 'http://h:4533' }, webui: { prot: 1, port: '8808' } }));
    const base = await start();
    const seed = await getJson(await fetch(`${base}/api/settings/seed`));
    expect(seed.storeNotices).toEqual([
      'webui.port holds the text "8808", so it is read as the number 8808. Remove the quotes to fix the file.',
      'webui.prot is not a setting this version knows. Did you mean webui.port?',
    ]);
    expect(seed.webui.port).toBe(8808);
  });

  it('keeps an unknown key and writes a coerced value back in its type on save', async () => {
    writeFileSync(file, JSON.stringify({ navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' }, webui: { prot: 1, port: '9001' } }));
    const base = await start();
    const res = await post(base, { navidrome: { url: 'http://h:4533', username: 'u', password: MASK } });
    expect(res.status).toBe(200);
    expect(JSON.parse(readFileSync(file, 'utf8')).webui).toEqual({ prot: 1, port: 9001 });
    expect((await getJson(res)).storeNotices).toEqual([
      'webui.prot is not a setting this version knows. Did you mean webui.port?',
    ]);
  });

  it('keeps no backup when the store was usable', async () => {
    writeFileSync(file, JSON.stringify({ navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' } }));
    const base = await start();
    const res = await post(base, { navidrome: { url: 'http://h:4533', username: 'u', password: MASK } });
    expect(res.status).toBe(200);
    expect(existsSync(`${file}.bak`)).toBe(false);
  });

  describe('a changed-fields save', () => {
    const STORED = JSON.stringify({ navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' } });
    const postChanged = (base: string, body: unknown): Promise<Response> =>
      fetch(`${base}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Settings-Changed-Only': '1' },
        body: JSON.stringify(body),
      });

    it('merges onto a usable store', async () => {
      writeFileSync(file, STORED);
      const base = await start();
      const res = await postChanged(base, { webui: { port: 9000 } });
      expect(res.status).toBe(200);
      expect(readSettings()).toMatchObject({ navidrome: { url: 'http://h:4533', password: 'secret' }, webui: { port: 9000 } });
    });

    // Env credentials give the server a base that would validate, so only the refusal keeps the file.
    it('is refused when the store turned invalid after the page loaded', async () => {
      process.env['NAVIDROME_URL'] = 'http://env:4533';
      process.env['NAVIDROME_USERNAME'] = 'envuser';
      process.env['NAVIDROME_PASSWORD'] = 'envpass';
      writeFileSync(file, STORED);
      const base = await start();
      writeFileSync(file, '{"navidrome": {},}');

      const res = await postChanged(base, { webui: { port: 9000 } });

      expect(res.status).toBe(409);
      expect((await getJson(res)).error).toBe(
        'settings.json changed after this page loaded, and the server can no longer use it. Reload the page, then save again.',
      );
      expect(readFileSync(file, 'utf8')).toBe('{"navidrome": {},}');
      expect(existsSync(`${file}.bak`)).toBe(false);
    });

    it('is refused when the store was removed after the page loaded', async () => {
      process.env['NAVIDROME_URL'] = 'http://env:4533';
      process.env['NAVIDROME_USERNAME'] = 'envuser';
      process.env['NAVIDROME_PASSWORD'] = 'envpass';
      writeFileSync(file, STORED);
      const base = await start();
      rmSync(file);

      const res = await postChanged(base, { webui: { port: 9000 } });

      expect(res.status).toBe(409);
      expect(existsSync(file)).toBe(false);
    });
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
    expect(body.error).toContain('navidrome.url: Navidrome URL must be a valid URL');
    expect(body.error).toContain('navidrome.username: Navidrome username is required');
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
    expect(await getJson(res)).toEqual({ error: CROSS_ORIGIN_REFUSAL });
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
  const PLAYER_RESTART =
    "The Jukebox Remote applies these changes after Shut down player in the player's gear menu and a new start. " +
    'A new start is the next play from the AI, a restart of the MCP client, or `navidrome-mcp jukebox`.';
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
    server = await startConfigServer({ host: 'settings-command' });
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

  it('names only the Jukebox Remote restart for an Access change', async () => {
    writeFileSync(file, JSON.stringify({ navidrome: NAV }));
    const base = await start();

    const { message } = (await (await save(base, { mode: 'none' })).json()) as { message: string };

    expect(message).toBe(`Settings saved to ${file}. ${PLAYER_RESTART}`);
  });

  it('names only the live-apply lines for a new admin password over an unchanged Access', async () => {
    writeFileSync(file, JSON.stringify({ navidrome: NAV, webui: { auth: { mode: 'password', adminPasswordHash: STORED_HASH } } }));
    const base = await start();

    const res = await save(base, { mode: 'password', adminPassword: 'correct horse battery' });
    const { message } = (await res.json()) as { message: string };

    expect(message).toContain(
      'A new admin password applies to a running player within about 10 seconds and signs out every admin session.',
    );
    expect(message).not.toContain('Shut down player');
    expect(message).not.toContain('MCP server');
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

  it('saves mode password over a stored value that is not an Argon2id hash, with no new password', async () => {
    writeFileSync(file, JSON.stringify({ navidrome: NAV, webui: { auth: { mode: 'none', adminPasswordHash: 'hand-edited' } } }));
    const base = await start();

    const res = await save(base, { mode: 'password', adminPassword: '' });

    expect(res.status).toBe(200);
    expect(storedAuth()).toMatchObject({ mode: 'password', adminPasswordHash: 'hand-edited' });
  });

  it('stores the choice to skip the admin password on this computer', async () => {
    writeFileSync(file, JSON.stringify({ navidrome: NAV }));
    const base = await start();

    const res = await save(base, { mode: 'jukebox', adminPassword: '', askPasswordOnThisComputer: false });

    expect(res.status).toBe(200);
    expect(storedAuth()).toMatchObject({ mode: 'jukebox', askPasswordOnThisComputer: false });
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
    ['7 characters', 'x'.repeat(7)],
    ['129 characters', 'x'.repeat(129)],
  ])('refuses a new password of %s', async (_label, adminPassword) => {
    writeFileSync(file, JSON.stringify({ navidrome: NAV }));
    const base = await start();

    const res = await save(base, { mode: 'password', adminPassword });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('8 to 128 characters');
    expect(storedAuth()).toBeUndefined();
  });

  it('saves a new password of 8 characters', async () => {
    writeFileSync(file, JSON.stringify({ navidrome: NAV }));
    const base = await start();

    const res = await save(base, { mode: 'password', adminPassword: '8 chars!' });

    expect(res.status).toBe(200);
    expect(await verifyPassword('8 chars!', String(storedAuth()?.['adminPasswordHash']))).toBe(true);
  });

  it.each(['password', 'jukebox'])('saves mode %s with no stored hash and no new password', async (mode) => {
    writeFileSync(file, JSON.stringify({ navidrome: NAV }));
    const base = await start();

    const res = await save(base, { mode, adminPassword: '' });

    expect(res.status).toBe(200);
    expect(storedAuth()).toMatchObject({ mode });
    expect(storedAuth()).not.toHaveProperty('adminPasswordHash');
  });

  it('refuses a password field that is not a string', async () => {
    writeFileSync(file, JSON.stringify({ navidrome: NAV }));
    const base = await start();

    const res = await save(base, { mode: 'none', adminPassword: 12345678901234 });

    expect(res.status).toBe(400);
  });
});

describe('settings server save replies', () => {
  const NAV = { url: 'http://h:4533', username: 'u', password: 'secret' };
  let dir: string;
  let file: string;
  let savedPath: string | undefined;
  let server: { url: string; close: () => Promise<void> } | null = null;

  beforeEach(() => {
    savedPath = process.env['NAVIDROME_CONFIG_PATH'];
    dir = mkdtempSync(join(tmpdir(), 'nd-srv-reply-'));
    file = join(dir, 'settings.json');
    process.env['NAVIDROME_CONFIG_PATH'] = file;
  });

  afterEach(async () => {
    if (server) { await server.close(); server = null; }
    if (savedPath === undefined) delete process.env['NAVIDROME_CONFIG_PATH'];
    else process.env['NAVIDROME_CONFIG_PATH'] = savedPath;
    rmSync(dir, { recursive: true, force: true });
  });

  async function start(options: Partial<Parameters<typeof startConfigServer>[0]> = {}): Promise<string> {
    server = await startConfigServer({ host: 'mcp-setup', ...options });
    return server.url.replace(/\/$/, '');
  }

  const save = async (base: string, body: unknown): Promise<any> =>
    (await fetch(`${base}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })).json();

  it('lists the next steps with the saved Jukebox Remote address on a first save', async () => {
    const base = await start();

    const reply = await save(base, { navidrome: NAV, webui: { enabled: true, port: 9911, tls: { certPath: '/c.pem', keyPath: '/k.pem' } } });

    expect(reply.message).toBe(`Settings saved to ${file}.`);
    expect(reply.nextSteps).toEqual([
      { text: 'Quit your AI app fully and open it again.' },
      { text: 'The Jukebox Remote runs after your AI app restarts. It needs mpv. Open it at', url: 'https://127.0.0.1:9911/admin' },
    ]);
  });

  it('lists the next steps over a store that had no Navidrome URL', async () => {
    writeFileSync(file, JSON.stringify({ webui: { port: 9912 } }));
    const base = await start();

    const reply = await save(base, { navidrome: NAV });

    expect(reply.nextSteps?.[1]?.url).toBe('http://127.0.0.1:9912/admin');
  });

  it('names the AI app restart on every save in MCP setup mode, over a usable store too', async () => {
    writeFileSync(file, JSON.stringify({ navidrome: NAV, features: { radio: true, lyrics: true } }));
    const base = await start();

    const first = await save(base, { transport: { port: 3999 } });
    const repeated = await save(base, { transport: { port: 3999 } });

    expect(first.message).toBe(`Settings saved to ${file}.`);
    expect(repeated.message).toBe('No changes to save.');
    for (const reply of [first, repeated]) {
      expect(reply.nextSteps?.[0]).toEqual({ text: 'Quit your AI app fully and open it again.' });
      expect(reply.pageClosed).toBeUndefined();
    }
  });

  it('names the player restart in MCP setup mode over a usable store a running player may have read', async () => {
    writeFileSync(file, JSON.stringify({ navidrome: NAV, features: { radio: true, lyrics: true } }));
    const base = await start();

    const reply = await save(base, { navidrome: { ...NAV, password: 'fixed' } });

    expect(reply.message).toBe(
      `Settings saved to ${file}. The Jukebox Remote applies these changes after Shut down player in the player's gear menu and a new start. ` +
        'A new start is the next play from the AI, a restart of the MCP client, or `navidrome-mcp jukebox`.',
    );
    expect(reply.nextSteps?.[0]).toEqual({ text: 'Quit your AI app fully and open it again.' });
  });

  it('adds the player restart for a player that runs from environment variables', async () => {
    const base = await start({ host: 'jukebox-settings' });

    const reply = await save(base, { navidrome: NAV, webui: { enabled: false, port: 9914 } });

    expect(reply.nextSteps).toEqual([
      { text: 'Quit your AI app fully and open it again.' },
      { text: expect.stringContaining("Shut down player in the player's gear menu") },
      { text: 'Open it again at', url: 'http://127.0.0.1:9914/admin' },
    ]);
  });

  it('names the restarts of the changed sections on a later save, and no change on a repeat', async () => {
    writeFileSync(file, JSON.stringify({ navidrome: NAV, features: { radio: true, lyrics: true } }));
    const base = await start({ host: 'settings-command' });

    const changed = await save(base, { transport: { port: 3999 } });
    const repeated = await save(base, { transport: { port: 3999 } });

    expect(changed.nextSteps).toBeUndefined();
    expect(changed.message).toBe(
      `Settings saved to ${file}. The MCP server applies these changes after it restarts. A stdio server restarts with its MCP client.`,
    );
    expect(repeated.message).toBe('No changes to save.');
  });

  it('reports the write and names no restart on a later save that only pruned an empty value', async () => {
    writeFileSync(file, JSON.stringify({ navidrome: NAV, features: { radio: true, lyrics: true }, playback: { mpvPath: '' } }));
    const base = await start({ host: 'settings-command' });

    const reply = await save(base, {});

    expect(reply.message).toBe(`Settings saved to ${file}.`);
    expect(readFileSync(file, 'utf8')).not.toContain('mpvPath');
  });

  it('reports the write and names no restart on a later save that only rewrote a quoted number', async () => {
    writeFileSync(file, JSON.stringify({ navidrome: NAV, features: { radio: true, lyrics: true }, webui: { port: '8808' } }));
    const base = await start({ host: 'settings-command' });

    const reply = await save(base, {});

    expect(reply.message).toBe(`Settings saved to ${file}.`);
    expect(reply.storeNotices).toEqual([]);
    expect(readFileSync(file, 'utf8')).toContain('"port": 8808');
  });

  it('runs onSaved after the write, says the Jukebox Remote is starting and closes once the reply is sent', async () => {
    let storedWhenCalled = '';
    const base = await start({
      host: 'jukebox-setup',
      onSaved: () => {
        storedWhenCalled = readFileSync(file, 'utf8');
        return Promise.resolve({ mode: 'started' as const, url: 'http://127.0.0.1:9913' });
      },
    });

    const reply = await save(base, { navidrome: NAV, webui: { port: 9913 } });

    expect(storedWhenCalled).toContain('http://h:4533');
    expect(reply.ok).toBe(true);
    expect(reply.nextSteps).toEqual([
      { text: 'The Jukebox Remote is starting.' },
      { text: 'It needs mpv to play music. Open it at', url: 'http://127.0.0.1:9913/admin' },
      { text: "This page closes now. To change settings later, use All settings in the player's gear menu." },
    ]);
    expect(reply.pageClosed).toBe(true);
    await vi.waitFor(async () => {
      await expect(fetch(`${base}/api/settings/seed`)).rejects.toThrow();
    });
  });

  it('names the running player, its restart and its own scheme when the host found another player on the saved port', async () => {
    const base = await start({ host: 'jukebox-setup', onSaved: () => Promise.resolve({ mode: 'attached' as const, url: 'https://127.0.0.1:9917' }) });

    const reply = await save(base, { navidrome: NAV, webui: { port: 9917 } });

    expect(reply.nextSteps?.[0]).toEqual({ text: 'A Jukebox Remote already runs on this port. It did not read these settings.' });
    expect(reply.nextSteps?.[1]?.text).toContain("Shut down player in the player's gear menu");
    expect(reply.nextSteps?.[2]).toEqual({ text: 'Open it at', url: 'https://127.0.0.1:9917/admin' });
    expect(reply.pageClosed).toBe(true);
    await vi.waitFor(async () => {
      await expect(fetch(`${base}/api/settings/seed`)).rejects.toThrow();
    });
  });

  it('refuses a second tab\'s Save during a start without writing it', async () => {
    let finishStart: () => void = () => undefined;
    const onSaved = vi.fn(() => new Promise<SaveTakeover>((resolve) => { finishStart = () => resolve({ mode: 'started', url: 'http://127.0.0.1:9915' }); }));
    const base = await start({ host: 'jukebox-setup', onSaved });

    const first = save(base, { navidrome: NAV, webui: { port: 9915 } });
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    const second = await fetch(`${base}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ navidrome: NAV, webui: { port: 9916 } }),
    });
    finishStart();

    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: string }).error).toBe(
      "Another tab's Save is starting the Jukebox Remote. Save here again only if that start fails.",
    );
    expect((await first).nextSteps?.[1]?.url).toBe('http://127.0.0.1:9915/admin');
    expect(readFileSync(file, 'utf8')).toContain('9915');
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('takes the next Save after a start fails', async () => {
    const onSaved = vi.fn()
      .mockRejectedValueOnce(new Error('Authentication failed: 401 Unauthorized'))
      .mockResolvedValueOnce({ mode: 'started', url: 'http://127.0.0.1:8808' });
    const base = await start({ host: 'jukebox-setup', onSaved });

    const failed = await save(base, { navidrome: NAV });
    const started = await save(base, { navidrome: NAV });

    expect(failed.startFailed).toBe(true);
    expect(started.pageClosed).toBe(true);
    expect(onSaved).toHaveBeenCalledTimes(2);
  });

  it('keeps serving the page with the reason when the host cannot start', async () => {
    const base = await start({
      host: 'jukebox-setup',
      onSaved: () => Promise.reject(new Error('Authentication failed: 401 Unauthorized')),
    });

    const reply = await save(base, { navidrome: NAV });

    expect(reply.ok).toBe(true);
    expect(reply.startFailed).toBe(true);
    expect(reply.message).toBe(
      `Settings saved to ${file}. The Jukebox Remote could not start. Fix the settings and save again. Error: Authentication failed: 401 Unauthorized`,
    );
    expect(reply.nextSteps).toBeUndefined();
    expect(existsSync(file)).toBe(true);
    expect((await fetch(`${base}/api/settings/seed`)).status).toBe(200);
  });

  it('shows only the host\'s own remedy for a start failure that no settings change fixes', async () => {
    const base = await start({
      host: 'jukebox-setup',
      onSaved: () => Promise.reject(new HostStartError('Run `navidrome-mcp jukebox` to start the Jukebox Remote.')),
    });

    const reply = await save(base, { navidrome: NAV });

    expect(reply.startFailed).toBe(true);
    expect(reply.message).toBe(`Settings saved to ${file}. Run \`navidrome-mcp jukebox\` to start the Jukebox Remote.`);
  });

  it('does not run onSaved for a save that fails validation', async () => {
    const onSaved = vi.fn(() => Promise.resolve({ mode: 'started' as const, url: 'http://127.0.0.1:8808' }));
    const base = await start({ host: 'jukebox-setup', onSaved });

    const reply = await save(base, { navidrome: { ...NAV, url: '' } });

    expect(reply.error).toEqual(expect.stringContaining('navidrome.url'));
    expect(onSaved).not.toHaveBeenCalled();
  });
});
