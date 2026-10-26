/**
 * Navidrome MCP Server - Web remote session and device cookies
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// The route table and the device cookie share this path, so only the join route receives the cookie.
export const JOIN_ROUTE_PATH = '/api/auth/join';
// Chrome caps a cookie's lifetime at 400 days.
const DEVICE_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

/**
 * Browsers share cookies across every port of a host name, so the name carries the port to keep two
 * players apart. The `__Host-` prefix makes the browser refuse the cookie unless it is Secure,
 * host-only and on `/`, which only an HTTPS listener can set.
 */
export function sessionCookieName(port: number, secure: boolean): string {
  const name = `ndmcp-web-${String(port)}`;
  return secure ? `__Host-${name}` : name;
}

/** The port rule of `sessionCookieName`, with no `__Host-` prefix, since that prefix requires `Path=/`. */
export function deviceCookieName(port: number): string {
  return `ndmcp-device-${String(port)}`;
}

/** Every value is returned, since a stale cookie of the same name may come first. */
export function readCookieValues(header: string | undefined, name: string): string[] {
  if (header === undefined) return [];
  const values: string[] = [];
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() !== name) continue;
    const value = pair.slice(separator + 1).trim();
    if (value !== '') values.push(value);
  }
  return values;
}

export function serializeSessionCookie(name: string, token: string, maxAgeSeconds: number, secure: boolean): string {
  return serializeCookie(name, token, '/', maxAgeSeconds, secure);
}

export function serializeDeviceCookie(name: string, deviceId: string, secure: boolean): string {
  return serializeCookie(name, deviceId, JOIN_ROUTE_PATH, DEVICE_COOKIE_MAX_AGE_SECONDS, secure);
}

function serializeCookie(name: string, value: string, path: string, maxAgeSeconds: number, secure: boolean): string {
  const attributes = [`${name}=${value}`, 'HttpOnly', 'SameSite=Strict', `Path=${path}`, `Max-Age=${String(maxAgeSeconds)}`];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}
