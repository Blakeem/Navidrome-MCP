/**
 * Navidrome MCP Server - Web remote guest search, queue and nickname routes
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NavidromeClient } from '../../client/navidrome-client.js';
import { GuestNicknameSchema, GuestQueueAddSchema, GuestSearchQuerySchema, QueueEntryRemoveSchema } from '../../schemas/index.js';
import { fetchSongMetadata } from '../../tools/queue-sources.js';
import { searchAll } from '../../tools/search/index.js';
import { logger } from '../../utils/logger.js';
import { jukeboxNameOf, jukeboxNicknameOf, type AuthService } from '../auth/auth-service.js';
import type { SessionRecord } from '../auth/auth-store.js';
import type { GuestQueue } from '../jukebox/guest-queue.js';
import { readValidBody, runAction, writeError, writeJson, writeTooManyRequests } from '../http-helpers.js';

const GUEST_SEARCH_SONG_LIMIT = 20;
const UNKNOWN_SONG = 'That song is not in the library.';
const RADIO_PLAYING = 'A radio station is playing, so songs cannot be added until the host plays music again.';
const ALREADY_WAITING = 'That song is already waiting in the queue.';
const UNTRACKED =
  'The song was added, but the player did not report its place in the queue, so you cannot remove it and it does not count toward your limit.';
const NOT_YOURS = 'That song is not one of yours in the queue.';
const ALREADY_STARTED = 'That song already started playing, so only the host can remove it.';
const SIGNED_OUT = 'You are no longer signed in to the jukebox, so the song was not added.';
const NICKNAME_SIGNED_OUT = 'You are no longer signed in to the jukebox, so the name was not changed.';
const REMOVE_SIGNED_OUT = 'You are no longer signed in to the jukebox, so the song was not removed.';
const SEARCH_SIGNED_OUT = 'You are no longer signed in to the jukebox, so the search did not run.';

// The host logs as the host, so neither its nickname nor a guest label names it in a log line.
const HOST_LOG_NAME = 'the host';

type LiveCheck = Pick<AuthService, 'isLiveJukeboxSession'>;

function logNameOf(session: SessionRecord): string {
  return session.role === 'admin' ? HOST_LOG_NAME : jukeboxNameOf(session);
}

/**
 * Only the fields the guest page shows, so the rest of each library row stays with the host. The host
 * searches from the guest page only while a code is live.
 */
export async function handleGuestSearch(
  res: ServerResponse,
  client: NavidromeClient,
  guests: GuestQueue,
  auth: LiveCheck,
  session: SessionRecord,
  rawQuery: string | null,
): Promise<void> {
  const parsedQuery = GuestSearchQuerySchema.safeParse(rawQuery);
  if (!parsedQuery.success) {
    writeError(res, 400, parsedQuery.error.issues[0]?.message ?? 'Invalid query');
    return;
  }
  if (!auth.isLiveJukeboxSession(session.id)) {
    writeJson(res, 401, { error: SEARCH_SIGNED_OUT, code: 'signed-out' });
    return;
  }
  const waitMs = guests.searches.tryTake(session.id);
  if (waitMs > 0) {
    writeTooManyRequests(res, waitMs, 'searches');
    return;
  }

  return runAction(res, async () => {
    const result = await searchAll(
      client,
      { query: parsedQuery.data, artistCount: 0, albumCount: 0, songCount: GUEST_SEARCH_SONG_LIMIT, sort: 'playCount', order: 'DESC' },
      { keep: ['duration'] },
    );
    return {
      songs: result.songs.map(({ id, title, artist, album, duration }) => ({ id, title, artist, album, duration: duration ?? null })),
    };
  });
}

/**
 * A refusal carries a `code`, so the guest page branches on it instead of on the message text. The
 * session is checked before the library read, so a host with no live code never reaches Navidrome.
 */
