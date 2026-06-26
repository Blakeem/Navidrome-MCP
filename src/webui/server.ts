/**
 * Navidrome MCP Server - Web UI HTTP Server
 * Copyright (C) 2025
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { NavidromeClient } from '../client/navidrome-client.js';
import type { Config } from '../config.js';
import { logger } from '../utils/logger.js';
import type { SseBroadcaster } from './broadcaster.js';
import { writeError } from './http-helpers.js';
import { handleCover } from './routes/cover.js';
import { handleEvents } from './routes/events.js';
import { handleHealth } from './routes/health.js';
import { handleNetworkInfo } from './routes/network-info.js';
import { handleListPlaylists, handlePlayPlaylist, handlePlayStarredAlbums, handlePlayStarredSongs } from './routes/playlists.js';
import {
  handleClear,
  handleNext,
  handlePause,
  handlePlayQueueIndex,
  handlePrevious,
  handleResume,
  handleSeek,
  handleVolume,
} from './routes/controls.js';
import {
  handleGetPlayerSettings,
  handlePlayerState,
  handleSetPlayerSettings,
  handleShutdown,
} from './routes/player.js';
import { handleNowPlaying, handleQueue } from './routes/snapshot.js';
import { handleStatic } from './routes/static-files.js';

interface ServerDeps {
  config: Config;
  client: NavidromeClient;
  broadcaster: SseBroadcaster;
  /** Tear down the player (stop mpv + exit) — invoked by POST /api/shutdown. */
  shutdown: () => void;
}

/**
 * Build the underlying HTTP server. Listen/close lifecycle is owned by the
 * caller (`acquireOrAttach` in `src/web/acquire.ts`, driven by the standalone
 * `navidrome-web` entry) — this factory returns an unstarted instance so the
 * acquire/port-as-lock logic can bind it (or discard it) as needed.
 *
 * The dispatcher is a flat if-chain rather than a route table: ten endpoints
 * is below the threshold where pattern abstraction pays for itself, and a
 * linear read of the chain is the most reviewable form for security-sensitive
 * code (every accepted path is in plain sight).
 */
export function createServer(deps: ServerDeps): Server {
  return createHttpServer((req, res) => {
    handleRequest(req, res, deps).catch((err) => {
      logger.error('webui: unhandled handler error:', err);
      if (!res.headersSent) {
        writeError(res, 500, 'Internal server error');
      } else if (!res.writableEnded) {
        try {
          res.end();
        } catch {
          /* already ended */
        }
      }
    });
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
): Promise<void> {
  if (req.url === undefined) {
    writeError(res, 400, 'Missing URL');
    return;
  }

  // The base is irrelevant — we only consume pathname + searchParams. Use a
  // placeholder hostname so the URL parser doesn't reject relative inputs.
  let parsed: URL;
  try {
    parsed = new URL(req.url, 'http://localhost');
  } catch {
    writeError(res, 400, 'Malformed URL');
    return;
  }
  const path = parsed.pathname;
  const method = req.method ?? 'GET';

  // --- Health signature (port-as-lock coexistence) ---
  if (method === 'GET' && path === '/healthz') {
    handleHealth(req, res, deps.config);
    return;
  }

  // --- API: snapshot reads ---
  if (method === 'GET' && path === '/api/now-playing') {
    return handleNowPlaying(res, deps.client);
  }
  if (method === 'GET' && path === '/api/queue') {
    return handleQueue(res, deps.client);
  }

  // --- API: SSE stream ---
  if (method === 'GET' && path === '/api/events') {
    return handleEvents(res, deps.broadcaster);
  }

  // --- API: control actions ---
  if (method === 'POST' && path === '/api/controls/pause')    return handlePause(res);
  if (method === 'POST' && path === '/api/controls/resume')   return handleResume(res);
  if (method === 'POST' && path === '/api/controls/next')     return handleNext(res);
  if (method === 'POST' && path === '/api/controls/previous') return handlePrevious(res);
  if (method === 'POST' && path === '/api/controls/seek')       return handleSeek(req, res);
  if (method === 'POST' && path === '/api/controls/volume')     return handleVolume(req, res);
  if (method === 'POST' && path === '/api/controls/play-index') return handlePlayQueueIndex(req, res);
  if (method === 'POST' && path === '/api/controls/clear')      return handleClear(res);

  // --- API: network info ---
  if (method === 'GET' && path === '/api/network-info') {
    handleNetworkInfo(res, deps.config);
    return;
  }

  // --- API: playlists ---
  if (method === 'GET'  && path === '/api/playlists')      return handleListPlaylists(res, deps.client);
  if (method === 'POST' && path === '/api/playlists/play') return handlePlayPlaylist(req, res, deps.client);
  if (method === 'POST' && path === '/api/starred/songs/play') return handlePlayStarredSongs(req, res, deps.client);
  if (method === 'POST' && path === '/api/starred/albums/play') return handlePlayStarredAlbums(req, res, deps.client);

  // --- API: player state / settings / shutdown (settings + shutdown loopback-only) ---
  if (method === 'GET'  && path === '/api/player-state')     { handlePlayerState(req, res); return; }
  if (method === 'GET'  && path === '/api/player/settings')  { handleGetPlayerSettings(req, res); return; }
  if (method === 'POST' && path === '/api/player/settings')  return handleSetPlayerSettings(req, res);
  if (method === 'POST' && path === '/api/shutdown')         { handleShutdown(req, res, deps.shutdown); return; }

  // --- API: cover art proxy ---
  if (method === 'GET' && path.startsWith('/api/cover/')) {
    // A malformed percent-sequence (e.g. /api/cover/%GG) makes
    // decodeURIComponent throw a URIError; that's a client error, not a 500.
    let id: string;
    try {
      id = decodeURIComponent(path.slice('/api/cover/'.length));
    } catch {
      writeError(res, 400, 'Malformed cover id');
      return;
    }
    return handleCover(res, deps.config, id);
  }

  // --- Static / SPA index ---
  if (method === 'GET' && !path.startsWith('/api/')) {
    return handleStatic(res, path);
  }

  writeError(res, 404, 'Not found');
}
