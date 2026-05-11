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

/**
 * Per-session, per-station dedup for Radio Browser vote/click endpoints.
 *
 * Why: Radio Browser deduplicates votes server-side per IP per day, and
 * popularity-counter clicks are similarly rate-limited. An LLM in a loop
 * (e.g., "vote for every station you find") would generate hundreds of
 * rejected requests and risk getting our shared User-Agent banned by the
 * upstream — the user explicitly asked for "once per session" enforcement.
 *
 * Scope: per process lifetime. Sets are cleared only on restart, which is
 * the simplest correct interpretation of "session". No TTL, no global
 * rate cap — just "you already did this for this UUID, here's a friendly
 * no-op response".
 *
 * Vote and click are tracked separately so a user can do one of each per
 * station per session. They're independent endpoints with different
 * server-side semantics (vote is a one-shot per-IP-per-day vote tally;
 * click is a popularity counter), so coupling them adds no value.
 */

const votedUuids = new Set<string>();
const clickedUuids = new Set<string>();

export function hasRecentlyVoted(uuid: string): boolean {
  return votedUuids.has(uuid);
}

export function markVoted(uuid: string): void {
  votedUuids.add(uuid);
}

export function hasRecentlyClicked(uuid: string): boolean {
  return clickedUuids.has(uuid);
}

export function markClicked(uuid: string): void {
  clickedUuids.add(uuid);
}

/**
 * Test-only reset. Production code never calls this — sets persist for the
 * full process lifetime, mirroring the "once per session" guarantee.
 */
export function resetRadioBrowserRateLimit(): void {
  votedUuids.clear();
  clickedUuids.clear();
}
