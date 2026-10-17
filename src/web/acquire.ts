/**
 * Navidrome MCP Server - Port-as-lock acquire/attach
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { get as httpGet, type Server } from 'node:http';
import type { Config } from '../config.js';
import { HEALTH_APP_ID } from '../webui/routes/health.js';

/**
 * The configured TCP port is the lock. The process that binds it owns the web server, and every
 * later process confirms the owner through `/healthz` and attaches.
 */
export type AcquireResult =
  | { mode: 'owner'; url: string; server: Server }
  | { mode: 'attached'; url: string };

/**
 * `foreign` covers every answer other than our signature or ECONNREFUSED, so a hung listener
 * counts as a port conflict and never blocks startup.
 */
export type ProbeOutcome = 'ours' | 'refused' | 'foreign';

export type WebEndpoint = Pick<Config['webui'], 'port' | 'host'>;

/** `port` is the endpoint whose answer decided the outcome. */
export interface WebOwnerProbe {
  outcome: ProbeOutcome;
  playbackAttached: boolean;
  scrobbleClaims: boolean;
  port: number;
}

export interface AcquireDeps {
  probe: (port: number, bindHost: string) => Promise<ProbeOutcome>;
  bind: (server: Server, port: number, host: string) => Promise<'ok' | 'eaddrinuse'>;
}

interface HealthzProbe {
  outcome: ProbeOutcome;
  playbackAttached: boolean;
  scrobbleClaims: boolean;
}

const PROBE_TIMEOUT_MS = 500;
const MAX_PROBE_BODY_BYTES = 4096;
const WILDCARD_HOSTS: ReadonlySet<string> = new Set(['0.0.0.0', '::']);

/** A wildcard bind accepts loopback, and a specific host accepts only its own address. */
function probeHost(bindHost: string): string {
  return WILDCARD_HOSTS.has(bindHost) ? '127.0.0.1' : bindHost;
}

function probeHealthzDetail(port: number, bindHost: string): Promise<HealthzProbe> {
  return new Promise<HealthzProbe>((resolve) => {
    let settled = false;
    const done = (outcome: ProbeOutcome, playbackAttached = false, scrobbleClaims = false): void => {
      if (settled) return;
      settled = true;
      resolve({ outcome, playbackAttached, scrobbleClaims });
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
            // destroy() with no argument emits no 'error', so the oversized probe settles here.
            req.destroy();
            done('foreign');
          }
        });
        res.on('end', () => {
          try {
            const json = JSON.parse(body) as { app?: unknown; playbackAttached?: unknown; scrobbleClaims?: unknown };
            if (json.app !== HEALTH_APP_ID) {
              done('foreign');
              return;
            }
            // An owner older than the playbackAttached field always scrobbled, so a missing field
            // counts as attached.
            done('ours', json.playbackAttached !== false, json.scrobbleClaims === true);
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

export async function probeHealthz(port: number, bindHost: string): Promise<ProbeOutcome> {
  return (await probeHealthzDetail(port, bindHost)).outcome;
}

/**
 * The MCP keeps its startup endpoint, but a spawned or re-run web player binds the endpoint that
 * settings.json holds now, so the saved endpoint is probed second.
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
  // A foreign startup answer keeps the caller's warn-and-skip. A foreign saved endpoint would fail
  // a spawned player's bind.
  return first.outcome === 'foreign' ? firstResult : secondResult;
}

/** The MCP teardown path keys off this, since the owner quits mpv whether or not it is attached. */
export async function webOwnerPresent(
  startup: WebEndpoint,
  readSaved: () => WebEndpoint | null,
): Promise<boolean> {
  return (await probeWebOwner(startup, readSaved)).outcome === 'ours';
}

/**
 * An owner older than the scrobble claim channel submits every play without claiming, so the MCP
 * tracker defers to it while it is attached to mpv. Compatibility to remove after one release.
 */
export function legacyOwnerScrobbles(probe: WebOwnerProbe): boolean {
  return probe.outcome === 'ours' && !probe.scrobbleClaims && probe.playbackAttached;
}

/** EADDRINUSE resolves instead of rejecting, so a cold-start race loser can re-probe and attach. */
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

/** `makeServer` runs only when a bind is attempted, so an attaching process builds no server. */
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

  const server = makeServer();
  const bound = await deps.bind(server, port, host);
  if (bound === 'ok') return { mode: 'owner', url, server };

  // EADDRINUSE after a refused probe means another process bound first. It is either a
  // navidrome-web that won a cold-start race or a foreign process.
  const second = await deps.probe(port, host);
  if (second === 'ours') return { mode: 'attached', url };
  throw conflictError(port);
}