export async function handleGuestAdd(
  req: IncomingMessage,
  res: ServerResponse,
  client: NavidromeClient,
  guests: GuestQueue,
  auth: LiveCheck,
  session: SessionRecord,
): Promise<void> {
  const input = await readValidBody(req, res, GuestQueueAddSchema);
  if (input === null) return;
  if (!auth.isLiveJukeboxSession(session.id)) {
    writeJson(res, 401, { error: SIGNED_OUT, code: 'signed-out' });
    return;
  }

  try {
    const [song] = await fetchSongMetadata(client, [input.songId], { scopeToActiveLibraries: true });
    if (song === undefined) {
      writeJson(res, 404, { error: UNKNOWN_SONG, code: 'unknown-song' });
      return;
    }
    const result = await guests.add(
      { sessionId: session.id, isHost: session.role === 'admin', currentLabel: () => jukeboxNameOf(session), isLive: () => auth.isLiveJukeboxSession(session.id) },
      song,
    );
    switch (result.kind) {
      case 'signed-out':
        writeJson(res, 401, { error: SIGNED_OUT, code: 'signed-out' });
        return;
      case 'radio':
        writeJson(res, 409, { error: RADIO_PLAYING, code: 'radio' });
        return;
      case 'limit':
        writeJson(res, 429, { error: limitMessage(result.limit), code: 'limit' });
        return;
      case 'duplicate':
        writeJson(res, 409, { error: ALREADY_WAITING, code: 'duplicate' });
        return;
      case 'wait':
        writeTooManyRequests(res, result.waitMs, 'songs added at once');
        return;
      case 'untracked':
        logger.warn(`webui: mpv reported no entry id for a song ${logNameOf(session)} added, so the guest ledger skips it`);
        writeError(res, 502, UNTRACKED);
        return;
      case 'added':
        logger.info(`webui: ${logNameOf(session)} added a song to the queue`);
        writeJson(res, 200, { ok: true, entryId: result.entryId, remaining: result.remaining });
        return;
    }
  } catch (err) {
    writeError(res, 500, err instanceof Error ? err.message : 'unknown error');
  }
}

/** A ban or sign-out can land while the body or the queue is read, so the session is checked after each. */
export async function handleGuestRemove(
  req: IncomingMessage,
  res: ServerResponse,
  guests: GuestQueue,
  auth: LiveCheck,
  session: SessionRecord,
): Promise<void> {
  const input = await readValidBody(req, res, QueueEntryRemoveSchema);
  if (input === null) return;
  if (!auth.isLiveJukeboxSession(session.id)) {
    writeRemoveSignedOut(res);
    return;
  }

  try {
    const result = await guests.remove({ sessionId: session.id, isLive: () => auth.isLiveJukeboxSession(session.id) }, input.entryId);
    switch (result.kind) {
      case 'signed-out':
        writeRemoveSignedOut(res);
        return;
      case 'not-found':
        writeJson(res, 404, { error: NOT_YOURS, code: 'not-found' });
        return;
      case 'started':
        writeJson(res, 409, { error: ALREADY_STARTED, code: 'started' });
        return;
      case 'removed':
        logger.info(`webui: ${logNameOf(session)} removed one of their songs from the queue`);
        writeJson(res, 200, { ok: true, remaining: result.remaining });
        return;
    }
  } catch (err) {
    writeError(res, 500, err instanceof Error ? err.message : 'unknown error');
  }
}

/**
 * A ban or sign-out can land while the body is read, so the session is checked again before any write.
 * A name the server already holds spends no budget, since a second tab may save it again.
 */
export async function handleGuestNickname(
  req: IncomingMessage,
  res: ServerResponse,
  auth: Pick<AuthService, 'isLiveJukeboxSession' | 'jukeboxNameConflict' | 'takeNicknameToken' | 'setJukeboxNickname'>,
  guests: Pick<GuestQueue, 'relabel' | 'ledger'>,
  session: SessionRecord,
): Promise<void> {
  const input = await readValidBody(req, res, GuestNicknameSchema);
  if (input === null) return;
  if (!auth.isLiveJukeboxSession(session.id)) {
    writeJson(res, 401, { error: NICKNAME_SIGNED_OUT, code: 'signed-out' });
    return;
  }
  if (input.nickname === jukeboxNicknameOf(session)) {
    writeJson(res, 200, { ok: true, nickname: input.nickname });
    return;
  }
  const nameConflict = auth.jukeboxNameConflict(input.nickname, session.role, guests.ledger.addedByNames());
  if (nameConflict !== null) {
    writeError(res, 400, nameConflict);
    return;
  }

  const waitMs = auth.takeNicknameToken(session.id);
  if (waitMs > 0) {
    writeTooManyRequests(res, waitMs, 'name changes');
    return;
  }
  auth.setJukeboxNickname(session, input.nickname);
  guests.relabel(session.id, jukeboxNameOf(session));
  logger.info(`webui: ${session.role === 'guest' ? session.label : HOST_LOG_NAME} changed their nickname`);
  writeJson(res, 200, { ok: true, nickname: input.nickname });
}

function writeRemoveSignedOut(res: ServerResponse): void {
  writeJson(res, 401, { error: REMOVE_SIGNED_OUT, code: 'signed-out' });
}

function limitMessage(limit: number): string {
  const songs = limit === 1 ? '1 song' : `${String(limit)} songs`;
  return `A guest can have at most ${songs} waiting at a time. Add another once one of yours starts playing or you remove one.`;
}
