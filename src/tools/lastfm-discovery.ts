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
  callLastFmApi,
  requireLastFmApiKey,
  stripWikiHtml,
} from '../utils/lastfm.js';
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

// Input echoes are dropped because the LLM already holds them.
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

export async function getSimilarArtists(config: Config, args: unknown): Promise<SimilarArtistsResult> {
  try {
    const { artist, limit } = SimilarArtistsSchema.parse(args);

    logger.debug('Tool getSimilarArtists called with args:', { artist, limit });

    const apiKey = requireLastFmApiKey(config);

    logger.info(`Getting similar artists for: ${artist}`);

    const data = await callLastFmApi('artist.getSimilar', {
      artist,
      limit: limit.toString(),
      autocorrect: '1',
    }, apiKey);

    const similarArtistsRaw = data['similarartists'];
    if (typeof similarArtistsRaw !== 'object' || similarArtistsRaw === null) {
      throw new Error(ErrorFormatter.lastfmResponse('unexpected response shape: missing similarartists'));
    }
    const similarArtistsContainer = similarArtistsRaw as { artist?: unknown[] };
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
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_similar_artists', error));
  }
}

export async function getSimilarTracks(config: Config, args: unknown): Promise<SimilarTracksResult> {
  try {
    const { artist, track, limit } = SimilarTracksSchema.parse(args);

    logger.debug('Tool getSimilarTracks called with args:', { artist, track, limit });

    const apiKey = requireLastFmApiKey(config);

    logger.info(`Getting similar tracks for: ${artist} - ${track}`);

    const data = await callLastFmApi('track.getSimilar', {
      artist,
      track,
      limit: limit.toString(),
      autocorrect: '1',
    }, apiKey);

    const similarTracksRaw = data['similartracks'];
    if (typeof similarTracksRaw !== 'object' || similarTracksRaw === null) {
      throw new Error(ErrorFormatter.lastfmResponse('unexpected response shape: missing similartracks'));
    }
    const similarTracksContainer = similarTracksRaw as { track?: unknown[] };
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
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_similar_tracks', error));
  }
}

export async function getArtistInfo(config: Config, args: unknown): Promise<ArtistInfoResult> {
  try {
    const { artist, lang } = ArtistInfoSchema.parse(args);

    logger.debug('Tool getArtistInfo called with args:', { artist, lang });

    const apiKey = requireLastFmApiKey(config);

    logger.info(`Getting artist info for: ${artist}`);

    const data = await callLastFmApi('artist.getInfo', {
      artist,
      lang,
      autocorrect: '1',
    }, apiKey);

    const artistInfoRaw = data['artist'];
    if (typeof artistInfoRaw !== 'object' || artistInfoRaw === null) {
      throw new Error(ErrorFormatter.lastfmResponse('unexpected response shape: missing artist'));
    }
    const artistInfo = artistInfoRaw as Record<string, unknown>;
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
      biography: typeof bioSummary === 'string' ? stripWikiHtml(bioSummary) : null,
      tags: ((tags?.['tag'] as Record<string, unknown>[] | undefined) ?? []).map((t: Record<string, unknown>) => ({
        name: typeof t['name'] === 'string' ? t['name'] : '',
        url: typeof t['url'] === 'string' ? t['url'] : '',
      })),
      similar: ((similar?.['artist'] as Record<string, unknown>[] | undefined) ?? []).slice(0, 5).map((a: Record<string, unknown>) => typeof a['name'] === 'string' ? a['name'] : ''),
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_artist_info', error));
  }
}

export async function getTopTracksByArtist(config: Config, args: unknown): Promise<TopTracksByArtistResult> {
  try {
    const { artist, limit } = TopTracksByArtistSchema.parse(args);

    logger.debug('Tool getTopTracksByArtist called with args:', { artist, limit });

    const apiKey = requireLastFmApiKey(config);

    logger.info(`Getting top tracks for artist: ${artist}`);

    const data = await callLastFmApi('artist.getTopTracks', {
      artist,
      limit: limit.toString(),
      autocorrect: '1',
    }, apiKey);

    const topTracksRaw = data['toptracks'];
    if (typeof topTracksRaw !== 'object' || topTracksRaw === null) {
      throw new Error(ErrorFormatter.lastfmResponse('unexpected response shape: missing toptracks'));
    }
    const topTracksContainer = topTracksRaw as Record<string, unknown>;
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
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_top_tracks_by_artist', error));
  }
}

export async function getTrendingMusic(config: Config, args: unknown): Promise<TrendingMusicResult> {
  try {
    const { type, limit, page } = TrendingMusicSchema.parse(args);

    logger.debug('Tool getTrendingMusic called with args:', { type, limit, page });

    const apiKey = requireLastFmApiKey(config);

    logger.info(`Getting global ${type} chart`);

    const method = type === 'artists' ? 'chart.getTopArtists' :
                   type === 'tracks' ? 'chart.getTopTracks' :
                   'chart.getTopTags';

    const data = await callLastFmApi(method, {
      limit: limit.toString(),
      page: page.toString(),
    }, apiKey);

    if (type === 'artists') {
      const artistsRaw = data['artists'];
      if (typeof artistsRaw !== 'object' || artistsRaw === null) {
        throw new Error(ErrorFormatter.lastfmResponse('unexpected response shape: missing artists'));
      }
      const artistsContainer = artistsRaw as Record<string, unknown>;
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
      const tracksRaw = data['tracks'];
      if (typeof tracksRaw !== 'object' || tracksRaw === null) {
        throw new Error(ErrorFormatter.lastfmResponse('unexpected response shape: missing tracks'));
      }
      const tracksContainer = tracksRaw as Record<string, unknown>;
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
      // chart.getTopTags has no count field. `taggings` (total applications) is the
      // closest analogue to popularity, and `reach` (distinct users) rides along.
      const tagsRaw = data['tags'];
      if (typeof tagsRaw !== 'object' || tagsRaw === null) {
        throw new Error(ErrorFormatter.lastfmResponse('unexpected response shape: missing tags'));
      }
      const tagsContainer = tagsRaw as Record<string, unknown>;
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
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_trending_music', error));
  }
}
