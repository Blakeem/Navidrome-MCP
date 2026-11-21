/**
 * Navidrome MCP Server - Jukebox Remote launch key
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * The player's computer logs in with no password only with this key, so a tunnel or proxy on the host never
 * passes for this computer. Three paths put it in a browser's address. The port owner opens its own tab with it, the setup-mode
 * Save reply gives it to the settings page link, and every other launcher reads the owner-only key file.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getSettingsStorePath } from '../config/store-path.js';
import { writePrivateFileAtomic } from '../config/store.js';
import { errorMessage } from '../utils/error-formatter.js';
import { logger } from '../utils/logger.js';
import { randomToken } from '../utils/secrets.js';

// src/webui/public/page-view.js reads the key under the same name.
const LAUNCH_KEY_PARAM = 'launch';
const LAUNCH_KEY_BYTES = 32;
// base64url of 32 bytes. A key of any other shape, such as a hand-edited file, reads as no key.
const LAUNCH_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function createLaunchKey(): string {
  return randomToken(LAUNCH_KEY_BYTES);
}

/** Beside settings.json and named per port, as the auth store is, so two players on one config directory keep their own keys. */
export function getLaunchKeyPath(port: number): string {
  return join(dirname(getSettingsStorePath()), `jukebox-launch-key-${String(port)}`);
}

/**
 * A failed write stops no start. A launcher then opens the plain address, or an earlier start's key that this
 * player refuses. Either shows the password form, or the no-password refusal while no password is saved.
 */
export function writeLaunchKey(port: number, key: string): void {
  const path = getLaunchKeyPath(port);
  try {
    writePrivateFileAtomic(path, key);
  } catch (err) {
    logger.warn(`webui: could not write the launch key file ${path} (${errorMessage(err)}), so a later launcher on this computer cannot skip the admin login`);
  }
}

/** Null when the file is missing, unreadable or malformed. A file left by an earlier start holds a key the running player refuses. */
export function readLaunchKey(port: number): string | null {
  const path = getLaunchKeyPath(port);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') logger.warn(`webui: the launch key file ${path} is unreadable (${code ?? errorMessage(err)})`);
    return null;
  }
  return LAUNCH_KEY_PATTERN.test(text) ? text : null;
}

/**
 * A query, not a fragment, so every OS launcher passes it unchanged. A launcher opens only a loopback
 * address, so the key never crosses a network. A null key leaves the plain address.
 */
export function withLaunchKey(adminUrl: string, key: string | null): string {
  if (key === null) return adminUrl;
  const url = new URL(adminUrl);
  url.searchParams.set(LAUNCH_KEY_PARAM, key);
  return url.href;
}
