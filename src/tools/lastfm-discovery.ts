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

import { z } from 'zod';
import type { Config } from '../config.js';
import { logger } from '../utils/logger.js';

export interface LastFmArtist {
  name: string;
  match: number;
  url: string;
  mbid: string | null;
}

export interface SimilarArtistsResult {
  artist: string;
  count: number;
  similarArtists: LastFmArtist[];
}

export interface LastFmTrack {
  name: string;
  artist: string;
  match: number;
  url: string;
  mbid: string | null;
}

export interface SimilarTracksResult {
  originalTrack: { artist: string; track: string };
  count: number;
  similarTracks: LastFmTrack[];
}

export interface LastFmTag {
  name: string;
  url: string;
}

export interface ArtistInfoResult {
  name: string;
  mbid: string | null;
  url: string;
  listeners: number;
  playcount: number;
  biography: string | null;
  tags: LastFmTag[];
  similar: string[];
}

export interface TopTrackResult {
  rank: number;
  name: string;
  playcount: number;
  listeners: number;
  url: string;
  mbid: string | null;
}

export interface TopTracksByArtistResult {
  artist: string;
  count: number;
  tracks: TopTrackResult[];
}

export interface TrendingArtistItem {
  rank: number;
  name: string;
  playcount: number;
  listeners: number;
  url: string;
  mbid: string | null;
}

export interface TrendingTrackItem {
  rank: number;
  name: string;
  artist: string;
  playcount: number;
  listeners: number;
  url: string;
  mbid: string | null;
}

export interface TrendingTagItem {
  rank: number;
  name: string;
  count: number;
  url: string;
}

export interface TrendingMusicResult {
  type: string;
  page: number;
  perPage: number;
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
  
  const response = await fetch(url.toString());
  
