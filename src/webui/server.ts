/**
 * Navidrome MCP Server - Web UI HTTP Server
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
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
import { isJsonContentType, writeError } from './http-helpers.js';
import { isLoopbackHostHeader } from './loopback.js';
import { isLanReachable } from './network.js';
import { handleCover } from './routes/cover.js';
import { handleEvents } from './routes/events.js';
import { handleHealth } from './routes/health.js';
import {
  handleLibraryAlbumSongs,
  handleLibraryArtistAlbums,
  handleLibraryFavorites,
  handleLibraryPlay,
  handleLibraryRecent,
  handleLibrarySearch,
} from './routes/library.js';
import { handleLyrics } from './routes/lyrics.js';
import { handleNetworkInfo } from './routes/network-info.js';
import { handleListPlaylists } from './routes/playlists.js';
import {
  handleClear,
  handleNext,
  handlePause,
  handlePlayQueueIndex,
  handlePrevious,
  handleResume,
  handleSeek,
  handleShuffle,
  handleVolume,
} from './routes/controls.js';
import {
  handleGetPlayerSettings,
  handleMcpLease,
  handlePlayerState,
  handleSetPlayerSettings,
  handleShutdown,
  MCP_LEASE_PATH,
  type McpLeaseCounter,
} from './routes/player.js';
import { handleStatic } from './routes/static-files.js';
import { handleVisualizerModes } from './routes/visualizer-modes.js';
import type { VisualizerHub } from './visualizer-hub.js';

interface ServerDeps {
  config: Config;
  client: NavidromeClient;
  broadcaster: SseBroadcaster;
  visualizer: Pick<VisualizerHub, 'addClient'>;
  shutdown: () => void;
  leases: McpLeaseCounter;
}

/**
 * The server is returned unstarted, so `acquireOrAttach` decides whether it binds. The dispatcher
 * is a flat if-chain, so every path this security-sensitive code accepts is in plain sight.
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

// A malformed percent sequence such as %GG is a client error, so a URIError maps to null.
function decodePathParam(path: string, prefix: string): string | null {
  try {
    return decodeURIComponent(path.slice(prefix.length));
  } catch {
    return null;
  }
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

  // Only pathname and searchParams are read, so a placeholder base lets the URL parser accept a
  // relative input.
  let parsed: URL;
  try {
    parsed = new URL(req.url, 'http://localhost');
  } catch {
    writeError(res, 400, 'Malformed URL');
    return;
  }
  const path = parsed.pathname;
  const method = req.method ?? 'GET';

  // DNS-rebinding guard for a loopback bind, the same model as the MCP transport's Host allowlist.
  if (!isLanReachable(deps.config.webui.host) && !isLoopbackHostHeader(req.headers.host)) {
    writeError(res, 403, 'Forbidden host');
    return;
  }

  // A cross-site page cannot send this header without a CORS preflight, which this server never
  // approves.
  if (method === 'POST' && !isJsonContentType(req.headers['content-type'])) {
    writeError(res, 415, 'Content-Type must be application/json');
    return;
  }

  if (method === 'GET' && path === '/healthz') {
    handleHealth(req, res, deps.config);
    return;
  }

  if (method === 'GET' && path === '/api/events') {
    return handleEvents(res, deps.broadcaster);
  }
  if (method === 'GET' && path === '/api/visualizer') {
    deps.visualizer.addClient(res);
    return;
  }
  if (method === 'GET' && path === '/api/visualizer/modes') return handleVisualizerModes(res);

  if (method === 'POST' && path === '/api/controls/pause')    return handlePause(res);
  if (method === 'POST' && path === '/api/controls/resume')   return handleResume(res);
  if (method === 'POST' && path === '/api/controls/next')     return handleNext(res);
  if (method === 'POST' && path === '/api/controls/previous') return handlePrevious(res);
  if (method === 'POST' && path === '/api/controls/seek')       return handleSeek(req, res);
  if (method === 'POST' && path === '/api/controls/volume')     return handleVolume(req, res);
  if (method === 'POST' && path === '/api/controls/play-index') return handlePlayQueueIndex(req, res);
  if (method === 'POST' && path === '/api/controls/clear')      return handleClear(res);
  if (method === 'POST' && path === '/api/controls/shuffle')    return handleShuffle(res);

  if (method === 'GET' && path === '/api/network-info') {
    handleNetworkInfo(res, deps.config);
    return;
  }

  if (method === 'GET' && path === '/api/playlists') return handleListPlaylists(res, deps.client);

  if (method === 'GET' && path === '/api/library/recent')        return handleLibraryRecent(res, deps.client);
  if (method === 'GET' && path === '/api/library/search')        return handleLibrarySearch(res, deps.client, parsed.searchParams.get('q'));
  if (method === 'GET' && path === '/api/library/artist-albums') return handleLibraryArtistAlbums(res, deps.client, parsed.searchParams.get('id'));
  if (method === 'GET' && path === '/api/library/album-songs')   return handleLibraryAlbumSongs(res, deps.client, parsed.searchParams.get('id'));
  if (method === 'GET' && path === '/api/library/favorites')     return handleLibraryFavorites(res, deps.client);
  if (method === 'POST' && path === '/api/library/play')         return handleLibraryPlay(req, res, deps.client);

  if (method === 'GET'  && path === '/api/player-state')     { handlePlayerState(req, res, deps.config); return; }
  if (method === 'GET'  && path === '/api/player/settings')  { handleGetPlayerSettings(req, res, deps.config); return; }
  if (method === 'POST' && path === '/api/player/settings')  return handleSetPlayerSettings(req, res, deps.config, deps.broadcaster);
  if (method === 'POST' && path === '/api/shutdown')         { handleShutdown(req, res, deps.shutdown); return; }
  if (method === 'POST' && path === MCP_LEASE_PATH)          { handleMcpLease(req, res, deps.leases); return; }

  if (method === 'GET' && path.startsWith('/api/cover/')) {
    const id = decodePathParam(path, '/api/cover/');
    if (id === null) {
      writeError(res, 400, 'Malformed cover id');
      return;
    }
    return handleCover(res, deps.config, id, parsed.searchParams.get('size'));
  }

  if (method === 'GET' && path.startsWith('/api/lyrics/')) {
    const songId = decodePathParam(path, '/api/lyrics/');
    if (songId === null) {
      writeError(res, 400, 'Malformed lyrics id');
      return;
    }
    return handleLyrics(res, deps.config, deps.client, songId);
  }

  if (method === 'GET' && !path.startsWith('/api/')) {
    return handleStatic(res, path);
  }

  writeError(res, 404, 'Not found');
}
