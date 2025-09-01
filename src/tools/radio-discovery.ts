/**
 * Navidrome MCP Server - Radio Discovery Tools
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
import type { 
  ExternalRadioStationDTO, 
  DiscoverRadioStationsResponse,
  RadioFiltersResponse,
  ClickRadioStationResponse,
  VoteRadioStationResponse
} from '../types/dto.js';

const RADIO_BROWSER_BASE = process.env['RADIO_BROWSER_BASE'] || 'https://de1.api.radio-browser.info';
const USER_AGENT = process.env['RADIO_BROWSER_USER_AGENT'] || 'Navidrome-MCP/1.0 (+https://github.com/Blakeem/Navidrome-MCP)';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

/**
 * Radio Browser API station response
 */
interface RadioBrowserStation {
  stationuuid: string;
  name: string;
  url: string;
  url_resolved?: string;
  homepage?: string;
  favicon?: string;
  tags?: string;
  country?: string;
  countrycode?: string;
  state?: string;
  language?: string;
  languagecodes?: string;
  votes?: number;
  lastchangetime?: string;
  lastchangetime_iso8601?: string;
  codec?: string;
  bitrate?: number;
  hls?: number;
  lastcheckok?: number;
  lastchecktime?: string;
  lastchecktime_iso8601?: string;
  lastcheckoktime?: string;
  lastcheckoktime_iso8601?: string;
  lastlocalchecktime?: string;
  lastlocalchecktime_iso8601?: string;
  clicktimestamp?: string;
  clicktimestamp_iso8601?: string;
  clickcount?: number;
  clicktrend?: number;
  ssl_error?: number;
  geo_lat?: number | null;
  geo_long?: number | null;
  geo_distance?: number | null;
  has_extended_info?: boolean;
}

/**
 * Radio Browser API tag response
 */
interface RadioBrowserTag {
  name: string;
  stationcount: number;
}

/**
 * Radio Browser API country response
 */
interface RadioBrowserCountry {
  name: string;
  iso_3166_1: string;
  stationcount: number;
}

/**
 * Radio Browser API language response
 */
interface RadioBrowserLanguage {
  name: string;
  iso_639?: string;
  stationcount: number;
}

/**
 * Radio Browser API codec response
 */
interface RadioBrowserCodec {
  name: string;
  stationcount: number;
}

/**
 * Radio Browser API click/vote response
 */
interface RadioBrowserActionResponse {
  ok: boolean;
  message?: string;
  url?: string;
}

/**
 * Schema for discovering radio stations
 */
export const DiscoverRadioStationsArgsSchema = z.object({
  query: z.string().optional(),
  tag: z.string().optional(),
  countryCode: z.string().optional(),
  language: z.string().optional(),
  codec: z.string().optional(),
  bitrateMin: z.number().min(0).optional(),
  isHttps: z.boolean().optional(),
  order: z.enum(['name', 'votes', 'clickcount', 'bitrate', 'lastcheckok', 'random']).optional(),
  reverse: z.boolean().optional(),
  offset: z.number().min(0).optional(),
  limit: z.number().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  hideBroken: z.boolean().default(true)
});

/**
 * Schema for getting radio filter options
 */
export const GetRadioFiltersArgsSchema = z.object({
  kinds: z.array(z.enum(['tags', 'countries', 'languages', 'codecs'])).default(['tags', 'countries', 'languages', 'codecs'])
});

/**
 * Schema for getting station by UUID
 */
export const GetStationByUuidArgsSchema = z.object({
  stationUuid: z.string()
});

/**
 * Schema for clicking a station
 */
export const ClickStationArgsSchema = z.object({
  stationUuid: z.string()
});

/**
 * Schema for voting for a station
 */
export const VoteStationArgsSchema = z.object({
  stationUuid: z.string()
});

/**
 * Convert Radio Browser API response to our DTO
 */
function mapStationToDTO(station: RadioBrowserStation): ExternalRadioStationDTO {
  const dto: ExternalRadioStationDTO = {
    stationUuid: station.stationuuid,
    name: station.name,
    playUrl: station.url_resolved || station.url,
    tags: station.tags ? station.tags.split(',').filter((t: string) => t.trim()) : [],
    languageCodes: station.languagecodes ? station.languagecodes.split(',').filter((l: string) => l.trim()) : [],
    hls: Boolean(station.hls),
    votes: station.votes || 0,
    clickCount: station.clickcount || 0,
    lastCheckOk: Boolean(station.lastcheckok)
  };
  
  if (station.homepage) dto.homepage = station.homepage;
  if (station.favicon) dto.favicon = station.favicon;
  if (station.countrycode) dto.countryCode = station.countrycode;
  if (station.codec) dto.codec = station.codec;
  if (station.bitrate !== undefined) dto.bitrate = station.bitrate;
  if (station.lastchecktime_iso8601) dto.lastCheckTime = station.lastchecktime_iso8601;
  
  return dto;
}

/**
 * Discover radio stations via Radio Browser API
 */
