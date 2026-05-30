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

  async function start(): Promise<string> {
    server = await startConfigServer();
    return server.url.replace(/\/$/, '');
  }

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

  it('keeps the stored password when the form re-submits the mask sentinel', async () => {
    writeFileSync(file, JSON.stringify({ navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' } }));
    const base = await start();
    const res = await post(base, { navidrome: { url: 'http://h:4533', username: 'u', password: MASK } });
    expect(res.status).toBe(200);
    expect(readSettings()?.navidrome?.password).toBe('secret');
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

  it('serves the settings form on GET /', async () => {
    const base = await start();
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('<form');
  });

  it('serves static assets and 404s unknown paths', async () => {
    const base = await start();
    expect((await fetch(`${base}/styles.css`)).status).toBe(200);
    expect((await fetch(`${base}/app.js`)).status).toBe(200);
    expect((await fetch(`${base}/does-not-exist.js`)).status).toBe(404);
  });
});
