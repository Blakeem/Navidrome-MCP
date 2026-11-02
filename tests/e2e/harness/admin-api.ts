/**
 * Navidrome MCP Server - e2e admin API helpers
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Calls the web remote API as the run's admin session, for test setup and backend checks.
 */

import type { APIRequestContext, APIResponse } from '@playwright/test';

import { DEFAULT_GUEST_QUEUE_LIMIT, DEFAULT_JUKEBOX_SHARE_LINK } from '../../../src/constants/defaults.js';

export const CSRF_HEADER = 'X-CSRF-Token';
const JUKEBOX_CODE_LIFETIME_HOURS = 1;

interface JukeboxGuest {
  sessionId: string;
  label: string;
  nickname: string | null;
  online: boolean;
  networkKey: string;
  addressClass: string;
  songs: Array<{ title: string | null; artist: string | null }>;
}

interface JukeboxBan {
  id: string;
  kind: 'guest' | 'network';
  label: string;
  networkKey: string;
  expiresAt: number;
}

export interface BanReply {
  bans: JukeboxBan[];
  songsRemoved: number | null;
  songsStayed: number | null;
}

interface JoinLink {
  label: string;
  url: string;
  qrSvg: string;
}

interface JukeboxCode {
  active: boolean;
  expiresAt: number | null;
  guestCount: number;
  links: { lan: JoinLink[]; internet: { url: string; qrSvg: string } | null };
  problem: string | null;
}

function firstLanLink(code: JukeboxCode): JoinLink {
  const link = code.links.lan[0];
  if (!code.active) throw new Error('e2e: no jukebox code is live, so there is no join link.');
  if (link === undefined) throw new Error(`e2e: the jukebox code has no LAN join link: ${code.problem ?? 'no LAN address'}`);
  return link;
}

export interface LibrarySong {
  id: string;
  title: string;
  album: string;
  albumId: string;
  duration?: number;
}

interface LibraryAlbum {
  id: string;
  name: string;
  artist: string;
}

export async function readJson<T>(response: APIResponse, what: string): Promise<T> {
  if (!response.ok()) {
    throw new Error(`e2e: ${what} answered ${String(response.status())}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

/** Reads the CSRF token of the request context's session, which must hold the given role. */
export async function sessionCsrfToken(request: APIRequestContext, sessionUrl: string, role: 'admin' | 'guest'): Promise<string> {
  const session = await readJson<{ role: string; csrfToken?: string }>(await request.get(sessionUrl), 'GET /api/auth/session');
  if (session.role !== role || session.csrfToken === undefined) {
    throw new Error(`e2e: the ${role} session reads as role "${session.role}", so it expired or was signed out.`);
  }
  return session.csrfToken;
}

export class AdminApi {
  private csrfToken: string | null = null;

  constructor(private readonly request: APIRequestContext) {}

  private async csrf(): Promise<string> {
    this.csrfToken ??= await sessionCsrfToken(this.request, '/api/auth/session', 'admin');
    return this.csrfToken;
  }

  async get<T>(path: string): Promise<T> {
    return readJson<T>(await this.request.get(path), `GET ${path}`);
  }

  async post<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
    return readJson<T>(await this.postResponse(path, body), `POST ${path}`);
  }

  /** The raw answer, for a test of a refusal. */
  async postResponse(path: string, body: Record<string, unknown> = {}): Promise<APIResponse> {
    return this.request.post(path, { data: body, headers: { [CSRF_HEADER]: await this.csrf() } });
  }

  /** The role of the run's admin session, which reads `anonymous` once that session ends. */
  async sessionRole(): Promise<string> {
    return (await this.get<{ role: string }>('/api/auth/session')).role;
  }

  /** Opens a code, or replaces the open one, and returns the first LAN join link. */
  async openJukebox(): Promise<string> {
    const code = await this.post<JukeboxCode>('/api/jukebox/key', { lifetimeHours: JUKEBOX_CODE_LIFETIME_HOURS, signOutGuests: false });
    return firstLanLink(code).url;
  }

  jukeboxCode(): Promise<JukeboxCode> {
    return this.get('/api/jukebox/code');
  }

  /** The live code's first LAN link, which the Jukebox dialog shows unless the host picks another. */
  async liveJoinLink(): Promise<JoinLink> {
    return firstLanLink(await this.jukeboxCode());
  }

  closeJukebox(): Promise<{ revoked: boolean }> {
    return this.post('/api/jukebox/key/revoke');
  }

  async guests(): Promise<JukeboxGuest[]> {
    return (await this.get<{ guests: JukeboxGuest[] }>('/api/jukebox/guests')).guests;
  }

  async bans(): Promise<JukeboxBan[]> {
    return (await this.get<{ bans: JukeboxBan[] }>('/api/jukebox/bans')).bans;
  }

  /** Bans as the Ban button of the Guests dialog does, with a network ban when `networkBanHours` is above 0. */
  banGuest(sessionId: string, networkBanHours = 0): Promise<BanReply> {
    return this.post('/api/jukebox/guests/ban', { sessionId, networkBanHours });
  }

  async removeAllBans(): Promise<void> {
    for (const ban of await this.bans()) {
      await this.post('/api/jukebox/bans/remove', { banId: ban.id });
    }
  }

  async clearQueue(): Promise<void> {
    await this.post('/api/controls/clear');
  }

  async resetJukeboxSettings(): Promise<void> {
    await this.post('/api/jukebox/settings', { guestQueueLimit: DEFAULT_GUEST_QUEUE_LIMIT, shareLink: DEFAULT_JUKEBOX_SHARE_LINK });
  }

  async guestQueueLimit(): Promise<number> {
    return (await this.get<{ guestQueueLimit: number }>('/api/jukebox/settings')).guestQueueLimit;
  }

  async setGuestQueueLimit(limit: number): Promise<void> {
    await this.post('/api/jukebox/settings', { guestQueueLimit: limit });
  }

  async setVolume(level: number): Promise<void> {
    await this.post('/api/controls/volume', { level });
  }

  async playSong(id: string): Promise<void> {
    await this.post('/api/library/play', { type: 'song', id, mode: 'replace' });
  }

  /** Appends as the admin page does, so the song is labeled as the host's. On an empty queue it is selected paused. */
  async queueSong(id: string): Promise<void> {
    await this.post('/api/library/play', { type: 'song', id, mode: 'append' });
  }

  async searchAlbums(query: string): Promise<LibraryAlbum[]> {
    return (await this.get<{ albums: LibraryAlbum[] }>(`/api/library/search?q=${encodeURIComponent(query)}`)).albums;
  }

  async albumSongs(albumId: string): Promise<LibrarySong[]> {
    return (await this.get<{ songs: LibrarySong[] }>(`/api/library/album-songs?id=${encodeURIComponent(albumId)}`)).songs;
  }
}
