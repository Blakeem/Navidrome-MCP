/**
 * Navidrome MCP Server - Lyrics Data Transfer Objects
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
 * Synced lyrics line with timestamp
 */
export interface LyricsLine {
  /** Time in milliseconds */
  timeMs: number;
  /** Lyrics text for this line */
  text: string;
}

/**
 * Lyrics response DTO
 */
export interface LyricsDTO {
  /** Track information */
  track: {
    /** Track title */
    title: string;
    /** Artist name */
    artist: string;
    /** Album name */
    album?: string;
    /** Duration in milliseconds */
    durationMs?: number;
  };
  /** Synced lyrics (LRC format) */
  synced?: LyricsLine[];
  /** Plain unsynced lyrics */
  unsynced?: string;
  /** Whether track is instrumental */
  isInstrumental: boolean;
  /** Lyrics provider */
  provider: 'lrclib';
  /** Attribution information */
  attribution: {
    /** Provider URL */
    url: string;
    /** License information */
    license?: string;
  };
}