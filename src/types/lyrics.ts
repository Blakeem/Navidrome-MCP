/**
 * Navidrome MCP Server - Lyrics Data Transfer Objects
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export interface LyricsLine {
  timeMs: number;
  /** When this line stops being the current line. */
  endMs: number;
  text: string;
}

export interface LyricsDTO {
  track: {
    title: string;
    artist: string;
    album?: string;
    durationMs?: number;
  };
  synced?: LyricsLine[];
  unsynced?: string;
  hasSynced: boolean;
  isInstrumental: boolean;
  /** `local` is the audio file's own lyrics tag. */
  provider: 'local' | 'lrclib';
  attribution: {
    url: string;
    license?: string;
  };
}
/**
 * One LRCLIB search hit. It omits the lyric text, since get_lyrics fetches the chosen record by
 * its lrclibId.
 */
export interface LyricsCandidateDTO {
  lrclibId: string;
  trackName: string;
  artistName: string;
  albumName?: string;
  durationMs?: number;
  hasSynced: boolean;
  isInstrumental: boolean;
}

export interface LyricsSearchDTO {
  /** Best match first. */
  candidates: LyricsCandidateDTO[];
  librarySong?: {
    songId: string;
    /** Lyrics in that song's own audio file tag, not LRCLIB. */
    lyrics?: 'synced' | 'unsynced';
  };
}