  if (!response.ok) {
    throw new Error(`Last.fm API error: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json() as Record<string, unknown>;
  
  if (data.error) {
    throw new Error(`Last.fm API error: ${data.message || 'Unknown error'}`);
  }
  
  return data;
}

const SimilarArtistsSchema = z.object({
  artist: z.string().min(1),
  limit: z.number().min(1).max(100).optional().default(20),
});

export async function getSimilarArtists(config: Config, args: unknown): Promise<SimilarArtistsResult> {
  const { artist, limit = 20 } = SimilarArtistsSchema.parse(args);
  
  if (!config.lastFmApiKey) {
    throw new Error('Last.fm API key not configured');
  }
  
  logger.info(`Getting similar artists for: ${artist}`);
  
  const data = await callLastFmApi('artist.getSimilar', {
    artist,
    limit: limit.toString(),
    autocorrect: '1',
  }, config.lastFmApiKey);
  
  const similarArtists = (data.similarartists as { artist?: unknown[] })?.artist || [];
  
  return {
    artist,
    count: similarArtists.length,
    similarArtists: similarArtists.map((a: Record<string, unknown>) => ({
      name: String(a.name || ''),
      match: parseFloat(String(a.match || 0)),
      url: String(a.url || ''),
      mbid: (a.mbid as string) || null,
    })),
  };
}

const SimilarTracksSchema = z.object({
  artist: z.string().min(1),
  track: z.string().min(1),
  limit: z.number().min(1).max(100).optional().default(20),
});

export async function getSimilarTracks(config: Config, args: unknown): Promise<SimilarTracksResult> {
  const { artist, track, limit = 20 } = SimilarTracksSchema.parse(args);
  
  if (!config.lastFmApiKey) {
    throw new Error('Last.fm API key not configured');
  }
  
  logger.info(`Getting similar tracks for: ${artist} - ${track}`);
  
  const data = await callLastFmApi('track.getSimilar', {
    artist,
    track,
    limit: limit.toString(),
    autocorrect: '1',
  }, config.lastFmApiKey);
  
  const similarTracks = (data.similartracks as { track?: unknown[] })?.track || [];
  
  return {
    originalTrack: { artist, track },
    count: similarTracks.length,
    similarTracks: similarTracks.map((t: Record<string, unknown>) => ({
      name: String(t.name || ''),
      artist: String((t.artist as Record<string, unknown>)?.name || (t.artist as Record<string, unknown>)?.['#text'] || 'Unknown'),
      match: parseFloat(String(t.match || 0)),
      url: String(t.url || ''),
      mbid: (t.mbid as string) || null,
    })),
  };
}

const ArtistInfoSchema = z.object({
  artist: z.string().min(1),
  lang: z.string().optional().default('en'),
});

export async function getArtistInfo(config: Config, args: unknown): Promise<ArtistInfoResult> {
  const { artist, lang = 'en' } = ArtistInfoSchema.parse(args);
  
  if (!config.lastFmApiKey) {
    throw new Error('Last.fm API key not configured');
  }
  
  logger.info(`Getting artist info for: ${artist}`);
  
  const data = await callLastFmApi('artist.getInfo', {
    artist,
    lang,
    autocorrect: '1',
  }, config.lastFmApiKey);
  
  const artistInfo = (data.artist as Record<string, unknown>) || {};
  
  return {
    name: artistInfo.name,
    mbid: artistInfo.mbid || null,
    url: artistInfo.url,
    listeners: parseInt(artistInfo.stats?.listeners || '0', 10),
    playcount: parseInt(artistInfo.stats?.playcount || '0', 10),
    biography: artistInfo.bio?.summary?.replace(/<[^>]*>/g, '') || null,
    tags: ((artistInfo.tags as Record<string, unknown>)?.tag as Record<string, unknown>[] || []).map((t: Record<string, unknown>) => ({
      name: String(t.name || ''),
      url: String(t.url || ''),
    })),
    similar: ((artistInfo.similar as Record<string, unknown>)?.artist as Record<string, unknown>[] || []).slice(0, 5).map((a: Record<string, unknown>) => String(a.name || '')),
  };
}

const TopTracksByArtistSchema = z.object({
  artist: z.string().min(1),
  limit: z.number().min(1).max(50).optional().default(10),
});

export async function getTopTracksByArtist(config: Config, args: unknown): Promise<TopTracksByArtistResult> {
  const { artist, limit = 10 } = TopTracksByArtistSchema.parse(args);
  
  if (!config.lastFmApiKey) {
    throw new Error('Last.fm API key not configured');
  }
  
  logger.info(`Getting top tracks for artist: ${artist}`);
  
  const data = await callLastFmApi('artist.getTopTracks', {
    artist,
    limit: limit.toString(),
    autocorrect: '1',
  }, config.lastFmApiKey);
  
  const topTracks = (data.toptracks as Record<string, unknown>)?.track as Record<string, unknown>[] || [];
  
  return {
    artist,
    count: topTracks.length,
    tracks: topTracks.map((t: Record<string, unknown>, index: number) => ({
      rank: index + 1,
      name: t.name,
      playcount: parseInt(t.playcount || '0', 10),
      listeners: parseInt(t.listeners || '0', 10),
      url: t.url,
      mbid: t.mbid || null,
    })),
  };
}

const GlobalChartsSchema = z.object({
  type: z.enum(['artists', 'tracks', 'tags']),
  limit: z.number().min(1).max(100).optional().default(20),
  page: z.number().min(1).optional().default(1),
});

export async function getTrendingMusic(config: Config, args: unknown): Promise<TrendingMusicResult> {
  const { type, limit = 20, page = 1 } = GlobalChartsSchema.parse(args);
  
  if (!config.lastFmApiKey) {
    throw new Error('Last.fm API key not configured');
  }
  
  logger.info(`Getting global ${type} chart`);
  
  const method = type === 'artists' ? 'chart.getTopArtists' : 
                 type === 'tracks' ? 'chart.getTopTracks' :
                 'chart.getTopTags';
  
  const data = await callLastFmApi(method, {
    limit: limit.toString(),
    page: page.toString(),
  }, config.lastFmApiKey);
  
  let items: (TrendingArtistItem | TrendingTrackItem | TrendingTagItem)[] = [];
  
  if (type === 'artists') {
    items = ((data.artists as Record<string, unknown>)?.artist as Record<string, unknown>[] || []).map((a: Record<string, unknown>, index: number) => ({
      rank: (page - 1) * limit + index + 1,
      name: a.name,
      playcount: parseInt(a.playcount || '0', 10),
      listeners: parseInt(a.listeners || '0', 10),
      url: a.url,
      mbid: a.mbid || null,
    }));
  } else if (type === 'tracks') {
    items = ((data.tracks as Record<string, unknown>)?.track as Record<string, unknown>[] || []).map((t: Record<string, unknown>, index: number) => ({
      rank: (page - 1) * limit + index + 1,
      name: t.name,
      artist: String((t.artist as Record<string, unknown>)?.name || 'Unknown'),
      playcount: parseInt(t.playcount || '0', 10),
      listeners: parseInt(t.listeners || '0', 10),
      url: t.url,
      mbid: t.mbid || null,
    }));
  } else {
    items = ((data.tags as Record<string, unknown>)?.tag as Record<string, unknown>[] || []).map((t: Record<string, unknown>, index: number) => ({
      rank: (page - 1) * limit + index + 1,
      name: t.name,
      count: parseInt(t.count || '0', 10),
      url: t.url,
    }));
  }
  
  return {
    type,
    page,
    perPage: limit,
    count: items.length,
    items,
  };
}