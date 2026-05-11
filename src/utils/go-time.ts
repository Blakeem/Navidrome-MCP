/**
 * Navidrome MCP Server - Go zero-time helpers
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
 * Go's `time.Time` zero value, serialised as RFC 3339. Navidrome returns this
 * for fields the server has never populated (e.g. `updatedAt` on a queue that
 * was never saved, `createdAt` on a library when the user endpoint zeroes it
 * out). It is NEVER a real timestamp consumers should see — surfacing
 * "January 1, year 1" to an LLM is misleading at best.
 */
const GO_ZERO_TIME = '0001-01-01T00:00:00Z';

/**
 * Map Go's zero-time sentinel to `null`. Pass-through for any other string,
 * including the empty string (callers that want empty-as-null should layer
 * that on top — empty strings are sometimes meaningful, e.g. "not asked").
 */
export function nullIfGoZeroTime(ts: string | null | undefined): string | null {
  if (ts === null || ts === undefined) return null;
  return ts === GO_ZERO_TIME ? null : ts;
}
