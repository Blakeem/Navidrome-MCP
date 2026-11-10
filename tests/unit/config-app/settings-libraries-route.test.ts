/**
 * Navidrome MCP Server - Settings library list route test
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// A loopback server stands in for Navidrome, so the route runs its real login and user lookup.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startConfigServer } from '../../../src/config-app/server.js';

const MASK = '********';
const STORED_PASSWORD = 'stored-secret';
const USER_ID = 'user-1';

function makeJwt(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  return `${header}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;
}

interface FakeNavidrome {
  url: string;
  /** The password of each login the fake server saw. */
  logins: string[];
  /** The body /api/user/{uid} answers with, as a status and a JSON value. */
  userAnswer: { status: number; body: unknown };
  /** The status /auth/login answers with. */
  loginStatus: number;
  close: () => Promise<void>;
}

async function startFakeNavidrome(): Promise<FakeNavidrome> {
  const fake: FakeNavidrome = {
    url: '',
    logins: [],
    userAnswer: { status: 200, body: { libraries: [] } },
    loginStatus: 200,
    close: () => Promise.resolve(),
  };
  const reply = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/auth/login') {
      let raw = '';
      req.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
      req.on('end', () => {
        fake.logins.push((JSON.parse(raw) as { password: string }).password);
        reply(res, fake.loginStatus, { token: makeJwt({ uid: USER_ID }) });
      });
      return;
    }
    if (req.url === `/api/user/${USER_ID}`) {
      reply(res, fake.userAnswer.status, fake.userAnswer.body);
      return;
    }
    reply(res, 404, {});
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  fake.url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  fake.close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return fake;
}

describe('POST /api/settings/libraries', () => {
  let dir: string;
  let fake: FakeNavidrome;
  let settings: { url: string; close: () => Promise<void> };
  let previousConfigPath: string | undefined;

  beforeEach(async () => {
    previousConfigPath = process.env['NAVIDROME_CONFIG_PATH'];
    dir = mkdtempSync(join(tmpdir(), 'nd-libs-'));
    process.env['NAVIDROME_CONFIG_PATH'] = join(dir, 'settings.json');
    fake = await startFakeNavidrome();
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ navidrome: { url: fake.url, username: 'u', password: STORED_PASSWORD } }),
    );
    settings = await startConfigServer({ host: 'settings-command' });
  });

  afterEach(async () => {
    await settings.close();
    await fake.close();
    if (previousConfigPath === undefined) delete process.env['NAVIDROME_CONFIG_PATH'];
    else process.env['NAVIDROME_CONFIG_PATH'] = previousConfigPath;
    rmSync(dir, { recursive: true, force: true });
  });

  const postLibraries = async (body: unknown = { navidrome: { url: fake.url, username: 'u', password: MASK } }): Promise<{ status: number; json: Record<string, unknown> }> => {
    const res = await fetch(`${settings.url.replace(/\/$/, '')}/api/settings/libraries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };

  it('answers the id and name of each library the user can see, and logs in with the stored password for the mask', async () => {
    fake.userAnswer = {
      status: 200,
      body: { libraries: [{ id: 1, name: 'Music', path: '/music' }, { id: 2, name: 'Podcasts', path: '/pods' }] },
    };

    const { status, json } = await postLibraries();

    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, libraries: [{ id: 1, name: 'Music' }, { id: 2, name: 'Podcasts' }] });
    expect(fake.logins).toEqual([STORED_PASSWORD]);
  });

  it('names a library with no name by its ID, and skips an entry with no integer ID', async () => {
    fake.userAnswer = { status: 200, body: { libraries: [{ id: 3, name: '  ' }, { id: 'x', name: 'Odd' }, { name: 'None' }] } };

    const { json } = await postLibraries();

    expect(json).toEqual({ ok: true, libraries: [{ id: 3, name: 'Library 3' }] });
  });

  it('answers ok false with the cause when the login fails', async () => {
    fake.loginStatus = 401;

    const { status, json } = await postLibraries();

    expect(status).toBe(200);
    expect(json['ok']).toBe(false);
    expect(json['error']).toContain('rejected the username or password');
  });

  it('answers ok false when Navidrome gives no libraries array', async () => {
    fake.userAnswer = { status: 200, body: { id: USER_ID } };

    const { json } = await postLibraries();

    expect(json['ok']).toBe(false);
    expect(json['error']).toContain('no library list');
  });

  it('answers ok false when the user lookup is refused', async () => {
    fake.userAnswer = { status: 500, body: { error: 'boom' } };

    const { json } = await postLibraries();

    expect(json['ok']).toBe(false);
    expect(typeof json['error']).toBe('string');
  });

  it('reports every validation issue and makes no login for an invalid form', async () => {
    const { json } = await postLibraries({ navidrome: { url: '', username: '', password: 'p' } });

    expect(json['ok']).toBe(false);
    expect(json['error']).toContain('navidrome.url: Navidrome URL must be a valid URL');
    expect(fake.logins).toEqual([]);
  });

  it('refuses a malformed payload with 400', async () => {
    const { status } = await postLibraries({ navidrome: 'nope' });

    expect(status).toBe(400);
  });

  it('redacts URL credentials from a failed login', async () => {
    const { json } = await postLibraries({ navidrome: { url: 'http://u:hunter2@127.0.0.1:1', username: 'u', password: 'p' } });

    expect(json['ok']).toBe(false);
    expect(json['error']).not.toContain('hunter2');
  });
});
