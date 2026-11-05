/**
 * Navidrome MCP Server - Radio Browser Per-Session Rate Limit
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Per IP and station, Radio Browser counts one vote per 10 minutes and one click per day. An LLM
// looping over stations would pile up repeats that risk a ban on the shared User-Agent.

const VOTE_WINDOW_MS = 10 * 60 * 1000;
const CLICK_WINDOW_MS = 24 * 60 * 60 * 1000;

const voteMarkedAt = new Map<string, number>();
// The stream URL is kept so a deduped click still hands the caller a playable URL.
const clicks = new Map<string, { streamUrl: string; markedAt: number }>();

export function hasRecentlyVoted(uuid: string): boolean {
  const markedAt = voteMarkedAt.get(uuid);
  if (markedAt === undefined) return false;
  if (Date.now() - markedAt < VOTE_WINDOW_MS) return true;
  voteMarkedAt.delete(uuid);
  return false;
}

export function markVoted(uuid: string): void {
  voteMarkedAt.set(uuid, Date.now());
}

export function getClickedStreamUrl(uuid: string): string | undefined {
  const click = clicks.get(uuid);
  if (click === undefined) return undefined;
  if (Date.now() - click.markedAt < CLICK_WINDOW_MS) return click.streamUrl;
  clicks.delete(uuid);
  return undefined;
}

export function markClicked(uuid: string, streamUrl: string): void {
  clicks.set(uuid, { streamUrl, markedAt: Date.now() });
}

export function resetRadioBrowserRateLimitForTests(): void {
  voteMarkedAt.clear();
  clicks.clear();
}