export async function discoverRadioStations(args: unknown): Promise<DiscoverRadioStationsResponse> {
  const params = DiscoverRadioStationsArgsSchema.parse(args);
  
  try {
    const url = new URL('/json/stations/search', RADIO_BROWSER_BASE);
    
    // Map parameters to Radio Browser API format
    if (params.query) url.searchParams.set('name', params.query);
    if (params.tag) url.searchParams.set('tag', params.tag);
    if (params.countryCode) url.searchParams.set('countrycode', params.countryCode);
    if (params.language) url.searchParams.set('language', params.language);
    if (params.codec) url.searchParams.set('codec', params.codec);
    if (params.bitrateMin !== undefined) url.searchParams.set('bitrateMin', String(params.bitrateMin));
    if (params.isHttps !== undefined) url.searchParams.set('is_https', params.isHttps ? 'true' : 'false');
    if (params.order) url.searchParams.set('order', params.order);
    if (params.reverse !== undefined) url.searchParams.set('reverse', params.reverse ? 'true' : 'false');
    if (params.offset !== undefined) url.searchParams.set('offset', String(params.offset));
    url.searchParams.set('limit', String(params.limit));
    url.searchParams.set('hidebroken', params.hideBroken ? 'true' : 'false');
    
    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Radio Browser API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json() as RadioBrowserStation[];
    const stations = data.map(mapStationToDTO);
    
    return {
      stations,
      source: 'radio-browser',
      mirrorUsed: RADIO_BROWSER_BASE
    };
  } catch (error) {
    throw new Error(`Failed to discover radio stations: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get available filter options for radio station discovery
 */
export async function getRadioFilters(args: unknown): Promise<RadioFiltersResponse> {
  const params = GetRadioFiltersArgsSchema.parse(args);
  const result: RadioFiltersResponse = {};
  
  try {
    const fetchPromises: Promise<void>[] = [];
    
    if (params.kinds.includes('tags')) {
      fetchPromises.push(
        fetch(`${RADIO_BROWSER_BASE}/json/tags`, {
          headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' }
        })
        .then(res => res.json())
        .then((data) => {
          result.tags = (data as RadioBrowserTag[])
            .slice(0, 100)
            .map(t => ({ name: t.name, stationCount: t.stationcount }));
        })
      );
    }
    
    if (params.kinds.includes('countries')) {
      fetchPromises.push(
        fetch(`${RADIO_BROWSER_BASE}/json/countries`, {
          headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' }
        })
        .then(res => res.json())
        .then((data) => {
          result.countries = (data as RadioBrowserCountry[])
            .slice(0, 100)
            .map(c => ({ 
              code: c.iso_3166_1, 
              name: c.name, 
              stationCount: c.stationcount 
            }));
        })
      );
    }
    
    if (params.kinds.includes('languages')) {
      fetchPromises.push(
        fetch(`${RADIO_BROWSER_BASE}/json/languages`, {
          headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' }
        })
        .then(res => res.json())
        .then((data) => {
          result.languages = (data as RadioBrowserLanguage[])
            .slice(0, 100)
            .map(l => ({ 
              code: l.iso_639 || l.name, 
              name: l.name, 
              stationCount: l.stationcount 
            }));
        })
      );
    }
    
    if (params.kinds.includes('codecs')) {
      fetchPromises.push(
        fetch(`${RADIO_BROWSER_BASE}/json/codecs`, {
          headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' }
        })
        .then(res => res.json())
        .then((data) => {
          result.codecs = (data as RadioBrowserCodec[])
            .slice(0, 50)
            .map(c => ({ 
              name: c.name, 
              stationCount: c.stationcount 
            }));
        })
      );
    }
    
    await Promise.all(fetchPromises);
    return result;
  } catch (error) {
    throw new Error(`Failed to get radio filters: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get a specific radio station by UUID
 */
export async function getStationByUuid(args: unknown): Promise<ExternalRadioStationDTO> {
  const params = GetStationByUuidArgsSchema.parse(args);
  
  try {
    const url = `${RADIO_BROWSER_BASE}/json/stations/byuuid?uuids=${encodeURIComponent(params.stationUuid)}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Radio Browser API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json() as RadioBrowserStation[];
    
    if (!data || data.length === 0) {
      throw new Error(`Station not found: ${params.stationUuid}`);
    }
    
    const firstStation = data[0];
    if (!firstStation) {
      throw new Error(`Station not found: ${params.stationUuid}`);
    }
    
    return mapStationToDTO(firstStation);
  } catch (error) {
    throw new Error(`Failed to get station: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Register a play click for a station (helps with popularity metrics)
 */
export async function clickStation(args: unknown): Promise<ClickRadioStationResponse> {
  const params = ClickStationArgsSchema.parse(args);
  
  try {
    const url = `${RADIO_BROWSER_BASE}/json/url/${encodeURIComponent(params.stationUuid)}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Radio Browser API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json() as RadioBrowserActionResponse;
    
    return {
      ok: Boolean(data.ok),
      playUrl: data.url || '',
      message: data.message || 'Click registered successfully'
    };
  } catch (error) {
    throw new Error(`Failed to click station: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Vote for a radio station
 */
export async function voteStation(args: unknown): Promise<VoteRadioStationResponse> {
  const params = VoteStationArgsSchema.parse(args);
  
  try {
    const url = `${RADIO_BROWSER_BASE}/json/vote/${encodeURIComponent(params.stationUuid)}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Radio Browser API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json() as RadioBrowserActionResponse;
    
    return {
      ok: Boolean(data.ok),
      message: data.message || 'Vote registered successfully'
    };
  } catch (error) {
    throw new Error(`Failed to vote for station: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}