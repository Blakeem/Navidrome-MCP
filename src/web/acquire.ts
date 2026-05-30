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
 * Port-as-lock decision (standalone-web spec §5). The configured TCP port is
 * the lock: whoever binds it first owns the web server; everyone else probes
 * `/healthz`, confirms it's our server, and stands down (attaches).
 */
export type AcquireResult =
  /** We bound the port; `server` is the live HTTP server we now own. */
  | { mode: 'owner'; url: string; server: Server }
  /** A navidrome-web already owns the port; we stand down and connect to `url`. */
  | { mode: 'attached'; url: string };

/**
 * Outcome of probing `/healthz`:
 * - `ours`    — 200 + matching app signature ⇒ a navidrome-web is already up.
 * - `refused` — connection refused ⇒ nobody is listening; we may bind.
 * - `foreign` — 200 with a different signature, a non-200, or a timeout/hang
 *               (per §5.2 we must NOT block forever) ⇒ port conflict.
 */
export type ProbeOutcome = 'ours' | 'refused' | 'foreign';

export interface AcquireDeps {
  probe: (port: number) => Promise<ProbeOutcome>;
  bind: (server: Server, port: number, host: string) => Promise<'ok' | 'eaddrinuse'>;
}

const PROBE_TIMEOUT_MS = 500;
const MAX_PROBE_BODY_BYTES = 4096;

/** Probe loopback `/healthz` — ALWAYS 127.0.0.1, even when the bind host is
 * 0.0.0.0 (binding 0.0.0.0 accepts loopback connections, spec §5.2.1).
 * Exported so the MCP spawner can fast-path "already running → don't spawn." */
export function probeHealthz(port: number): Promise<ProbeOutcome> {
  return new Promise<ProbeOutcome>((resolve) => {
    let settled = false;
    const done = (outcome: ProbeOutcome): void => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    const req = httpGet(
      { host: '127.0.0.1', port, path: '/healthz', timeout: PROBE_TIMEOUT_MS },
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
            // Oversized /healthz from a squatter — abort and settle now rather
            // than waiting out the timeout (`req.destroy()` with no arg emits no
            // 'error', so we must resolve here explicitly).
            req.destroy();
            done('foreign');
          }
        });
        res.on('end', () => {
          try {
            const json = JSON.parse(body) as { app?: unknown };
            done(json.app === HEALTH_APP_ID ? 'ours' : 'foreign');
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

function conflictError(port: number): Error {
  return new Error(
    `Web UI port ${port} is in use by another application. ` +
      `Change webui.port in settings, or stop the conflicting process.`,
  );
}

/**
 * Acquire the web port or attach to an already-running navidrome-web (§5.2).
 *
 * `makeServer` is only invoked when we actually attempt to bind, so attaching
 * to an existing server never constructs a throwaway one. Deps are injectable
 * purely for unit testing — production uses the real loopback probe + bind.
 */
export async function acquireOrAttach(
  config: Config,
  makeServer: () => Server,
  deps: AcquireDeps = DEFAULT_DEPS,
): Promise<AcquireResult> {
  const { port, host } = config.webui;
  const url = `http://127.0.0.1:${port}`;

  const first = await deps.probe(port);
  if (first === 'ours') return { mode: 'attached', url };
  if (first === 'foreign') throw conflictError(port);

  // refused → nobody listening; try to become the owner.
  const server = makeServer();
  const bound = await deps.bind(server, port, host);
  if (bound === 'ok') return { mode: 'owner', url, server };

  // EADDRINUSE — lost a cold-start race. Re-probe once: if it's ours, attach;
  // otherwise a foreign process grabbed the port between our probe and bind.
  const second = await deps.probe(port);
  if (second === 'ours') return { mode: 'attached', url };
  throw conflictError(port);
}
