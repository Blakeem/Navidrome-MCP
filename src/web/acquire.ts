/**
 * Navidrome MCP Server - Port-as-lock acquire/attach
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

import { get as httpGet, type Server } from 'node:http';
import type { Config } from '../config.js';
import { HEALTH_APP_ID } from '../webui/routes/health.js';

/**
 * Port-as-lock decision. The configured TCP port is the lock: whoever binds it
 * first owns the web server. Everyone else probes `/healthz`, confirms it's our
 * server, and stands down (attaches).
 */
export type AcquireResult =
  /** We bound the port. `server` is the live HTTP server we now own. */
  | { mode: 'owner'; url: string; server: Server }
  /** A navidrome-web already owns the port. We stand down and connect to `url`. */
  | { mode: 'attached'; url: string };

/**
 * Outcome of probing `/healthz`:
 * - `ours`: 200 with the matching app signature, so a navidrome-web is already up.
 * - `refused`: connection refused, so nobody is listening and we may bind.
 * - `foreign`: a port conflict. A 200 with a different signature, a non-200, a timeout, or any
 *   connection error other than ECONNREFUSED. A hung listener must not block startup.
 */
export type ProbeOutcome = 'ours' | 'refused' | 'foreign';

/** The webui bind address, the key of the port-as-lock. */
export type WebEndpoint = Pick<Config['webui'], 'port' | 'host'>;

/** An owner probe across the startup and saved endpoints. `port` is the endpoint whose answer decided it. */
export interface WebOwnerProbe {
  outcome: ProbeOutcome;
  playbackAttached: boolean;
  port: number;
}

export interface AcquireDeps {
  probe: (port: number, bindHost: string) => Promise<ProbeOutcome>;
  bind: (server: Server, port: number, host: string) => Promise<'ok' | 'eaddrinuse'>;
}

/** A probe outcome plus whether the owner's playback engine is attached to mpv. */
interface HealthzProbe {
  outcome: ProbeOutcome;
  playbackAttached: boolean;
}

const PROBE_TIMEOUT_MS = 500;
const MAX_PROBE_BODY_BYTES = 4096;
const WILDCARD_HOSTS: ReadonlySet<string> = new Set(['0.0.0.0', '::']);

/** A wildcard bind accepts loopback connections, and a specific host accepts only its own address. */
function probeHost(bindHost: string): string {
  return WILDCARD_HOSTS.has(bindHost) ? '127.0.0.1' : bindHost;
}

function probeHealthzDetail(port: number, bindHost: string): Promise<HealthzProbe> {
  return new Promise<HealthzProbe>((resolve) => {
    let settled = false;
    const done = (outcome: ProbeOutcome, playbackAttached = false): void => {
      if (settled) return;
      settled = true;
      resolve({ outcome, playbackAttached });
    };

    const req = httpGet(
      { host: probeHost(bindHost), port, path: '/healthz', timeout: PROBE_TIMEOUT_MS },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          done('foreign');
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
          if (body.length > MAX_PROBE_BODY_BYTES) {
            // destroy() with no argument emits no 'error', so the oversized-body probe must settle here.
            req.destroy();
            done('foreign');
          }
        });
        res.on('end', () => {
          try {
            const json = JSON.parse(body) as { app?: unknown; playbackAttached?: unknown };
            if (json.app !== HEALTH_APP_ID) {
              done('foreign');
              return;
            }
            // An owner older than the playbackAttached field always scrobbled, so a missing field counts as attached.
            done('ours', json.playbackAttached !== false);
          } catch {
            done('foreign');
          }
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      done('foreign');
    });
    req.on('error', (err: NodeJS.ErrnoException) => {
      done(err.code === 'ECONNREFUSED' ? 'refused' : 'foreign');
    });
  });
}

/** Probe `/healthz` at the bind host. A wildcard bind host ('0.0.0.0' or '::') is probed at 127.0.0.1. */
export async function probeHealthz(port: number, bindHost: string): Promise<ProbeOutcome> {
  return (await probeHealthzDetail(port, bindHost)).outcome;
}

