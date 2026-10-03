/**
 * Navidrome MCP Server - Radio Browser Per-Session Rate Limit
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

// Per-process dedup for Radio Browser vote and click. Upstream accepts one vote per IP per station every 10 minutes
// and counts one click per day, and an LLM looping over stations would pile up repeats that risk a ban on the shared User-Agent.

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

/** Production entries expire after their upstream window, 10 minutes for a vote and a day for a click. */
export function resetRadioBrowserRateLimitForTests(): void {
  voteMarkedAt.clear();
  clicks.clear();
}
