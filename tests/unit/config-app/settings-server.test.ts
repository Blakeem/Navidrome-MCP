/**
 * Unit tests for the settings server's seed/save behavior — password masking,
 * the first-run sentinel un-mask (regression guard), and save validation.
 *
 * No network: only /api/settings/seed and /api/settings (save) are exercised;
 * /api/settings/test would authenticate against a live server and is covered by
 * the live test-connection suite.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startConfigServer } from '../../../src/config-app/server.js';
import { readSettings } from '../../../src/config/store.js';

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

  it('serves recommended values for the optional radio/lyrics fields', async () => {
    const base = await start();
    const sug = await getJson(await fetch(`${base}/api/settings/suggestions`));
    expect(sug['features.radioBrowserUserAgent']).toBe('Navidrome-MCP');
    expect(sug['features.lyricsProvider']).toBe('lrclib');
    expect(sug['features.lrclibUserAgent']).toBe('Navidrome-MCP');
    expect(sug['features.lrclibBase']).toBe('https://lrclib.net');
    // No suggestion for the radio base — blank means SRV auto mirror selection.
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

  // Regression guard for the first-run bug: with NO settings.json yet, the
  // seed/mask comes from env, and saving the unchanged sentinel must restore
  // the real env password (not an empty string that fails validation).
  it('un-masks from the env seed on first run (no store yet)', async () => {
    process.env['NAVIDROME_URL'] = 'http://first:4533';
    process.env['NAVIDROME_USERNAME'] = 'firstuser';
    process.env['NAVIDROME_PASSWORD'] = 'firstrunpass';
    const base = await start();
    const res = await post(base, { navidrome: { url: 'http://first:4533', username: 'firstuser', password: MASK } });
    expect(res.status).toBe(200);
    expect(readSettings()?.navidrome?.password).toBe('firstrunpass');
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

  // The no-orphan reaper: setup-mode hosts (the standalone web player launched
  // before configuration) pass idleTimeoutMs to self-terminate after inactivity.
  it('self-reaps after the idle timeout when there is no activity', async () => {
    let reaped = 0;
    await start({ idleTimeoutMs: 100, onIdleTimeout: () => { reaped += 1; } });
    await sleep(300);
    expect(reaped).toBe(1);
  });

  it('stays alive while requests keep arriving (idle timer resets each request)', async () => {
    let reaped = 0;
    const base = await start({ idleTimeoutMs: 200, onIdleTimeout: () => { reaped += 1; } });
    // Poke every 70ms (< 200ms) for ~350ms; each request must reset the clock.
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
});
