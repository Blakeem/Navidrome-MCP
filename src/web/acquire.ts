/**
 * Navidrome MCP Server - Port-as-lock acquire/attach
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Server } from 'node:http';
import type { Config } from '../config.js';
import { loopbackUrl } from '../webui/network.js';
import { HEALTH_APP_ID } from '../webui/routes/health.js';
import { isTlsEnabled } from '../webui/tls.js';
import { loopbackRequest } from './loopback-client.js';

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

export type WebEndpoint = Pick<Config['webui'], 'port' | 'host' | 'tls'>;

/** `lan` is whether the owner's bind accepts LAN connections. An owner older than the field leaves it out. */
interface HealthAnswer {
  outcome: ProbeOutcome;
  lan?: boolean;
}

/** `secure` is the scheme the owner answered on, or the preferred one when no owner answered. */
interface OwnerAnswer extends HealthAnswer {
  secure: boolean;
}

/** `port` and `secure` are the endpoint whose answer decided the outcome. */
export interface WebOwnerProbe extends OwnerAnswer {
  port: number;
}

export interface AcquireDeps {
  probe: (port: number, bindHost: string, preferSecure: boolean) => Promise<OwnerAnswer>;
  bind: (server: Server, port: number, host: string) => Promise<'ok' | 'eaddrinuse'>;
}

const PROBE_TIMEOUT_MS = 500;
const MAX_PROBE_BODY_BYTES = 4096;
const WILDCARD_HOSTS: ReadonlySet<string> = new Set(['0.0.0.0', '::']);

/** A wildcard bind accepts loopback, and a specific host accepts only its own address. */
function probeHost(bindHost: string): string {
  return WILDCARD_HOSTS.has(bindHost) ? '127.0.0.1' : bindHost;
}

export function probeHealthz(port: number, bindHost: string, secure: boolean): Promise<HealthAnswer> {
  return new Promise<HealthAnswer>((resolve) => {
    let settled = false;
    const done = (outcome: ProbeOutcome, lan?: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(lan === undefined ? { outcome } : { outcome, lan });
    };

    const req = loopbackRequest(
      secure,
      { host: probeHost(bindHost), port, path: '/healthz', method: 'GET', timeout: PROBE_TIMEOUT_MS },
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
            const json = JSON.parse(body) as { app?: unknown; lan?: unknown };
            if (json.app !== HEALTH_APP_ID) done('foreign');
            else done('ours', typeof json.lan === 'boolean' ? json.lan : undefined);
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
    req.end();
  });
}

/**
 * A running player fixed its scheme at its own start, and settings.json may have gained or lost the
 * TLS pair since, so a foreign answer on the preferred scheme is retried on the other one.
 */
export async function probeOwner(port: number, bindHost: string, preferSecure: boolean): Promise<OwnerAnswer> {
  const preferred = await probeHealthz(port, bindHost, preferSecure);
  if (preferred.outcome !== 'foreign') return { ...preferred, secure: preferSecure };
  const other = await probeHealthz(port, bindHost, !preferSecure);
  if (other.outcome === 'ours') return { ...other, secure: !preferSecure };
  return { ...preferred, secure: preferSecure };
}

/**
 * The MCP keeps its startup endpoint, but a spawned or re-run web player binds the endpoint that
 * settings.json holds now, so the saved endpoint is probed second.
 */
export async function probeWebOwner(
  startup: WebEndpoint,
  readSaved: () => WebEndpoint | null,
): Promise<WebOwnerProbe> {
  const first = await probeOwner(startup.port, startup.host, isTlsEnabled(startup.tls));
  const firstResult: WebOwnerProbe = { ...first, port: startup.port };
  if (first.outcome === 'ours') return firstResult;

  const saved = readSaved();
  if (saved === null) return firstResult;
  // One port probe already covered both schemes.
  const sameEndpoint = saved.port === startup.port && probeHost(saved.host) === probeHost(startup.host);
  if (sameEndpoint) return firstResult;

  const second = await probeOwner(saved.port, saved.host, isTlsEnabled(saved.tls));
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

const DEFAULT_DEPS: AcquireDeps = { probe: probeOwner, bind: realBind };

export function portConflictMessage(port: number): string {
  return `Web UI port ${port} is in use by another application. Change webui.port in settings, or stop the conflicting process.`;
}

/** `makeServer` runs only when a bind is attempted, so an attaching process builds no server. */
export async function acquireOrAttach(
  config: Config,
  makeServer: () => Server,
  deps: AcquireDeps = DEFAULT_DEPS,
): Promise<AcquireResult> {
  const { port, host } = config.webui;
  const secure = isTlsEnabled(config.webui.tls);
  const url = loopbackUrl(port, secure);

  const first = await deps.probe(port, host, secure);
  if (first.outcome === 'ours') return { mode: 'attached', url: loopbackUrl(port, first.secure) };
  if (first.outcome === 'foreign') throw new Error(portConflictMessage(port));

  const server = makeServer();
  const bound = await deps.bind(server, port, host);
  if (bound === 'ok') return { mode: 'owner', url, server };

  // EADDRINUSE after a refused probe means another process bound first. It is either a
  // Jukebox Remote that won a cold-start race or a foreign process.
  const second = await deps.probe(port, host, secure);
  if (second.outcome === 'ours') return { mode: 'attached', url: loopbackUrl(port, second.secure) };
  throw new Error(portConflictMessage(port));
}
