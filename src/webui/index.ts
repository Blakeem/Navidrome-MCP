/**
 * Navidrome MCP Server - Web UI Lifecycle
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

import type { Server } from 'node:http';
import type { NavidromeClient } from '../client/navidrome-client.js';
import type { Config } from '../config.js';
import { playbackEngine } from '../services/playback/playback-engine.js';
import { logger } from '../utils/logger.js';
import { SseBroadcaster } from './broadcaster.js';
import { createServer } from './server.js';
import { listLanInterfaces } from './network.js';

/**
 * Companion web UI for mpv playback control. Lifecycle is lazy by design:
 *
 *   - `init()` wires up subscriptions and (optionally) checks whether mpv is
 *     already playing something from a previous MCP session; if so, the port
 *     binds immediately. Otherwise nothing is bound — the port appears only
 *     once the engine starts producing state events (first `play_*` tool call
 *     in the current session).
 *   - `stop()` ends the SSE broadcaster, closes the HTTP server, and clears
 *     the subscription. Idempotent.
 *
 * Why lazy: users who don't have mpv installed shouldn't see a stray port
 * listener. Users who do have mpv but never play anything in a given session
 * shouldn't either. The "queued-at-startup" case is the only one where we
 * pre-bind, so a phone left on the desk gets a working URL the moment a
 * playlist resumes via the persistent mpv handoff.
 */
export class WebUIServer {
  private readonly broadcaster: SseBroadcaster;
  private httpServer: Server | null = null;
  private bindPromise: Promise<void> | null = null;
  private unsubscribeFromEngine: (() => void) | null = null;
  private stopped = false;

  constructor(
    private readonly config: Config,
    private readonly client: NavidromeClient,
  ) {
    this.broadcaster = new SseBroadcaster(client);
  }

  /**
   * Begin observing engine state. Performs a silent attach attempt against
   * any pre-existing mpv (no spawn) so a freshly-restarted MCP server with a
   * non-empty queue can offer the panel without waiting for a play_* call.
   * Subsequent state changes — including the first queue-mutating call of
   * the session — trigger an automatic bind.
   */
  async init(): Promise<void> {
    if (this.stopped) return;
    this.broadcaster.start();

    this.unsubscribeFromEngine = playbackEngine.onStateChange(() => {
      // Any event from the engine means something is happening — bind so the
      // UI is reachable. After the first successful bind this listener is a
      // no-op (`bind()` is idempotent and short-circuits).
      void this.bind();
    });

    // Probe for an already-running mpv (e.g. one spawned by a prior MCP
    // server still playing). If the queue is non-empty, bind immediately so
    // the panel is reachable the instant the new MCP server is up.
    try {
      await playbackEngine.ensureAttached();
      if (playbackEngine.isRunning()) {
        const queueLength = playbackEngine.getCachedProperty('playlist-count');
        if (typeof queueLength === 'number' && queueLength > 0) {
          await this.bind();
        }
      }
    } catch (err) {
      // Attach is best-effort — the engine's own logging covers the details.
      logger.debug(`webui: initial attach probe non-fatal: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Bind the HTTP listener if not already bound. Concurrent callers share a
   * single in-flight promise (single-flight pattern, mirrors PlaybackEngine).
   * Safe to call repeatedly — second and later calls are no-ops once the
   * server is listening.
   */
  bind(): Promise<void> {
    if (this.httpServer !== null) return Promise.resolve();
    if (this.bindPromise !== null) return this.bindPromise;
    if (this.stopped) return Promise.resolve();

    this.bindPromise = this.doBind().finally(() => {
      this.bindPromise = null;
    });
    return this.bindPromise;
  }

  private async doBind(): Promise<void> {
    const server = createServer({
      config: this.config,
      client: this.client,
      broadcaster: this.broadcaster,
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException): void => {
        // EADDRINUSE is the most likely failure (another web UI instance, or
        // the user picked a port that's already taken). Log a hint with the
        // env var override; the MCP server itself stays up.
        const suffix = err.code === 'EADDRINUSE' ? ' (set WEBUI_PORT to a free port)' : '';
        logger.error(
          `webui: failed to bind on ${this.config.webui.host}:${this.config.webui.port}: ${err.message}${suffix}`,
        );
        reject(err);
      };
      server.once('error', onError);
      server.listen(this.config.webui.port, this.config.webui.host, () => {
        server.removeListener('error', onError);
        resolve();
      });
    });

    this.httpServer = server;
    const banner = this.formatBanner();
    logger.info(`Web UI listening on ${banner}`);
  }

  /**
   * Stop the broadcaster + HTTP server. Safe to call even if `bind()` was
   * never reached — both subroutines are idempotent.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.unsubscribeFromEngine !== null) {
      this.unsubscribeFromEngine();
      this.unsubscribeFromEngine = null;
    }
    this.broadcaster.stop();

    if (this.httpServer !== null) {
      const server = this.httpServer;
      this.httpServer = null;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  /**
   * Render a one-line summary of where the panel is reachable, used in the
   * startup banner. Includes LAN URLs only when the host is bound externally
   * (so a localhost-only setup doesn't print misleading addresses).
   */
  private formatBanner(): string {
    const port = this.config.webui.port;
    const local = `http://${this.config.webui.host === '0.0.0.0' ? '127.0.0.1' : this.config.webui.host}:${port}`;
    if (this.config.webui.host !== '0.0.0.0' && !this.config.webui.expose) {
      return `${local} (localhost only — set WEBUI_EXPOSE=true for LAN access)`;
    }
    const lan = listLanInterfaces(port);
    if (lan.length === 0) return local;
    const lanUrls = lan.map((i) => i.url).join(', ');
    return `${local}; LAN: ${lanUrls}`;
  }
}
