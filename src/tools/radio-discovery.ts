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
} from '../types/index.js';
import type { Config } from '../config.js';
import { validateRadioStream } from './radio-validation.js';
import { DISCOVERY_VALIDATION_TIMEOUT } from '../constants/timeouts.js';
import { DEFAULT_VALUES, DEFAULT_USER_AGENT } from '../constants/defaults.js';
import type { NavidromeClient } from '../client/navidrome-client.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { logger } from '../utils/logger.js';
import { safeNumber } from '../utils/safe-number.js';
import {
  fetchWithTimeout,
  getExternalApiTimeoutMs,
} from '../utils/fetch-with-timeout.js';
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
const DiscoverRadioStationsArgsSchema = z.object({
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
const GetRadioFiltersArgsSchema = z.object({
  kinds: z.array(z.enum(['tags', 'countries', 'languages', 'codecs'])).default(['tags', 'countries', 'languages', 'codecs'])
});

/**
 * Schema for getting station by UUID
 */
const GetStationByUuidArgsSchema = z.object({
  stationUuid: z.string()
});

/**
 * Schema for clicking a station
 */
const ClickStationArgsSchema = z.object({
  stationUuid: z.string()
});

/**
 * Schema for voting for a station
 */
const VoteStationArgsSchema = z.object({
  stationUuid: z.string()
});

/**
 * Convert Radio Browser API response to our DTO
 */
function mapStationToDTO(station: RadioBrowserStation): ExternalRadioStationDTO {
  const dto: ExternalRadioStationDTO = {
    stationUuid: station.stationuuid,
    name: station.name,
    playUrl: station.url_resolved ?? station.url,
    tags: (station.tags !== null && station.tags !== undefined && station.tags !== '') ? station.tags.split(',').map(t => t.trim()).filter(t => t !== '') : [],
    languageCodes: (station.languagecodes !== null && station.languagecodes !== undefined && station.languagecodes !== '') ? station.languagecodes.split(',').map(l => l.trim()).filter(l => l !== '') : [],
    hls: Boolean(station.hls),
    // safeNumber guards against Radio Browser sometimes returning numerics
    // as strings or non-numeric placeholders (matches the Last.fm pattern).
    votes: safeNumber(station.votes),
    clickCount: safeNumber(station.clickcount),
  };

  // Only include essential fields for cleaner LLM context
  if (station.homepage !== null && station.homepage !== undefined && station.homepage !== '') dto.homepage = station.homepage;
  if (station.countrycode !== null && station.countrycode !== undefined && station.countrycode !== '') dto.countryCode = station.countrycode;
  if (station.codec !== null && station.codec !== undefined && station.codec !== '') dto.codec = station.codec;
  if (station.bitrate !== undefined) {
    const bitrate = safeNumber(station.bitrate, -1);
    if (bitrate >= 0) dto.bitrate = bitrate;
  }
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

  logger.debug('Tool discoverRadioStations called with args:', params);

  try {
    const url = new URL('/json/stations/search', config.radioBrowserBase);
    
    // Map parameters to Radio Browser API format
    if (params.query !== null && params.query !== undefined && params.query !== '') url.searchParams.set('name', params.query);
    if (params.tag !== null && params.tag !== undefined && params.tag !== '') url.searchParams.set('tag', params.tag);
    if (params.countryCode !== null && params.countryCode !== undefined && params.countryCode !== '') url.searchParams.set('countrycode', params.countryCode);
    if (params.language !== null && params.language !== undefined && params.language !== '') url.searchParams.set('language', params.language);
    if (params.codec !== null && params.codec !== undefined && params.codec !== '') url.searchParams.set('codec', params.codec);
    if (params.bitrateMin !== undefined) url.searchParams.set('bitrateMin', String(params.bitrateMin));
    if (params.isHttps !== undefined) url.searchParams.set('is_https', params.isHttps ? 'true' : 'false');
    if (params.order) url.searchParams.set('order', params.order);
    if (params.reverse !== undefined) url.searchParams.set('reverse', params.reverse ? 'true' : 'false');
    if (params.offset !== undefined) url.searchParams.set('offset', String(params.offset));
    url.searchParams.set('limit', String(params.limit));
    url.searchParams.set('hidebroken', params.hideBroken ? 'true' : 'false');
    
    const response = await fetchWithTimeout(
      url.toString(),
      {
        headers: {
          'User-Agent': config.radioBrowserUserAgent ?? DEFAULT_USER_AGENT,
          'Accept': 'application/json'
        }
      },
      {
        timeoutMs: getExternalApiTimeoutMs(),
        retryPolicy: 'safe',
        operationLabel: 'Radio Browser /json/stations/search',
      },
    );

    if (!response.ok) {
      throw new Error(ErrorFormatter.radioBrowserApi(response));
    }

    const data = await response.json() as RadioBrowserStation[];
    const stations = data.map(mapStationToDTO);
    
    // Automatically validate all discovered stations
    const validatedStations = await validateDiscoveredStations(client, stations);
    
    // Create validation summary
    const validatedCount = validatedStations.filter(s => s.validation?.validated === true).length;
    const workingCount = validatedStations.filter(s => s.validation?.isValid === true).length;
    
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
    throw new Error(ErrorFormatter.toolExecution('discoverRadioStations', error));
  }
}

/**
 * Get available filter options for radio station discovery
 */
export async function getRadioFilters(config: Config, args: unknown): Promise<RadioFiltersResponse> {
  const params = GetRadioFiltersArgsSchema.parse(args);
  logger.debug('Tool getRadioFilters called with args:', params);
  const result: RadioFiltersResponse = {};
  
  try {
    const fetchPromises: Promise<void>[] = [];

    // All four filter-list endpoints are pure reads — safe to retry on timeout.
    const filterFetchOptions = {
      timeoutMs: getExternalApiTimeoutMs(),
      retryPolicy: 'safe' as const,
    };
    const filterHeaders = {
      headers: { 'User-Agent': config.radioBrowserUserAgent ?? DEFAULT_USER_AGENT, 'Accept': 'application/json' }
    };

    if (params.kinds.includes('tags')) {
      fetchPromises.push((async (): Promise<void> => {
        const res = await fetchWithTimeout(
          `${config.radioBrowserBase}/json/tags`,
          filterHeaders,
          { ...filterFetchOptions, operationLabel: 'Radio Browser /json/tags' },
        );
        const data = await res.json() as RadioBrowserTag[];
        result.tags = data
          .slice(0, 100)
          .map(t => ({ name: t.name, stationCount: t.stationcount }));
      })());
    }

    if (params.kinds.includes('countries')) {
      fetchPromises.push((async (): Promise<void> => {
        const res = await fetchWithTimeout(
          `${config.radioBrowserBase}/json/countries`,
          filterHeaders,
          { ...filterFetchOptions, operationLabel: 'Radio Browser /json/countries' },
        );
        const data = await res.json() as RadioBrowserCountry[];
        result.countries = data
          .slice(0, 100)
          .map(c => ({
            code: c.iso_3166_1,
            name: c.name,
            stationCount: c.stationcount
          }));
      })());
    }

    if (params.kinds.includes('languages')) {
      fetchPromises.push((async (): Promise<void> => {
        const res = await fetchWithTimeout(
          `${config.radioBrowserBase}/json/languages`,
          filterHeaders,
          { ...filterFetchOptions, operationLabel: 'Radio Browser /json/languages' },
        );
        const data = await res.json() as RadioBrowserLanguage[];
        result.languages = data
          .slice(0, 100)
          .map(l => ({
            code: l.iso_639 ?? l.name,
            name: l.name,
            stationCount: l.stationcount
          }));
      })());
    }

    if (params.kinds.includes('codecs')) {
      fetchPromises.push((async (): Promise<void> => {
        const res = await fetchWithTimeout(
          `${config.radioBrowserBase}/json/codecs`,
          filterHeaders,
          { ...filterFetchOptions, operationLabel: 'Radio Browser /json/codecs' },
        );
        const data = await res.json() as RadioBrowserCodec[];
        result.codecs = data
          .slice(0, 50)
          .map(c => ({
            name: c.name,
            stationCount: c.stationcount
          }));
      })());
    }

    await Promise.all(fetchPromises);
    return result;
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('getRadioFilters', error));
  }
}

/**
 * Get a specific radio station by UUID
 */
export async function getStationByUuid(config: Config, args: unknown): Promise<ExternalRadioStationDTO> {
  const params = GetStationByUuidArgsSchema.parse(args);

  logger.debug('Tool getStationByUuid called with args:', params);

  try {
    const url = `${config.radioBrowserBase}/json/stations/byuuid?uuids=${encodeURIComponent(params.stationUuid)}`;

    const response = await fetchWithTimeout(
      url,
      {
        headers: {
          'User-Agent': config.radioBrowserUserAgent ?? DEFAULT_USER_AGENT,
          'Accept': 'application/json'
        }
      },
      {
        timeoutMs: getExternalApiTimeoutMs(),
        retryPolicy: 'safe',
        operationLabel: 'Radio Browser /json/stations/byuuid',
      },
    );

    if (!response.ok) {
      throw new Error(ErrorFormatter.radioBrowserApi(response));
    }

    const data = await response.json() as RadioBrowserStation[];

    if (data === null || data === undefined || data.length === 0) {
      throw new Error(ErrorFormatter.notFound('Station', params.stationUuid));
    }
    
    const firstStation = data[0];
    if (!firstStation) {
      throw new Error(ErrorFormatter.notFound('Station', params.stationUuid));
    }
    
    return mapStationToDTO(firstStation);
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('getStationByUuid', error));
  }
}

