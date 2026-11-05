/**
 * Navidrome MCP Server - Web remote page paths
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export const ADMIN_PAGE_PATH = '/admin';
export const GUEST_PAGE_PATH = '/guest';

/** Links handed to the admin name this page, since the root sends a jukebox visitor without an admin session to the guest page. */
export function adminPageUrl(origin: string): string {
  return `${origin}${ADMIN_PAGE_PATH}`;
}
