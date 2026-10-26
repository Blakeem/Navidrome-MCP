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
import { createServer as createHttpsServer } from 'node:https';
import type { Socket } from 'node:net';
import type { NavidromeClient } from '../client/navidrome-client.js';
import type { Config } from '../config.js';
import { logger } from '../utils/logger.js';
import type { SseBroadcaster } from './broadcaster.js';
import { endGuestStream, MAX_GUESTS_PER_CODE, type AuthService } from './auth/auth-service.js';
import { authorize, resolvePrincipal, type Principal } from './auth/principal.js';
import { JOIN_ROUTE_PATH } from './auth/session-cookie.js';
import type { SessionRecord } from './auth/auth-store.js';
import type { Permission } from './auth/roles.js';
import {
  isCrossOriginPost,
  isJsonContentType,
  openSseStream,
  setSecurityHeaders,
  writeError,
  writeJson,
  writeRedirect,
} from './http-helpers.js';
import { isLoopbackHostHeader, isRebindSafeHostHeader } from './loopback.js';
import { isLanReachable } from './network.js';
import type { GuestQueue } from './jukebox/guest-queue.js';
import { ADMIN_PAGE_PATH, GUEST_PAGE_PATH } from './page-paths.js';
import { handleAuthSession, handleJoin, handleLogin, handleLogout } from './routes/auth.js';
import { handleCover } from './routes/cover.js';
import { handleEvents, handleGuestEvents } from './routes/events.js';
import { handleGuestAdd, handleGuestNickname, handleGuestRemove, handleGuestSearch } from './routes/guest-queue.js';
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
import {
  handleCreateJukeboxCode,
  handleGetJukeboxCode,
  handleGetJukeboxStatus,
  handleGetJukeboxSettings,
  handleRevokeJukeboxCode,
  handleSetJukeboxSettings,
} from './routes/jukebox.js';
import { handleBanGuest, handleListBans, handleListGuests, handleRemoveBan, handleRemoveGuest } from './routes/jukebox-guests.js';
import { handleListPlaylists } from './routes/playlists.js';
import {
  handleAudioDevice,
  handleAudioDevices,
  handleClear,
  handleNext,
  handlePause,
  handlePlayQueueIndex,
  handlePrevious,
  handleQueueRemove,
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
import { handleStatic, PUBLIC_DIR } from './routes/static-files.js';
import { handleVisualizerModes } from './routes/visualizer-modes.js';
import { classifySource, networkKey, sourceAddress } from './source-address.js';
import { REFUSED_STREAM_RETRY_MS, StreamLimiter, type StreamRoute } from './stream-limiter.js';
import { isTlsEnabled, loadTlsPair, TLS_MIN_VERSION, watchTlsPair } from './tls.js';
import type { VisualizerHub } from './visualizer-hub.js';

interface ServerDeps {
  config: Config;
  client: NavidromeClient;
  broadcaster: SseBroadcaster;
  visualizer: Pick<VisualizerHub, 'addClient'>;
  shutdown: () => void;
  leases: McpLeaseCounter;
  auth: AuthService;
  guests: GuestQueue;
}

/**
 * Tighter than Node's defaults, since the remote may face the internet. `keepAliveTimeout` and
 * `maxHeaderSize` equal today's defaults and are pinned so a Node upgrade cannot change them.
 * Browsers send every cookie of the host name on every port, so a header cap below 16 KiB refuses
 * a browser that other local apps filled with cookies. `requestTimeout` bounds only the receipt of a
 * request, so an SSE response stays open past it.
 */
const SERVER_OPTIONS = {
  headersTimeout: 10_000,
  requestTimeout: 30_000,
  keepAliveTimeout: 5_000,
  maxHeaderSize: 16 * 1024,
} as const;
const MAX_HEADERS_COUNT = 64;
const MAX_REQUESTS_PER_SOCKET = 1000;
const TLS_HANDSHAKE_TIMEOUT_MS = 10_000;

type RequestListener = (req: IncomingMessage, res: ServerResponse) => void;

interface ConnectionLimits {
  lan: number;
  perPeer: number;
  public: number;
  perPublicNetwork: number;
}

/**
 * Node's `server.maxConnections` also counts loopback sockets, so idle remote sockets could lock out
 * the MCP health probe and lease. Internet peers draw from their own budget, which never touches the
 * LAN budget. Unless they can log in or join the jukebox, they only ever get the 403, so their budget
 * stays small. The per-peer and per-network caps stop one LAN device or one internet network from
 * taking every slot.
 */
const CONNECTION_LIMITS: ConnectionLimits = { lan: 256, perPeer: 64, public: 8, perPublicNetwork: 8 };
// A browser holds up to six sockets plus two streams, so a remote admin needs a larger budget.
const INTERNET_PEER_CONNECTION_LIMITS: ConnectionLimits = { ...CONNECTION_LIMITS, public: 64, perPublicNetwork: 16 };
// An open guest page holds the guest stream, the visualizer stream and one keep-alive fetch socket.
const SOCKETS_PER_GUEST_PAGE = 3;
// Guests on mobile data can share one carrier-NAT address, so one internet network may hold this many pages.
const GUEST_PAGES_PER_PUBLIC_NETWORK = 20;
/**
 * A jukebox code admits `MAX_GUESTS_PER_CODE` guests from the LAN or the internet, so both budgets grow by
 * that many pages. A router's NAT loopback can show every Wi-Fi guest on the internet link as the
 * router's own LAN address, so one LAN peer may hold as many pages as one internet network.
 */
const JUKEBOX_CONNECTION_LIMITS: ConnectionLimits = {
  lan: CONNECTION_LIMITS.lan + MAX_GUESTS_PER_CODE * SOCKETS_PER_GUEST_PAGE,
  perPeer: CONNECTION_LIMITS.perPeer + GUEST_PAGES_PER_PUBLIC_NETWORK * SOCKETS_PER_GUEST_PAGE,
  public: INTERNET_PEER_CONNECTION_LIMITS.public + MAX_GUESTS_PER_CODE * SOCKETS_PER_GUEST_PAGE,
  perPublicNetwork: INTERNET_PEER_CONNECTION_LIMITS.perPublicNetwork + GUEST_PAGES_PER_PUBLIC_NETWORK * SOCKETS_PER_GUEST_PAGE,
};

const PUBLIC_SOURCE_REFUSAL =
  'The web remote refuses internet addresses unless Access uses the admin password and the admin login is allowed ' +
  'from anywhere, or Access includes the jukebox and a jukebox code is open. Connect from the local network or over a VPN, or change the access settings on the settings page.';

const NETWORK_BAN_REFUSAL = 'Access denied';

type InternetAccess = Pick<AuthService, 'mode' | 'adminAccess' | 'hasJukeboxCode'>;

/**
 * Mode `none` has no login, so it refuses every internet peer. In the other modes an internet peer can
 * log in only at level `anywhere`, and can join only in mode `jukebox` while a code is open.
 */
function servesInternetPeers(auth: InternetAccess): boolean {
  if (auth.mode === 'none') return false;
  return auth.adminAccess === 'anywhere' || isJukeboxOpen(auth);
}

function isJukeboxOpen(auth: InternetAccess): boolean {
  return auth.mode === 'jukebox' && auth.hasJukeboxCode();
}

export function connectionLimitsFor(auth: InternetAccess): ConnectionLimits {
  if (!servesInternetPeers(auth)) return CONNECTION_LIMITS;
  return isJukeboxOpen(auth) ? JUKEBOX_CONNECTION_LIMITS : INTERNET_PEER_CONNECTION_LIMITS;
}

/** The server is returned unstarted, so `acquireOrAttach` decides whether it binds. */
export function createServer(deps: ServerDeps): Server {
  const streams = new StreamLimiter();
  const server = createListener(deps.config.webui.tls, (req, res) => {
    setSecurityHeaders(res);
    handleRequest(req, res, deps, streams).catch((err) => {
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
  server.maxHeadersCount = MAX_HEADERS_COUNT;
  server.maxRequestsPerSocket = MAX_REQUESTS_PER_SOCKET;
  // A jukebox code can start or end while the server runs, so each socket reads the limits it meets.
  server.on('connection', createConnectionLimiter(() => connectionLimitsFor(deps.auth)));
  return server;
}

/** An unreadable or invalid pair throws here, so the web remote never falls back to plain HTTP. */
function createListener(tls: Config['webui']['tls'], onRequest: RequestListener): Server {
  if (!isTlsEnabled(tls)) return createHttpServer(SERVER_OPTIONS, onRequest);
  const server = createHttpsServer(
    { ...SERVER_OPTIONS, ...loadTlsPair(tls), minVersion: TLS_MIN_VERSION, handshakeTimeout: TLS_HANDSHAKE_TIMEOUT_MS },
    onRequest,
  );
  // Watched only while bound, since a server that lost the bind race is dropped without a close.
  server.once('listening', () => {
    server.once('close', watchTlsPair(server, tls));
  });
  return server;
}

export function createConnectionLimiter(limitsFor: () => ConnectionLimits): (socket: Socket) => void {
  const lanBudget = createConnectionBudget();
  const publicBudget = createConnectionBudget();

  return (socket) => {
    const peer = socket.remoteAddress;
    const source = classifySource(peer);
    if (source === 'loopback') return;

    // The kernel reports one LAN peer in one address form per listener, so the raw address keys it.
    // One internet customer usually holds a whole IPv6 /64, so the network keys an internet peer.
    const limits = limitsFor();
    const admitted = source === 'lan' && peer !== undefined
      ? lanBudget.admit(peer, socket, limits.lan, limits.perPeer)
      : publicBudget.admit(networkKey(peer), socket, limits.public, limits.perPublicNetwork);
    if (!admitted) socket.destroy();
  };
}

interface ConnectionBudget {
  admit(key: string, socket: Socket, total: number, perKey: number): boolean;
}

/** The caps come with each socket, so a lowered cap only refuses new sockets and never closes open ones. */
function createConnectionBudget(): ConnectionBudget {
  const openByKey = new Map<string, number>();
  let open = 0;

  return {
    admit(key: string, socket: Socket, total: number, perKey: number): boolean {
      const openForKey = openByKey.get(key) ?? 0;
      if (open >= total || openForKey >= perKey) return false;
      open += 1;
      openByKey.set(key, openForKey + 1);
      socket.once('close', () => {
        open -= 1;
        const remaining = (openByKey.get(key) ?? 1) - 1;
        if (remaining === 0) openByKey.delete(key);
        else openByKey.set(key, remaining);
      });
      return true;
    },
  };
}

// A malformed percent sequence such as %GG is a client error, so a URIError maps to null.
function decodePathParam(path: string, prefix: string): string | null {
  try {
    return decodeURIComponent(path.slice(prefix.length));
  } catch {
    return null;
  }
}

interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  deps: ServerDeps;
  streams: StreamLimiter;
  url: URL;
  principal: Principal;
}

/** `public` routes skip the principal check. `/healthz` and the MCP lease keep their own loopback rule. */
type RouteAccess = Permission | 'public';

interface Route {
  method: 'GET' | 'POST';
  path: string;
  /** Matches every path under `path`, whose remainder the handler decodes. */
  prefix?: true;
  access: RouteAccess;
  handle: (ctx: RouteContext) => void | Promise<void>;
}

/**
 * Counts the stream against the stream caps. The server-wide cap refuses a stream with an empty
 * stream that ends at once, so the browser reconnects after the retry interval.
 * Logout, expiry, a password change and closing the jukebox close a session's streams, so each stream
 * is tagged with it.
 */
function admitStream({ deps, principal, req, res, streams }: RouteContext, route: StreamRoute): boolean {
  const sessionId = sessionIdOf(principal);
  const address = req.socket.remoteAddress;
  if (!streams.admit(res, route, sessionId, address)) {
    openSseStream(res, REFUSED_STREAM_RETRY_MS);
    res.end();
    return false;
  }
  if (sessionId !== null) deps.auth.trackStream(sessionId, res, address, route === '/api/guest/events');
  return true;
}

function serveEvents(ctx: RouteContext): Promise<void> | void {
  if (!admitStream(ctx, '/api/events')) return;
  return handleEvents(ctx.res, ctx.deps.broadcaster);
}

function serveVisualizer(ctx: RouteContext): void {
  if (!admitStream(ctx, '/api/visualizer')) return;
  ctx.deps.visualizer.addClient(ctx.res);
}

function sessionIdOf(principal: Principal): string | null {
  return principal.kind === 'admin' || principal.kind === 'guest' ? principal.session.id : null;
}

/**
 * `jukebox.view` admits only an admin or a guest session, so the first check never refuses a request the
 * dispatcher passed. An admin session with no live code ends its stream as a closed jukebox, so the
 * host's guest page stops reconnecting and shows the closed card.
 */
function serveGuestEvents(ctx: RouteContext): Promise<void> | void {
  const sessionId = sessionIdOf(ctx.principal);
  if (sessionId === null) {
    writeError(ctx.res, 403, 'Forbidden');
    return;
  }
  if (ctx.deps.auth.guestJukeboxFor(sessionId) === null) {
    openSseStream(ctx.res, REFUSED_STREAM_RETRY_MS);
    endGuestStream(ctx.res, 'closed');
    return;
  }
  if (!admitStream(ctx, '/api/guest/events')) return;
  return handleGuestEvents(ctx.res, ctx.deps.broadcaster, sessionId, () => ctx.deps.auth.guestJukeboxFor(sessionId));
}

/**
 * `jukebox.queue` admits only a guest session, or an admin session that queues as the host, so this check
 * never refuses a request the dispatcher passed.
 */
function guestRoute(handle: (ctx: RouteContext, session: SessionRecord) => Promise<void>): (ctx: RouteContext) => Promise<void> | void {
  return (ctx) => {
    if (ctx.principal.kind !== 'guest' && ctx.principal.kind !== 'admin') {
      writeError(ctx.res, 403, 'Forbidden');
      return;
    }
    return handle(ctx, ctx.principal.session);
  };
}

const JOIN_PATH_HEADERS: Readonly<Record<string, string>> = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

// The static fallback would also serve the file at /guest.html, so both paths take this handler and its headers.
function serveGuestPage({ res }: RouteContext): Promise<void> {
  return handleStatic(res, '/guest.html', PUBLIC_DIR, JOIN_PATH_HEADERS);
}

function serveAdminPage({ res }: RouteContext): Promise<void> {
  return handleStatic(res, '/index.html');
}

// Old bookmarks name the file, which now has its own path.
function redirectToAdminPage({ res }: RouteContext): void {
  writeRedirect(res, ADMIN_PAGE_PATH);
}

/** Mode `jukebox` labels an admin session's adds as the host's, so guests see where they came from. */
function labelsHostAdds(auth: Pick<AuthService, 'mode'>, principal: Principal): boolean {
  return auth.mode === 'jukebox' && principal.kind === 'admin';
}

// Page routing only picks a page, since every `/api/` route checks its own access.
function routeRoot({ res, deps, principal }: RouteContext): void {
  const guestLanding = deps.auth.mode === 'jukebox' && principal.kind !== 'admin';
  writeRedirect(res, guestLanding ? GUEST_PAGE_PATH : ADMIN_PAGE_PATH);
}

function handlePathParamRoute(
  { res, url }: RouteContext,
  prefix: string,
  label: string,
  handle: (id: string) => Promise<void>,
): Promise<void> | void {
  const id = decodePathParam(url.pathname, prefix);
  if (id === null) {
    writeError(res, 400, `Malformed ${label} id`);
    return;
  }
  return handle(id);
}

/**
 * Every `/api/` path and every non-GET request needs an entry here, which names its access, or it gets
 * 404. Any other GET path is a public static file. The flat table keeps every gated path in plain sight.
 */
const ROUTES: readonly Route[] = [
  { method: 'GET',  path: '/healthz',                   access: 'public',          handle: ({ req, res, deps }) => handleHealth(req, res, deps.config) },
  { method: 'POST', path: MCP_LEASE_PATH,               access: 'public',          handle: ({ req, res, deps }) => handleMcpLease(req, res, deps.leases) },
  { method: 'GET',  path: '/api/auth/session',          access: 'public',          handle: ({ req, res, deps }) => handleAuthSession(req, res, deps.auth) },
  { method: 'POST', path: '/api/auth/login',            access: 'public',          handle: ({ req, res, deps }) => handleLogin(req, res, deps.auth) },
  { method: 'POST', path: '/api/auth/logout',           access: 'auth.self',       handle: ({ req, res, deps, principal }) => handleLogout(req, res, deps.auth, principal) },
  { method: 'GET',  path: '/',                          access: 'public',          handle: routeRoot },
  { method: 'GET',  path: '/index.html',                access: 'public',          handle: redirectToAdminPage },
  { method: 'GET',  path: ADMIN_PAGE_PATH,              access: 'public',          handle: serveAdminPage },
  { method: 'GET',  path: GUEST_PAGE_PATH,              access: 'public',          handle: serveGuestPage },
  { method: 'GET',  path: '/guest.html',                access: 'public',          handle: serveGuestPage },
  { method: 'POST', path: JOIN_ROUTE_PATH,              access: 'public',          handle: ({ req, res, deps }) => handleJoin(req, res, deps.auth, deps.guests) },

  { method: 'GET',  path: '/api/events',                access: 'player.view',     handle: serveEvents },
  { method: 'GET',  path: '/api/player-state',          access: 'player.view',     handle: ({ req, res, deps }) => handlePlayerState(req, res, deps.config) },
  { method: 'GET',  path: '/api/visualizer',            access: 'player.media',    handle: serveVisualizer },
  { method: 'GET',  path: '/api/visualizer/modes',      access: 'player.media',    handle: ({ res }) => handleVisualizerModes(res) },

  { method: 'GET',  path: '/api/guest/events',          access: 'jukebox.view',    handle: serveGuestEvents },
  { method: 'GET',  path: '/api/guest/search',          access: 'jukebox.queue',   handle: guestRoute(({ res, deps, url }, session) => handleGuestSearch(res, deps.client, deps.guests, deps.auth, session, url.searchParams.get('q'))) },
  { method: 'POST', path: '/api/guest/queue',           access: 'jukebox.queue',   handle: guestRoute(({ req, res, deps }, session) => handleGuestAdd(req, res, deps.client, deps.guests, deps.auth, session)) },
  { method: 'POST', path: '/api/guest/queue/remove',    access: 'jukebox.queue',   handle: guestRoute(({ req, res, deps }, session) => handleGuestRemove(req, res, deps.guests, deps.auth, session)) },
  { method: 'POST', path: '/api/guest/nickname',        access: 'jukebox.queue',   handle: guestRoute(({ req, res, deps }, session) => handleGuestNickname(req, res, deps.auth, deps.guests, session)) },
  { method: 'GET',  path: '/api/jukebox/key',           access: 'jukebox.manage',  handle: ({ res, deps }) => handleGetJukeboxStatus(res, deps.auth) },
  { method: 'GET',  path: '/api/jukebox/code',          access: 'jukebox.manage',  handle: ({ res, deps }) => handleGetJukeboxCode(res, deps.auth, deps.config) },
  { method: 'POST', path: '/api/jukebox/key',           access: 'jukebox.manage',  handle: ({ req, res, deps }) => handleCreateJukeboxCode(req, res, deps.auth, deps.config, deps.broadcaster) },
  { method: 'POST', path: '/api/jukebox/key/revoke',    access: 'jukebox.manage',  handle: ({ req, res, deps }) => handleRevokeJukeboxCode(req, res, deps.auth) },
  { method: 'GET',  path: '/api/jukebox/settings',      access: 'jukebox.manage',  handle: ({ res }) => handleGetJukeboxSettings(res) },
  { method: 'POST', path: '/api/jukebox/settings',      access: 'jukebox.manage',  handle: ({ req, res, deps }) => handleSetJukeboxSettings(req, res, deps.broadcaster) },
  { method: 'GET',  path: '/api/jukebox/guests',        access: 'jukebox.manage',  handle: ({ res, deps }) => handleListGuests(res, deps.auth, deps.guests) },
  { method: 'POST', path: '/api/jukebox/guests/remove', access: 'jukebox.manage',  handle: ({ req, res, deps }) => handleRemoveGuest(req, res, deps.auth) },
  { method: 'POST', path: '/api/jukebox/guests/ban',    access: 'jukebox.manage',  handle: ({ req, res, deps }) => handleBanGuest(req, res, deps.auth, deps.guests) },
  { method: 'GET',  path: '/api/jukebox/bans',          access: 'jukebox.manage',  handle: ({ res, deps }) => handleListBans(res, deps.auth) },
  { method: 'POST', path: '/api/jukebox/bans/remove',   access: 'jukebox.manage',  handle: ({ req, res, deps }) => handleRemoveBan(req, res, deps.auth) },

  { method: 'POST', path: '/api/controls/pause',        access: 'player.control',  handle: ({ res }) => handlePause(res) },
  { method: 'POST', path: '/api/controls/resume',       access: 'player.control',  handle: ({ res }) => handleResume(res) },
  { method: 'POST', path: '/api/controls/next',         access: 'player.control',  handle: ({ res }) => handleNext(res) },
  { method: 'POST', path: '/api/controls/previous',     access: 'player.control',  handle: ({ res }) => handlePrevious(res) },
  { method: 'POST', path: '/api/controls/seek',         access: 'player.control',  handle: ({ req, res }) => handleSeek(req, res) },
  { method: 'POST', path: '/api/controls/volume',       access: 'player.control',  handle: ({ req, res }) => handleVolume(req, res) },
  { method: 'POST', path: '/api/controls/play-index',   access: 'player.control',  handle: ({ req, res }) => handlePlayQueueIndex(req, res) },
  { method: 'POST', path: '/api/controls/clear',        access: 'player.control',  handle: ({ res }) => handleClear(res) },
  { method: 'POST', path: '/api/controls/queue/remove', access: 'player.control',  handle: ({ req, res, deps }) => handleQueueRemove(req, res, deps.guests) },
  { method: 'POST', path: '/api/controls/shuffle',      access: 'player.control',  handle: ({ res }) => handleShuffle(res) },
  { method: 'POST', path: '/api/library/play',          access: 'player.control',  handle: ({ req, res, deps, principal }) => handleLibraryPlay(req, res, deps.client, labelsHostAdds(deps.auth, principal) ? deps.guests : null) },

  { method: 'GET',  path: '/api/audio-devices',         access: 'player.output',   handle: ({ res }) => handleAudioDevices(res) },
  { method: 'POST', path: '/api/controls/audio-device', access: 'player.output',   handle: ({ req, res }) => handleAudioDevice(req, res) },

  { method: 'GET',  path: '/api/playlists',             access: 'library.browse',  handle: ({ res, deps }) => handleListPlaylists(res, deps.client) },
  { method: 'GET',  path: '/api/library/recent',        access: 'library.browse',  handle: ({ res, deps }) => handleLibraryRecent(res, deps.client) },
  { method: 'GET',  path: '/api/library/search',        access: 'library.browse',  handle: ({ res, deps, url }) => handleLibrarySearch(res, deps.client, url.searchParams.get('q')) },
  { method: 'GET',  path: '/api/library/artist-albums', access: 'library.browse',  handle: ({ res, deps, url }) => handleLibraryArtistAlbums(res, deps.client, url.searchParams.get('id')) },
  { method: 'GET',  path: '/api/library/album-songs',   access: 'library.browse',  handle: ({ res, deps, url }) => handleLibraryAlbumSongs(res, deps.client, url.searchParams.get('id')) },
  { method: 'GET',  path: '/api/library/favorites',     access: 'library.browse',  handle: ({ res, deps }) => handleLibraryFavorites(res, deps.client) },

  { method: 'GET',  path: '/api/network-info',          access: 'host.info',       handle: ({ res, deps }) => handleNetworkInfo(res, deps.config) },
  { method: 'GET',  path: '/api/player/settings',       access: 'player.settings', handle: ({ res, deps }) => handleGetPlayerSettings(res, deps.config) },
  { method: 'POST', path: '/api/player/settings',       access: 'player.settings', handle: ({ req, res, deps }) => handleSetPlayerSettings(req, res, deps.config, deps.broadcaster) },
  { method: 'POST', path: '/api/shutdown',              access: 'player.power',    handle: ({ res, deps }) => handleShutdown(res, deps.shutdown) },

  {
    method: 'GET', path: '/api/cover/', prefix: true, access: 'player.media',
    handle: (ctx) => handlePathParamRoute(ctx, '/api/cover/', 'cover', (id) => handleCover(ctx.res, ctx.deps.config, id, ctx.url.searchParams.get('size'))),
  },
  {
    method: 'GET', path: '/api/lyrics/', prefix: true, access: 'player.media',
    handle: (ctx) => handlePathParamRoute(ctx, '/api/lyrics/', 'lyrics', (id) => handleLyrics(ctx.res, ctx.deps.config, ctx.deps.client, id)),
  },
];

/** Lets the route test prove it covers every route, so a route added later without a case fails it. */
export function listRoutes(): Array<Pick<Route, 'method' | 'path' | 'access'> & { prefix: boolean }> {
  return ROUTES.map(({ method, path, prefix, access }) => ({ method, path, prefix: prefix === true, access }));
}

function findRoute(method: string, path: string): Route | undefined {
  return ROUTES.find((route) => route.method === method && (route.prefix === true ? path.startsWith(route.path) : path === route.path));
}

const CSRF_HEADER = 'x-csrf-token';

/** Guests open the public URL's join link, so its host passes the LAN-bind host gate beside `allowedHosts`. */
function acceptedHostNames(config: Config): readonly string[] {
  const { allowedHosts, publicUrl } = config.webui;
  return publicUrl === null ? allowedHosts : [...allowedHosts, new URL(publicUrl).host];
}

/** Runs the access check a gated route needs. Returns false once it has written the refusal. */
function admitGatedRequest(req: IncomingMessage, res: ServerResponse, deps: ServerDeps, principal: Principal, permission: Permission): boolean {
  const decision = authorize(deps.auth.mode, principal, permission);
  if (!decision.ok) {
    writeJson(res, decision.status, decision.body);
    return false;
  }
  if (principal.kind !== 'admin' && principal.kind !== 'guest') return true;
  if (req.method === 'POST' && !deps.auth.isCsrfTokenValid(principal.session, req.headers[CSRF_HEADER])) {
    writeError(res, 403, 'Missing or wrong X-CSRF-Token header. Reload the page and try again.');
    return false;
  }
  deps.auth.touch(principal.session, sourceAddress(req.socket.remoteAddress));
  return true;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
  streams: StreamLimiter,
): Promise<void> {
  // A banned network learns nothing about the server, so the refusal comes before any other check.
  if (deps.auth.isNetworkBanned(req.socket.remoteAddress)) {
    writeError(res, 403, NETWORK_BAN_REFUSAL);
    return;
  }

  // Node drops header lines past the cap without an error, which could drop a same-host proxy's
  // X-Forwarded-* lines and make a proxied client look local.
  if (req.rawHeaders.length / 2 >= MAX_HEADERS_COUNT) {
    writeError(res, 431, 'Too many request headers');
    return;
  }

  if (!servesInternetPeers(deps.auth) && classifySource(req.socket.remoteAddress) === 'public') {
    writeError(res, 403, PUBLIC_SOURCE_REFUSAL);
    return;
  }

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

  const lanBind = isLanReachable(deps.config.webui.host);
  // DNS-rebinding guard for a loopback bind, the same model as the MCP transport's Host allowlist.
  if (!lanBind && !isLoopbackHostHeader(req.headers.host)) {
    writeError(res, 403, 'Forbidden host');
    return;
  }
  if (lanBind && !isRebindSafeHostHeader(req.headers.host, acceptedHostNames(deps.config))) {
    writeError(res, 403, 'Forbidden host. Add this host name to webui.allowedHosts to allow it.');
    return;
  }

  if (method === 'POST' && isCrossOriginPost(req)) {
    writeError(res, 403, 'Cross-origin request refused');
    return;
  }

  // A cross-site page cannot send this header without a CORS preflight, which this server never
  // approves.
  if (method === 'POST' && !isJsonContentType(req.headers['content-type'])) {
    writeError(res, 415, 'Content-Type must be application/json');
    return;
  }

  const route = findRoute(method, path);
  if (route === undefined) {
    // Static files are public, so the login page loads before any session exists.
    if (method === 'GET' && !path.startsWith('/api/')) return handleStatic(res, path);
    writeError(res, 404, 'Not found');
    return;
  }

  const principal = resolvePrincipal(req, deps.auth);
  if (route.access !== 'public' && !admitGatedRequest(req, res, deps, principal, route.access)) return;
  return route.handle({ req, res, deps, streams, url: parsed, principal });
}