/**
 * Register a play click for a station (helps with popularity metrics)
 */
export async function clickStation(config: Config, args: unknown): Promise<ClickRadioStationResponse> {
  const params = ClickStationArgsSchema.parse(args);

  logger.debug('Tool clickStation called with args:', params);

  try {
    const url = `${config.radioBrowserBase}/json/url/${encodeURIComponent(params.stationUuid)}`;

    // No retry: a click registers a popularity-metric event server-side.
    // Retrying on timeout could double-count if the first request landed.
    const response = await fetchWithTimeout(
      url,
      {
        headers: {
          'User-Agent': config.radioBrowserUserAgent ?? DEFAULT_USER_AGENT,
          'Accept': 'application/json'
        }
      },
      {
        timeoutMs: getExternalApiTimeoutMs(),
        retryPolicy: 'never',
        operationLabel: 'Radio Browser /json/url (click)',
      },
    );

    if (!response.ok) {
      throw new Error(ErrorFormatter.radioBrowserApi(response));
    }

    const data = await response.json() as RadioBrowserActionResponse;

    return {
      ok: Boolean(data.ok),
      playUrl: data.url ?? '',
      message: data.message ?? 'Click registered successfully'
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('clickStation', error));
  }
}

/**
 * Vote for a radio station
 */
export async function voteStation(config: Config, args: unknown): Promise<VoteRadioStationResponse> {
  const params = VoteStationArgsSchema.parse(args);

  logger.debug('Tool voteStation called with args:', params);

  try {
    const url = `${config.radioBrowserBase}/json/vote/${encodeURIComponent(params.stationUuid)}`;

    // No retry: a vote is recorded server-side. Retrying on timeout risks
    // double-voting if the first request landed but the response was lost.
    const response = await fetchWithTimeout(
      url,
      {
        headers: {
          'User-Agent': config.radioBrowserUserAgent ?? DEFAULT_USER_AGENT,
          'Accept': 'application/json'
        }
      },
      {
        timeoutMs: getExternalApiTimeoutMs(),
        retryPolicy: 'never',
        operationLabel: 'Radio Browser /json/vote',
      },
    );

    if (!response.ok) {
      throw new Error(ErrorFormatter.radioBrowserApi(response));
    }
    
    const data = await response.json() as RadioBrowserActionResponse;
    
    return {
      ok: Boolean(data.ok),
      message: data.message ?? 'Vote registered successfully'
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('voteStation', error));
  }
}