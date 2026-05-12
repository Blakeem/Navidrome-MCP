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
import { getRadioBrowserBase, invalidateRadioBrowserBase } from '../utils/radio-browser-resolver.js';
import { hasRecentlyVoted, hasRecentlyClicked, markVoted, markClicked } from '../utils/radio-browser-rate-limit.js';
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
 * Convert Radio Browser API response to our DTO.
 * Returns null for rows missing required fields (stationuuid, name, or url) —
 * Radio Browser occasionally serves partially-populated rows and we'd rather
 * drop them silently than surface a station with no way to identify or play it.
 */
function mapStationToDTO(station: RadioBrowserStation): ExternalRadioStationDTO | null {
  // Guard required fields. An empty stationuuid means we can't identify the
  // station later (e.g. for click/vote); an empty name or url means we can't
  // play or display it. Drop these rows before they reach the LLM.
  const hasUuid = station.stationuuid !== '' && station.stationuuid !== undefined && station.stationuuid !== null;
  const hasName = station.name !== '' && station.name !== undefined && station.name !== null;
  const hasUrl = (station.url !== '' && station.url !== undefined && station.url !== null) ||
                 (station.url_resolved !== '' && station.url_resolved !== undefined && station.url_resolved !== null);
  if (!hasUuid || !hasName || !hasUrl) {
    logger.debug('mapStationToDTO: dropping station with missing required field', {
      stationuuid: station.stationuuid,
      name: station.name,
      url: station.url,
    });
    return null;
  }

  // Prefer url_resolved when it's a non-empty string. `??` would keep an empty
  // string (falsy but not null/undefined), yielding playUrl=''. The hasUrl
  // guard above caught the all-empty case but `url_resolved=''` + `url='http://...'`
  // would slip through without this explicit empty-string check.
  const playUrl = (station.url_resolved !== undefined && station.url_resolved !== null && station.url_resolved !== '')
    ? station.url_resolved
    : station.url;
  const dto: ExternalRadioStationDTO = {
    stationUuid: station.stationuuid,
    name: station.name,
    playUrl,
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
 * Validate discovered radio stations.
 *
 * Validates the first 8 stations in parallel — each hits a different upstream
 * host so they're network-independent and serial processing buys nothing except
 * extra wall-clock time (8 × 2s timeout = 16s). Promise.all gives us ~2s total
 * for the batch instead of 16s worst-case.
 *
 * Why 8: practical cap so we don't fan out to hundreds of hosts for large
 * result sets; Radio Browser's `hideBroken` filter already pre-screens for
 * recently-verified stations, so the first 8 are a representative sample.
 */
async function validateDiscoveredStations(
  client: NavidromeClient,
  stations: ExternalRadioStationDTO[]
): Promise<ExternalRadioStationDTO[]> {
  const maxValidations = Math.min(stations.length, 8);
  const stationsToValidate = stations.slice(0, maxValidations);
  const remainingStations = stations.slice(maxValidations);

  // Validate in parallel — each station hits a different host so there is no
  // shared rate-limit concern. Individual timeouts inside validateRadioStream
  // ensure a slow host doesn't delay the whole batch beyond DISCOVERY_VALIDATION_TIMEOUT.
  const validatedStations = await Promise.all(
    stationsToValidate.map(async (station): Promise<ExternalRadioStationDTO> => {
      try {
        const validationResult = await validateRadioStream(client, {
          url: station.playUrl,
          timeout: DISCOVERY_VALIDATION_TIMEOUT,
        });
        return {
          ...station,
          validation: {
            validated: true,
            isValid: validationResult.success,
            status: validationResult.success ? 'OK' : 'FAIL',
            duration: validationResult.testDuration,
          },
        };
      } catch {
        return {
          ...station,
          validation: {
            validated: true,
            isValid: false,
            status: 'FAIL',
          },
        };
      }
    })
  );

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

  const radioBrowserBase = await getRadioBrowserBase(config.radioBrowserBaseOverride);

  try {
    const url = new URL('/json/stations/search', radioBrowserBase);
    
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

    // Filter out rows missing required fields (stationuuid/name/url) before
    // any further processing. mapStationToDTO returns null for these.
    const rawStations = data.map(mapStationToDTO).filter((s): s is ExternalRadioStationDTO => s !== null);

    // Dedupe on (name, playUrl): Radio Browser commonly returns multiple rows
    // for the same logical station (e.g., from different regional mirrors).
    // Apply dedupe BEFORE validation so we don't waste round-trips probing
    // the same stream twice. Key on playUrl alone — Radio Browser commonly
    // returns the same logical station with case/spelling variants of `name`
    // ("Jazz FM" vs "jazz fm") all pointing at the same playUrl, and the URL
    // is a stable unique identifier for the stream itself.
    const seen = new Set<string>();
    const stations = rawStations.filter(s => {
      if (seen.has(s.playUrl)) {
        logger.debug('discoverRadioStations: deduping duplicate station', { name: s.name, playUrl: s.playUrl });
        return false;
      }
      seen.add(s.playUrl);
      return true;
    });

    // Automatically validate all discovered stations (parallelized — see below)
    const validatedStations = await validateDiscoveredStations(client, stations);

    // Create validation summary
    const validatedCount = validatedStations.filter(s => s.validation?.validated === true).length;
    const workingCount = validatedStations.filter(s => s.validation?.isValid === true).length;

    const result: DiscoverRadioStationsResponse = {
      stations: validatedStations,
      source: 'radio-browser',
      mirrorUsed: radioBrowserBase
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
    // Drop the cached mirror so the next call re-resolves SRV. Cheap (one
    // DNS lookup) and self-heals from a mirror that went down mid-cache-window.
    invalidateRadioBrowserBase();
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

  const radioBrowserBase = await getRadioBrowserBase(config.radioBrowserBaseOverride);

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
          `${radioBrowserBase}/json/tags`,
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
          `${radioBrowserBase}/json/countries`,
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
          `${radioBrowserBase}/json/languages`,
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
          `${radioBrowserBase}/json/codecs`,
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
    invalidateRadioBrowserBase();
    throw new Error(ErrorFormatter.toolExecution('getRadioFilters', error));
  }
}

/**
 * Get a specific radio station by UUID
 */
export async function getStationByUuid(config: Config, args: unknown): Promise<ExternalRadioStationDTO> {
  const params = GetStationByUuidArgsSchema.parse(args);

  logger.debug('Tool getStationByUuid called with args:', params);

  const radioBrowserBase = await getRadioBrowserBase(config.radioBrowserBaseOverride);

  try {
    const url = `${radioBrowserBase}/json/stations/byuuid?uuids=${encodeURIComponent(params.stationUuid)}`;

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

    const dto = mapStationToDTO(firstStation);
    if (dto === null) {
      throw new Error(ErrorFormatter.notFound('Station', params.stationUuid));
    }
    return dto;
  } catch (error) {
    invalidateRadioBrowserBase();
    throw new Error(ErrorFormatter.toolExecution('getStationByUuid', error));
  }
}

/**
 * Register a play click for a station (helps with popularity metrics).
 *
 * Per-session dedup: the second call for the same UUID returns a friendly
 * no-op (success: true, ok: false) instead of hitting Radio Browser. The
 * upstream tracks clicks per-IP-per-day server-side anyway, so additional
 * calls would be silently rejected — surfacing this client-side keeps an
 * LLM from looping and risking a UA ban.
 */
export async function clickStation(config: Config, args: unknown): Promise<ClickRadioStationResponse> {
  const params = ClickStationArgsSchema.parse(args);

  logger.debug('Tool clickStation called with args:', params);

  if (hasRecentlyClicked(params.stationUuid)) {
    logger.debug(`clickStation: deduped (already clicked ${params.stationUuid} this session)`);
    return {
      ok: false,
      playUrl: '',
      message: `Already clicked station ${params.stationUuid} this session — Radio Browser counts unique clicks per IP per day, so additional calls would be no-ops anyway.`
    };
  }

  const radioBrowserBase = await getRadioBrowserBase(config.radioBrowserBaseOverride);

  try {
    const url = `${radioBrowserBase}/json/url/${encodeURIComponent(params.stationUuid)}`;

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

    // Mark as clicked only on a successful round-trip — if Radio Browser
    // rejected the click (data.ok=false), let the caller retry next turn.
    if (data.ok === true) {
      markClicked(params.stationUuid);
    }

    // On a successful click we override Radio Browser's `message`. Upstream
    // returns the internal debug-y text "retrieved station url" which reads
    // like a leak of implementation detail to LLM consumers — semantically
    // a click registers a play with Radio Browser's popularity counters.
    // On failure we surface the upstream message so the caller can see what
    // went wrong (e.g. "station not found").
    const ok = Boolean(data.ok);
    const message = ok
      ? 'Click registered successfully'
      : (data.message ?? 'Click failed');

    return {
      ok,
      playUrl: data.url ?? '',
      message,
    };
  } catch (error) {
    invalidateRadioBrowserBase();
    throw new Error(ErrorFormatter.toolExecution('clickStation', error));
  }
}

/**
 * Vote for a radio station.
 *
 * Per-session dedup: the second call for the same UUID returns a friendly
 * no-op instead of hitting Radio Browser. Per the upstream docs votes are
 * dedup'd per-IP-per-day server-side, so an LLM looping would accumulate
 * rejected requests and risk getting our shared User-Agent banned.
 */
export async function voteStation(config: Config, args: unknown): Promise<VoteRadioStationResponse> {
  const params = VoteStationArgsSchema.parse(args);

  logger.debug('Tool voteStation called with args:', params);

  if (hasRecentlyVoted(params.stationUuid)) {
    logger.debug(`voteStation: deduped (already voted ${params.stationUuid} this session)`);
    return {
      ok: false,
      message: `Already voted for station ${params.stationUuid} this session — Radio Browser counts unique votes per IP per day, so additional calls would be rejected anyway.`
    };
  }

  const radioBrowserBase = await getRadioBrowserBase(config.radioBrowserBaseOverride);

  try {
    const url = `${radioBrowserBase}/json/vote/${encodeURIComponent(params.stationUuid)}`;

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

    // Only record the dedup marker on a confirmed-successful vote; if
    // Radio Browser declined (data.ok=false, e.g. "station not found"),
    // a retry next session/process is still meaningful.
    if (data.ok === true) {
      markVoted(params.stationUuid);
    }

    return {
      ok: Boolean(data.ok),
      message: data.message ?? 'Vote registered successfully'
    };
  } catch (error) {
    invalidateRadioBrowserBase();
    throw new Error(ErrorFormatter.toolExecution('voteStation', error));
  }
}