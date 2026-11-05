/**
 * Navidrome MCP Server - e2e temp settings store
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * The store copies only the Navidrome login and the mpv path from the user's store, so no test
 * reaches Last.fm or LRCLIB and no saved audio device or player setting carries over.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { readSettings, readStoreProblem } from '../../../src/config/store.js';
import { getSettingsStorePath } from '../../../src/config/store-path.js';
import { resolveMpvBinary } from '../../../src/services/playback/mpv-process.js';

interface TempStoreInput {
  runDir: string;
  port: number;
  adminPasswordHash: string;
}

/** Throws with the missing prerequisite named, so the run stops before any test. */
export function writeTempStore({ runDir, port, adminPasswordHash }: TempStoreInput): string {
  const userStorePath = getSettingsStorePath();
  const userStore = readSettings();
  const storeProblem = userStore === null ? readStoreProblem() : null;
  if (storeProblem !== null) {
    throw new Error(`e2e: the settings store is unusable: ${storeProblem.text}. Fix it with navidrome-config first.`);
  }
  const navidrome = userStore?.navidrome;
  const url = navidrome?.url ?? '';
  const username = navidrome?.username ?? '';
  const password = navidrome?.password ?? '';
  if (url === '' || username === '' || password === '') {
    throw new Error(`e2e: no Navidrome url, username and password in the settings store at ${userStorePath}. Save them with navidrome-config first.`);
  }
  const mpvPath = userStore?.playback?.mpvPath ?? null;
  if (resolveMpvBinary(mpvPath) === null) {
    throw new Error(`e2e: no mpv binary found. Put mpv on PATH or set playback.mpvPath in ${userStorePath}.`);
  }

  const store = {
    navidrome: { url, username, password },
    playback: { mpvPath },
    webui: {
      enabled: true,
      port,
      // POST /api/jukebox/key answers 409 on a loopback bind, so the instance is LAN reachable during the run.
      expose: true,
      autoOpenBrowser: false,
      auth: { mode: 'jukebox', adminPasswordHash, adminAccess: 'localhost' },
    },
  };
  const storePath = join(runDir, 'settings.json');
  writeFileSync(storePath, JSON.stringify(store, null, 2), { mode: 0o600 });
  return storePath;
}
