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
import type { Config } from '../config.js';
import { validateRadioStream } from './radio-validation.js';
import { DISCOVERY_VALIDATION_TIMEOUT } from '../constants/timeouts.js';
import { DEFAULT_VALUES } from '../constants/defaults.js';
import type { NavidromeClient } from '../client/navidrome-client.js';
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
  order: z.enum(['name', 'votes', 'clickcount', 'bitrate', 'lastcheckok', 'random']).default('votes'),
  reverse: z.boolean().default(true),
  offset: z.number().min(0).optional(),
  limit: z.number().min(1).max(MAX_LIMIT).default(DEFAULT_VALUES.RADIO_DISCOVERY_LIMIT),
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
    clickCount: station.clickcount || 0
  };
  
  // Only include essential fields for cleaner LLM context
  if (station.homepage) dto.homepage = station.homepage;
  if (station.countrycode) dto.countryCode = station.countrycode;
  if (station.codec) dto.codec = station.codec;
  if (station.bitrate !== undefined) dto.bitrate = station.bitrate;
  // Skip favicon and lastCheckTime to reduce context size
  
  return dto;
}

/**
 * Validate discovered radio stations
 */
async function validateDiscoveredStations(
  client: NavidromeClient,
  stations: ExternalRadioStationDTO[]
): Promise<ExternalRadioStationDTO[]> {
  // Validate up to 8 stations with individual timeouts to handle rate limiting
  const maxValidations = Math.min(stations.length, 8);
  const stationsToValidate = stations.slice(0, maxValidations);
  const remainingStations = stations.slice(maxValidations);
  
  // Process validations with individual timeouts, not in parallel to avoid rate limiting
  const validatedStations: ExternalRadioStationDTO[] = [];
  
  for (const station of stationsToValidate) {
    try {
      // Each validation gets its own timeout - no overall time limit
      const validationResult = await validateRadioStream(client, {
        url: station.playUrl,
        timeout: DISCOVERY_VALIDATION_TIMEOUT
      });
      
      const validation = {
        validated: true,
        isValid: validationResult.success,
        status: validationResult.success ? 'OK' : 'FAIL',
        duration: validationResult.testDuration
      };
      
      validatedStations.push({
        ...station,
        validation
      });
    } catch {
      // If validation fails, mark as failed but include the station
      validatedStations.push({
        ...station,
        validation: {
          validated: true,
          isValid: false,
          status: 'FAIL',
        }
      });
    }
  }
  
  // Add remaining stations without validation
  return [...validatedStations, ...remainingStations];
}

/**
 * Discover radio stations via Radio Browser API
 */
export async function discoverRadioStations(
  config: Config,
  client: NavidromeClient,
  args: unknown
): Promise<DiscoverRadioStationsResponse> {
  const params = DiscoverRadioStationsArgsSchema.parse(args);
  
  try {
    const url = new URL('/json/stations/search', config.radioBrowserBase);
    
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
        'User-Agent': config.radioBrowserUserAgent || 'Navidrome-MCP/1.0',
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Radio Browser API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json() as RadioBrowserStation[];
    const stations = data.map(mapStationToDTO);
    
    // Automatically validate all discovered stations
    const validatedStations = await validateDiscoveredStations(client, stations);
    
    // Create validation summary
    const validatedCount = validatedStations.filter(s => s.validation?.validated).length;
    const workingCount = validatedStations.filter(s => s.validation?.isValid).length;
    
    const result: DiscoverRadioStationsResponse = {
      stations: validatedStations,
      source: 'radio-browser',
      mirrorUsed: config.radioBrowserBase
    };
    
    if (validatedCount > 0) {
      result.validationSummary = {
        totalStations: stations.length,
        validatedStations: validatedCount,
        workingStations: workingCount,
        message: `Auto-validated first ${validatedCount} stations: ${workingCount} working, ${validatedCount - workingCount} not working.`
      };
    }
    
    return result;
  } catch (error) {
    throw new Error(`Failed to discover radio stations: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get available filter options for radio station discovery
 */
export async function getRadioFilters(config: Config, args: unknown): Promise<RadioFiltersResponse> {
  const params = GetRadioFiltersArgsSchema.parse(args);
  const result: RadioFiltersResponse = {};
  
  try {
    const fetchPromises: Promise<void>[] = [];
    
    if (params.kinds.includes('tags')) {
      fetchPromises.push(
        fetch(`${config.radioBrowserBase}/json/tags`, {
          headers: { 'User-Agent': config.radioBrowserUserAgent || 'Navidrome-MCP/1.0', 'Accept': 'application/json' }
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
        fetch(`${config.radioBrowserBase}/json/countries`, {
          headers: { 'User-Agent': config.radioBrowserUserAgent || 'Navidrome-MCP/1.0', 'Accept': 'application/json' }
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
        fetch(`${config.radioBrowserBase}/json/languages`, {
          headers: { 'User-Agent': config.radioBrowserUserAgent || 'Navidrome-MCP/1.0', 'Accept': 'application/json' }
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
        fetch(`${config.radioBrowserBase}/json/codecs`, {
          headers: { 'User-Agent': config.radioBrowserUserAgent || 'Navidrome-MCP/1.0', 'Accept': 'application/json' }
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
export async function getStationByUuid(config: Config, args: unknown): Promise<ExternalRadioStationDTO> {
  const params = GetStationByUuidArgsSchema.parse(args);
  
  try {
    const url = `${config.radioBrowserBase}/json/stations/byuuid?uuids=${encodeURIComponent(params.stationUuid)}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': config.radioBrowserUserAgent || 'Navidrome-MCP/1.0',
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
export async function clickStation(config: Config, args: unknown): Promise<ClickRadioStationResponse> {
  const params = ClickStationArgsSchema.parse(args);
  
  try {
    const url = `${config.radioBrowserBase}/json/url/${encodeURIComponent(params.stationUuid)}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': config.radioBrowserUserAgent || 'Navidrome-MCP/1.0',
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
export async function voteStation(config: Config, args: unknown): Promise<VoteRadioStationResponse> {
  const params = VoteStationArgsSchema.parse(args);
  
  try {
    const url = `${config.radioBrowserBase}/json/vote/${encodeURIComponent(params.stationUuid)}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': config.radioBrowserUserAgent || 'Navidrome-MCP/1.0',
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