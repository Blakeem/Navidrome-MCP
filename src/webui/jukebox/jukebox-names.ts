/**
 * Navidrome MCP Server - Jukebox names
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/** The name of the admin's guest page songs with no host nickname, and of every song the admin page adds in mode `jukebox`. */
export const HOST_JUKEBOX_LABEL = 'Host';

/** The Added by names queued and held songs show, by whether the host or a guest added them. */
export interface QueuedNames {
  host: readonly string[];
  guest: readonly string[];
}
