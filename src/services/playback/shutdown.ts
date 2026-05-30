/**
 * Navidrome MCP Server - mpv shutdown decision
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
 * Decide whether the web port owner should kill mpv on its own graceful
 * shutdown (standalone-web spec §8.1).
 *
 * Playing → keep mpv (it is detached and survives a web restart, so music
 * keeps going). Stopped/idle → kill it to reclaim the audio device.
 *
 * This is the single mpv-shutdown authority: **only the web port owner** ever
 * calls it, and **MCP exit never kills mpv** (preserving the deliberate
 * "survives parent" design). Pair the input with `playbackEngine.isPlaying()`.
 *
 * NOTE: not yet wired. The consumer is the standalone web server's
 * `onOwnerExit()` shutdown path (spec §8.5), which lands in a later phase
 * alongside the idle reaper. The export is intentional, not orphaned — its
 * unit test keeps it off the dead-code gate until then.
 */
export function shouldKillMpvOnOwnerShutdown(isPlaying: boolean): boolean {
  return !isPlaying;
}
