/**
 * Navidrome MCP Server - Last.fm Music Discovery Tools
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

import type { Config } from '../config.js';
import { logger } from '../utils/logger.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { safeNumber } from '../utils/safe-number.js';
import {
  fetchWithTimeout,
  getExternalApiTimeoutMs,
} from '../utils/fetch-with-timeout.js';
import {
  SimilarArtistsSchema,
  SimilarTracksSchema,
  ArtistInfoSchema,
  TopTracksByArtistSchema,
  TrendingMusicSchema,
} from '../schemas/index.js';

interface LastFmArtist {
  name: string;
  match: number;
  url: string;
  mbid: string | null;
}

// Input echoes (artist, originalTrack, type/page/perPage) are intentionally
// dropped from these Last.fm response shapes — the LLM just sent them. Only
// server-derived fields (count, items, biography, mbid, etc.) survive. The
// originals are captured in the DEBUG log line at the top of each function.
interface SimilarArtistsResult {
  count: number;
  similarArtists: LastFmArtist[];
}

interface LastFmTrack {
  name: string;
  artist: string;
  match: number;
  url: string;
  mbid: string | null;
}

interface SimilarTracksResult {
  count: number;
  similarTracks: LastFmTrack[];
}

interface LastFmTag {
  name: string;
  url: string;
}

interface ArtistInfoResult {
  name: string;
  mbid: string | null;
  url: string;
  listeners: number;
  playcount: number;
  biography: string | null;
  tags: LastFmTag[];
  similar: string[];
}

interface TopTrackResult {
  rank: number;
  name: string;
  playcount: number;
  listeners: number;
  url: string;
  mbid: string | null;
}

interface TopTracksByArtistResult {
  count: number;
  tracks: TopTrackResult[];
}

interface TrendingArtistItem {
  rank: number;
  name: string;
  playcount: number;
  listeners: number;
  url: string;
  mbid: string | null;
}

interface TrendingTrackItem {
  rank: number;
  name: string;
  artist: string;
  playcount: number;
  listeners: number;
  url: string;
  mbid: string | null;
}

interface TrendingTagItem {
  rank: number;
  name: string;
  count: number;
  reach: number;
  url: string;
}

interface TrendingMusicResult {
  count: number;
  items: TrendingArtistItem[] | TrendingTrackItem[] | TrendingTagItem[];
}

const LASTFM_API_BASE = 'http://ws.audioscrobbler.com/2.0/';

async function callLastFmApi(method: string, params: Record<string, string>, apiKey: string): Promise<Record<string, unknown>> {
  const url = new URL(LASTFM_API_BASE);
  url.searchParams.append('method', method);
  url.searchParams.append('api_key', apiKey);
  url.searchParams.append('format', 'json');

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.append(key, value);
  });

  logger.debug(`Calling Last.fm API: ${method}`, params);

  // All Last.fm endpoints we call are reads — safe to retry on timeout.
  const response = await fetchWithTimeout(
    url.toString(),
    {},
    {
      timeoutMs: getExternalApiTimeoutMs(),
      retryPolicy: 'safe',
      operationLabel: `Last.fm ${method}`,
    },
  );

  if (!response.ok) {
    throw new Error(ErrorFormatter.lastfmApi(response));
  }

  const data = await response.json() as Record<string, unknown>;

  // Last.fm uses positive integers as error codes (e.g. 6 = artist not found).
  // error:0 means no error on some legacy endpoints — do NOT treat it as an error.
  if (typeof data['error'] === 'number' && data['error'] !== 0) {
    const message = typeof data['message'] === 'string' ? data['message'] : undefined;
    throw new Error(ErrorFormatter.lastfmResponse(message));
  }

  return data;
}

export async function getSimilarArtists(config: Config, args: unknown): Promise<SimilarArtistsResult> {
  const { artist, limit = 20 } = SimilarArtistsSchema.parse(args);

  logger.debug('Tool getSimilarArtists called with args:', { artist, limit });

  if (config.lastFmApiKey === undefined || config.lastFmApiKey === '') {
    throw new Error(ErrorFormatter.configMissing('Last.fm', 'LASTFM_API_KEY'));
  }

  logger.info(`Getting similar artists for: ${artist}`);

  const data = await callLastFmApi('artist.getSimilar', {
    artist,
    limit: limit.toString(),
    autocorrect: '1',
  }, config.lastFmApiKey);

  const similarArtistsContainer = data['similarartists'] as { artist?: unknown[] };
  const similarArtists = similarArtistsContainer.artist ?? [];

  return {
    count: similarArtists.length,
    similarArtists: similarArtists.map((a: unknown) => {
      const artist = a as Record<string, unknown>;
      return {
        name: typeof artist['name'] === 'string' ? artist['name'] : '',
        match: safeNumber(artist['match']),
        url: typeof artist['url'] === 'string' ? artist['url'] : '',
        mbid: typeof artist['mbid'] === 'string' ? artist['mbid'] : null,
      };
    }),
  };
}

export async function getSimilarTracks(config: Config, args: unknown): Promise<SimilarTracksResult> {
  const { artist, track, limit = 20 } = SimilarTracksSchema.parse(args);

  logger.debug('Tool getSimilarTracks called with args:', { artist, track, limit });

  if (config.lastFmApiKey === undefined || config.lastFmApiKey === '') {
    throw new Error(ErrorFormatter.configMissing('Last.fm', 'LASTFM_API_KEY'));
  }

  logger.info(`Getting similar tracks for: ${artist} - ${track}`);

  const data = await callLastFmApi('track.getSimilar', {
    artist,
    track,
    limit: limit.toString(),
    autocorrect: '1',
  }, config.lastFmApiKey);

  const similarTracksContainer = data['similartracks'] as { track?: unknown[] };
  const similarTracks = similarTracksContainer.track ?? [];

  return {
    count: similarTracks.length,
    similarTracks: similarTracks.map((t: unknown) => {
      const track = t as Record<string, unknown>;
      const trackArtist = track['artist'] as Record<string, unknown> | undefined;
      const artistName = trackArtist?.['name'] ?? trackArtist?.['#text'];
      return {
        name: typeof track['name'] === 'string' ? track['name'] : '',
        artist: typeof artistName === 'string' ? artistName : 'Unknown',
        match: safeNumber(track['match']),
        url: typeof track['url'] === 'string' ? track['url'] : '',
        mbid: typeof track['mbid'] === 'string' ? track['mbid'] : null,
      };
    }),
  };
}

export async function getArtistInfo(config: Config, args: unknown): Promise<ArtistInfoResult> {
  const { artist, lang = 'en' } = ArtistInfoSchema.parse(args);

  logger.debug('Tool getArtistInfo called with args:', { artist, lang });

  if (config.lastFmApiKey === undefined || config.lastFmApiKey === '') {
    throw new Error(ErrorFormatter.configMissing('Last.fm', 'LASTFM_API_KEY'));
  }

  logger.info(`Getting artist info for: ${artist}`);

  const data = await callLastFmApi('artist.getInfo', {
    artist,
    lang,
    autocorrect: '1',
  }, config.lastFmApiKey);

  const artistInfo = data['artist'] as Record<string, unknown>;
  const stats = artistInfo['stats'] as Record<string, unknown> | undefined;
  const bio = artistInfo['bio'] as Record<string, unknown> | undefined;
  const tags = artistInfo['tags'] as Record<string, unknown> | undefined;
  const similar = artistInfo['similar'] as Record<string, unknown> | undefined;
  const bioSummary = bio?.['summary'];

  return {
    name: typeof artistInfo['name'] === 'string' ? artistInfo['name'] : '',
    mbid: typeof artistInfo['mbid'] === 'string' ? artistInfo['mbid'] : null,
    url: typeof artistInfo['url'] === 'string' ? artistInfo['url'] : '',
    listeners: safeNumber(stats?.['listeners']),
    playcount: safeNumber(stats?.['playcount']),
    biography: typeof bioSummary === 'string' ? bioSummary.replace(/<[^>]*>/g, '') : null,
    tags: ((tags?.['tag'] as Record<string, unknown>[] | undefined) ?? []).map((t: Record<string, unknown>) => ({
      name: typeof t['name'] === 'string' ? t['name'] : '',
      url: typeof t['url'] === 'string' ? t['url'] : '',
    })),
    similar: ((similar?.['artist'] as Record<string, unknown>[] | undefined) ?? []).slice(0, 5).map((a: Record<string, unknown>) => typeof a['name'] === 'string' ? a['name'] : ''),
  };
}

export async function getTopTracksByArtist(config: Config, args: unknown): Promise<TopTracksByArtistResult> {
  const { artist, limit = 10 } = TopTracksByArtistSchema.parse(args);

  logger.debug('Tool getTopTracksByArtist called with args:', { artist, limit });

  if (config.lastFmApiKey === undefined || config.lastFmApiKey === '') {
    throw new Error(ErrorFormatter.configMissing('Last.fm', 'LASTFM_API_KEY'));
  }

  logger.info(`Getting top tracks for artist: ${artist}`);

  const data = await callLastFmApi('artist.getTopTracks', {
    artist,
    limit: limit.toString(),
    autocorrect: '1',
  }, config.lastFmApiKey);

  const topTracksContainer = data['toptracks'] as Record<string, unknown>;
  const topTracks = (topTracksContainer['track'] as Record<string, unknown>[] | undefined) ?? [];

  return {
    count: topTracks.length,
    tracks: topTracks.map((t: Record<string, unknown>, index: number) => ({
      rank: index + 1,
      name: typeof t['name'] === 'string' ? t['name'] : '',
      playcount: safeNumber(t['playcount']),
      listeners: safeNumber(t['listeners']),
      url: typeof t['url'] === 'string' ? t['url'] : '',
      mbid: typeof t['mbid'] === 'string' ? t['mbid'] : null,
    })),
  };
}

export async function getTrendingMusic(config: Config, args: unknown): Promise<TrendingMusicResult> {
  const { type, limit = 20, page = 1 } = TrendingMusicSchema.parse(args);

  logger.debug('Tool getTrendingMusic called with args:', { type, limit, page });

  if (config.lastFmApiKey === undefined || config.lastFmApiKey === '') {
    throw new Error(ErrorFormatter.configMissing('Last.fm', 'LASTFM_API_KEY'));
  }

  logger.info(`Getting global ${type} chart`);

  const method = type === 'artists' ? 'chart.getTopArtists' :
                 type === 'tracks' ? 'chart.getTopTracks' :
                 'chart.getTopTags';

  const data = await callLastFmApi(method, {
    limit: limit.toString(),
    page: page.toString(),
  }, config.lastFmApiKey);

  if (type === 'artists') {
    const artistsContainer = data['artists'] as Record<string, unknown>;
    const artists = ((artistsContainer['artist'] as Record<string, unknown>[] | undefined) ?? []).map((a: Record<string, unknown>, index: number): TrendingArtistItem => ({
      rank: (page - 1) * limit + index + 1,
      name: typeof a['name'] === 'string' ? a['name'] : '',
      playcount: safeNumber(a['playcount']),
      listeners: safeNumber(a['listeners']),
      url: typeof a['url'] === 'string' ? a['url'] : '',
      mbid: typeof a['mbid'] === 'string' ? a['mbid'] : null,
    }));

    return {
      count: artists.length,
      items: artists,
    };
  } else if (type === 'tracks') {
    const tracksContainer = data['tracks'] as Record<string, unknown>;
    const tracks = ((tracksContainer['track'] as Record<string, unknown>[] | undefined) ?? []).map((t: Record<string, unknown>, index: number): TrendingTrackItem => {
      const artistObj = t['artist'] as Record<string, unknown> | undefined;
      const artistName = artistObj?.['name'];
      return {
        rank: (page - 1) * limit + index + 1,
        name: typeof t['name'] === 'string' ? t['name'] : '',
        artist: typeof artistName === 'string' ? artistName : 'Unknown',
        playcount: safeNumber(t['playcount']),
        listeners: safeNumber(t['listeners']),
        url: typeof t['url'] === 'string' ? t['url'] : '',
        mbid: typeof t['mbid'] === 'string' ? t['mbid'] : null,
      };
    });

    return {
      count: tracks.length,
      items: tracks,
    };
  } else {
    // Last.fm's chart.getTopTags response does NOT include a `count` field —
    // it returns `reach` (unique users) and `taggings` (total tag applications)
    // instead. Surface `taggings` as `count` (the LLM-facing semantic field)
    // because that's the closer analogue to per-tag popularity; also expose
    // `reach` so callers that care about distinct users can use it.
    const tagsContainer = data['tags'] as Record<string, unknown>;
    const tags = ((tagsContainer['tag'] as Record<string, unknown>[] | undefined) ?? []).map((t: Record<string, unknown>, index: number): TrendingTagItem => ({
      rank: (page - 1) * limit + index + 1,
      name: typeof t['name'] === 'string' ? t['name'] : '',
      count: safeNumber(t['taggings'] ?? t['count']),
      reach: safeNumber(t['reach']),
      url: typeof t['url'] === 'string' ? t['url'] : '',
    }));

    return {
      count: tags.length,
      items: tags,
    };
  }
}