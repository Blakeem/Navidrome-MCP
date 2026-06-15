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
  stationuuid: string | null | undefined;
  name: string | null | undefined;
  url: string | null | undefined;
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
  stationUuid: z.string().min(1)
});

/**
 * Schema for clicking a station
 */
const ClickStationArgsSchema = z.object({
  stationUuid: z.string().min(1)
});

/**
 * Schema for voting for a station
 */
const VoteStationArgsSchema = z.object({
  stationUuid: z.string().min(1)
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
  //
  // Prefer url_resolved when it's a non-empty string. `??` would keep an empty
  // string (falsy but not null/undefined), yielding playUrl=''; the explicit
  // empty-string check handles `url_resolved=''` + `url='http://...'`.
  const stationUuid = station.stationuuid;
  const name = station.name;
  const playUrl = (station.url_resolved !== undefined && station.url_resolved !== '')
    ? station.url_resolved
    : station.url ?? '';
  if (
    stationUuid === undefined || stationUuid === null || stationUuid === '' ||
    name === undefined || name === null || name === '' ||
    playUrl === ''
  ) {
    logger.debug('mapStationToDTO: dropping station with missing required field', {
      stationuuid: station.stationuuid,
      name: station.name,
      url: station.url,
    });
    return null;
  }

  const dto: ExternalRadioStationDTO = {
    stationUuid,
    name,
    playUrl,
    tags: (station.tags !== undefined && station.tags !== '') ? station.tags.split(',').map(t => t.trim()).filter(t => t !== '') : [],
    languageCodes: (station.languagecodes !== undefined && station.languagecodes !== '') ? station.languagecodes.split(',').map(l => l.trim()).filter(l => l !== '') : [],
    hls: Boolean(station.hls),
    // safeNumber guards against Radio Browser sometimes returning numerics
    // as strings or non-numeric placeholders (matches the Last.fm pattern).
    votes: safeNumber(station.votes),
    clickCount: safeNumber(station.clickcount),
  };

  // Only include essential fields for cleaner LLM context
  if (station.homepage !== undefined && station.homepage !== '') dto.homepage = station.homepage;
  if (station.countrycode !== undefined && station.countrycode !== '') dto.countryCode = station.countrycode;
  if (station.codec !== undefined && station.codec !== '') dto.codec = station.codec;
  if (station.bitrate !== undefined) {
    const bitrate = safeNumber(station.bitrate, -1);
    if (bitrate >= 0) dto.bitrate = bitrate;
  }
  // Skip favicon and lastCheckTime to reduce context size
  
  return dto;
}

/**
 * Probe a single discovered station and attach its validation verdict. Never
 * throws — a failed probe becomes an `isValid:false` result so one bad host
 * can't sink the batch.
 */
async function probeStation(
  client: NavidromeClient,
  station: ExternalRadioStationDTO,
): Promise<ExternalRadioStationDTO> {
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
}

/**
 * Concurrency-control key for a station's probe: its `host:port`. Stations that
 * share a host must be probed one-at-a-time (some servers — e.g. icecast hosting
 * several popular mounts on one host:port — rate-limit concurrent connections
 * per IP, which stalls and false-FAILs real streams; see Issue #7). Falls back
 * to a per-station unique key when the URL can't be parsed, so an unparseable
 * URL runs in its own lane rather than being lumped in with others.
 */
function stationHostKey(playUrl: string, index: number): string {
  try {
    return new URL(playUrl).host.toLowerCase();
  } catch {
    return `__unparseable_${index}`;
  }
}

/**
 * Validate discovered radio stations.
 *
 * Probes the first 8 stations, bucketed by `host:port`: DIFFERENT hosts run
 * fully in parallel (the common case — 8 distinct hosts — is as fast as before),
 * while SAME-host stations run sequentially so we never open concurrent
 * connections to a host that rate-limits per IP (Issue #7). Every bucket is
 * launched at once, so a multi-station bucket starts its sequential chain
 * immediately and the longest single chain bounds total wall-clock — the slow,
 * clustered hosts surface and drain as early as possible.
 *
 * Results are written back by original index, so the caller's discovery order
 * (e.g. sorted by votes) is preserved regardless of which bucket finishes first.
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

  // Bucket by host:port, carrying each station's original index so results can
  // be slotted back in order.
  const buckets = new Map<string, Array<{ index: number; station: ExternalRadioStationDTO }>>();
  stationsToValidate.forEach((station, index) => {
    const key = stationHostKey(station.playUrl, index);
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, [{ index, station }]);
    } else {
      bucket.push({ index, station });
    }
  });

  // One lane per host, all launched concurrently; within a lane, probe one
  // station at a time.
  const results = new Array<ExternalRadioStationDTO>(stationsToValidate.length);
  await Promise.all(
    Array.from(buckets.values()).map(async (entries) => {
      for (const { index, station } of entries) {
        results[index] = await probeStation(client, station);
      }
    }),
  );

  // Add remaining stations without validation
  return [...results, ...remainingStations];
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
    if (params.query !== undefined && params.query !== '') url.searchParams.set('name', params.query);
    if (params.tag !== undefined && params.tag !== '') url.searchParams.set('tag', params.tag);
    if (params.countryCode !== undefined && params.countryCode !== '') url.searchParams.set('countrycode', params.countryCode);
    if (params.language !== undefined && params.language !== '') url.searchParams.set('language', params.language);
    if (params.codec !== undefined && params.codec !== '') url.searchParams.set('codec', params.codec);
    if (params.bitrateMin !== undefined) url.searchParams.set('bitrateMin', String(params.bitrateMin));
    if (params.isHttps !== undefined) url.searchParams.set('is_https', params.isHttps ? 'true' : 'false');
    url.searchParams.set('order', params.order);
    url.searchParams.set('reverse', params.reverse ? 'true' : 'false');
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
      const failedCount = validatedCount - workingCount;
      // A FAIL here is a best-effort quick probe, not a verdict: probes run in
      // parallel, so a slow TLS handshake or a host that throttles concurrent
      // connections (e.g. several popular streams sharing one icecast host) can
      // time out a station that actually works. Tell the caller to re-check a
      // FAIL one-at-a-time with validate_radio_stream before discarding it.
      const failNote = failedCount > 0
        ? ' A "FAIL" is a best-effort parallel probe and can be a false negative for slow or rate-limiting hosts — re-check a FAIL with validate_radio_stream before discarding it.'
        : '';
      result.validationSummary = {
        totalStations: stations.length,
        validatedStations: validatedCount,
        workingStations: workingCount,
        message: `Auto-validated first ${validatedCount} stations: ${workingCount} working, ${failedCount} not working.${failNote}`,
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
        if (!res.ok) throw new Error(ErrorFormatter.radioBrowserApi(res));
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
        if (!res.ok) throw new Error(ErrorFormatter.radioBrowserApi(res));
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
        if (!res.ok) throw new Error(ErrorFormatter.radioBrowserApi(res));
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
        if (!res.ok) throw new Error(ErrorFormatter.radioBrowserApi(res));
        const data = await res.json() as RadioBrowserCodec[];
        result.codecs = data
          .slice(0, 50)
          .map(c => ({
            name: c.name,
            stationCount: c.stationcount
          }));
      })());
    }

    const outcomes = await Promise.allSettled(fetchPromises);
    const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected');
    const allFailed = outcomes.length > 0 && rejected.length === outcomes.length;
    if (allFailed) {
      throw rejected[0]?.reason instanceof Error
        ? rejected[0].reason
        : new Error(String(rejected[0]?.reason));
    }
    for (const o of rejected) {
      logger.debug('getRadioFilters sub-fetch failed:', o.reason);
    }
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

    if (data.length === 0) {
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
    if (data.ok) {
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
    if (data.ok) {
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