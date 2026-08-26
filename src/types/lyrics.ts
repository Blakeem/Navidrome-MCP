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
  /** Time in milliseconds at which this line stops being the current line */
  endMs: number;
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
  /** Whether the result carries timed lines */
  hasSynced: boolean;
  /** Whether track is instrumental */
  isInstrumental: boolean;
  /** Source that answered: the audio file's own tags, or LRCLIB */
  provider: 'local' | 'lrclib';
  /** Attribution information */
  attribution: {
    /** Provider URL */
    url: string;
    /** License information */
    license?: string;
  };
}
/**
 * One LRCLIB search hit. The lyric text is left out on purpose: candidates are
 * a menu, and get_lyrics fetches the chosen record by its lrclibId.
 */
export interface LyricsCandidateDTO {
  /** LRCLIB record ID, passed back to get_lyrics */
  lrclibId: string;
  /** Track title as LRCLIB holds it */
  trackName: string;
  /** Artist name as LRCLIB holds it */
  artistName: string;
  /** Album name as LRCLIB holds it, when present */
  albumName?: string;
  /** Duration in milliseconds, when LRCLIB reports one */
  durationMs?: number;
  /** Whether the record carries timed lines */
  hasSynced: boolean;
}

/**
 * Lyrics search response DTO
 */
export interface LyricsSearchDTO {
  /** LRCLIB records matching the metadata, best match first */
  candidates: LyricsCandidateDTO[];
  /** The library song matching the metadata, when one exists */
  librarySong?: {
    /** Navidrome song ID, passed back to get_lyrics */
    songId: string;
    /** Lyrics carried by that song's own audio file, if any */
    lyrics?: 'synced' | 'plain';
  };
}