/**
 * The MCP keeps its startup endpoint, but a spawned or re-run web player binds the endpoint settings.json holds
 * now, so that one is probed second. Either answering as ours is the owner. Refused means both refused.
 */
export async function probeWebOwner(
  startup: WebEndpoint,
  readSaved: () => WebEndpoint | null,
): Promise<WebOwnerProbe> {
  const first = await probeHealthzDetail(startup.port, startup.host);
  const firstResult: WebOwnerProbe = { ...first, port: startup.port };
  if (first.outcome === 'ours') return firstResult;

  const saved = readSaved();
  if (saved === null) return firstResult;
  if (saved.port === startup.port && probeHost(saved.host) === probeHost(startup.host)) return firstResult;

  const second = await probeHealthzDetail(saved.port, saved.host);
  const secondResult: WebOwnerProbe = { ...second, port: saved.port };
  if (second.outcome === 'ours') return secondResult;
  // A foreign startup answer keeps its warn-skip, and a foreign saved endpoint dooms a spawned player.
  return first.outcome === 'foreign' ? firstResult : secondResult;
}

/**
 * A real navidrome-web currently owns the web port. The MCP teardown path keys
 * off it, since the owner quits mpv itself whether or not it is attached.
 */
export async function webOwnerPresent(
  startup: WebEndpoint,
  readSaved: () => WebEndpoint | null,
): Promise<boolean> {
  return (await probeWebOwner(startup, readSaved)).outcome === 'ours';
}

/**
 * A navidrome-web owns the web port and its engine is attached to mpv. Only an
 * attached owner sees track changes, so the MCP tracker submits unless this holds.
 */
export async function webOwnerScrobbling(
  startup: WebEndpoint,
  readSaved: () => WebEndpoint | null,
): Promise<boolean> {
  const probe = await probeWebOwner(startup, readSaved);
  return probe.outcome === 'ours' && probe.playbackAttached;
}

/** Bind an unstarted HTTP server, resolving `eaddrinuse` instead of throwing on
 * a lost race so the caller can re-probe (the race loser self-attaches). */
function realBind(server: Server, port: number, host: string): Promise<'ok' | 'eaddrinuse'> {
  return new Promise<'ok' | 'eaddrinuse'>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException): void => {
      server.removeListener('listening', onListening);
      if (err.code === 'EADDRINUSE') {
        resolve('eaddrinuse');
        return;
      }
      reject(err);
    };
    const onListening = (): void => {
      server.removeListener('error', onError);
      resolve('ok');
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

const DEFAULT_DEPS: AcquireDeps = { probe: probeHealthz, bind: realBind };

/** A wildcard bind still serves loopback, so the player URL never needs the LAN IP. */
export function loopbackUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

function conflictError(port: number): Error {
  return new Error(
    `Web UI port ${port} is in use by another application. ` +
      `Change webui.port in settings, or stop the conflicting process.`,
  );
}

/**
 * Acquire the web port or attach to an already-running navidrome-web.
 *
 * `makeServer` is only invoked when we actually attempt to bind, so attaching
 * to an existing server never constructs a throwaway one. Deps are injectable
 * for unit testing. Production uses the real loopback probe and bind.
 */
export async function acquireOrAttach(
  config: Config,
  makeServer: () => Server,
  deps: AcquireDeps = DEFAULT_DEPS,
): Promise<AcquireResult> {
  const { port, host } = config.webui;
  const url = loopbackUrl(port);

  const first = await deps.probe(port, host);
  if (first === 'ours') return { mode: 'attached', url };
  if (first === 'foreign') throw conflictError(port);

  // Refused means nobody is listening, so try to become the owner.
  const server = makeServer();
  const bound = await deps.bind(server, port, host);
  if (bound === 'ok') return { mode: 'owner', url, server };

  // EADDRINUSE means a lost cold-start race. Re-probe once and attach if it's ours.
  // Otherwise a foreign process grabbed the port between our probe and bind.
  const second = await deps.probe(port, host);
  if (second === 'ours') return { mode: 'attached', url };
  throw conflictError(port);
}
