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

import type { z } from 'zod';
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
import { DiscoverRadioStationsArgsSchema, GetRadioFiltersArgsSchema, StationUuidSchema } from '../schemas/index.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { logger } from '../utils/logger.js';
import { safeNumber } from '../utils/safe-number.js';
import {
  fetchWithTimeout,
  getExternalApiTimeoutMs,
  type RetryPolicy,
} from '../utils/fetch-with-timeout.js';
import { getRadioBrowserBase, invalidateRadioBrowserBase } from '../utils/radio-browser-resolver.js';
import { hasRecentlyVoted, hasRecentlyClicked, markVoted, markClicked } from '../utils/radio-browser-rate-limit.js';

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
 * Radio Browser API tag, language or codec response
 */
interface RadioBrowserNamedCount {
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
 * Radio Browser API click/vote response
 */
interface RadioBrowserActionResponse {
  ok: boolean;
  message?: string;
  url?: string;
}

type RadioFilterKind = z.infer<typeof GetRadioFiltersArgsSchema>['kinds'][number];

interface RadioBrowserRequest {
  retryPolicy: RetryPolicy;
  label: string;
}

/**
 * GET a Radio Browser JSON endpoint. Only a network error, a timeout or a 5xx
 * suggests an unhealthy mirror, so only those drop the cached mirror.
 */
async function radioBrowserGetJson<T>(
  config: Config,
  base: string,
  pathAndQuery: string,
  request: RadioBrowserRequest,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${base}${pathAndQuery}`,
      {
        headers: {
          'User-Agent': config.radioBrowserUserAgent ?? DEFAULT_USER_AGENT,
          'Accept': 'application/json'
        }
      },
      {
        timeoutMs: getExternalApiTimeoutMs(),
        retryPolicy: request.retryPolicy,
        operationLabel: `Radio Browser ${request.label}`,
        respectProxy: true,
        // Only click and vote skip the retry, because each records an event server-side.
        nonIdempotent: request.retryPolicy === 'never',
      },
    );
  } catch (error) {
    invalidateRadioBrowserBase();
    throw error;
  }

  if (response.status >= 500) {
    invalidateRadioBrowserBase();
  }
  if (!response.ok) {
    throw new Error(ErrorFormatter.radioBrowserApi(response));
  }
  return await response.json() as T;
}

function splitList(value: string | undefined): string[] {
  if (value === undefined || value === '') {
    return [];
  }
  return value.split(',').map(item => item.trim()).filter(item => item !== '');
}

/**
 * Convert a Radio Browser row to our DTO. Returns null for a row missing its
 * uuid, name or url, since the station could not be identified or played.
 */
function mapStationToDTO(station: RadioBrowserStation): ExternalRadioStationDTO | null {
  // An empty url_resolved falls back to url. `??` would keep the empty string.
  const stationUuid = station.stationuuid;
  const name = station.name;
  const streamUrl = (station.url_resolved !== undefined && station.url_resolved !== '')
    ? station.url_resolved
    : station.url ?? '';
  if (
    stationUuid === undefined || stationUuid === null || stationUuid === '' ||
    name === undefined || name === null || name === '' ||
    streamUrl === ''
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
    streamUrl,
    tags: splitList(station.tags),
    // Names, not ISO codes, because discover's language filter matches language names.
    languages: splitList(station.language),
    hls: Boolean(station.hls),
    // Radio Browser sometimes returns numerics as strings or placeholders.
    votes: safeNumber(station.votes),
    clickCount: safeNumber(station.clickcount),
  };

  // favicon and lastCheckTime are left out to keep the LLM context small.
  if (station.homepage !== undefined && station.homepage !== '') dto.homePageUrl = station.homepage;
  if (station.countrycode !== undefined && station.countrycode !== '') dto.countryCode = station.countrycode;
  if (station.codec !== undefined && station.codec !== '') dto.codec = station.codec;
  if (station.bitrate !== undefined) {
    const bitrate = safeNumber(station.bitrate, -1);
    if (bitrate >= 0) dto.bitrate = bitrate;
  }

  return dto;
}

/**
 * Probe one discovered station. A failed probe becomes an `isValid:false`
 * result, so one bad host cannot sink the batch.
 */
async function probeStation(
  station: ExternalRadioStationDTO,
): Promise<ExternalRadioStationDTO> {
  try {
    const validationResult = await validateRadioStream({
      url: station.streamUrl,
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
 * Probe lane key for a station: its `host:port`. Some icecast hosts rate-limit
 * concurrent connections per IP, which false-FAILs real streams (Issue #7). An
 * unparseable URL gets its own lane.
 */
function stationHostKey(playUrl: string, index: number): string {
  try {
    return new URL(playUrl).host.toLowerCase();
  } catch {
    return `__unparseable_${index}`;
  }
}

/**
 * Probe the first RADIO_DISCOVERY_PROBE_COUNT stations. Different hosts run in parallel and same-host
 * stations run one at a time, so no rate-limiting host sees concurrent probes.
 *
 * Results are written back by original index, so the discovery order is kept.
 */
async function validateDiscoveredStations(
  stations: ExternalRadioStationDTO[]
): Promise<ExternalRadioStationDTO[]> {
  const maxValidations = Math.min(stations.length, DEFAULT_VALUES.RADIO_DISCOVERY_PROBE_COUNT);
  const stationsToValidate = stations.slice(0, maxValidations);
  const remainingStations = stations.slice(maxValidations);

  const buckets = new Map<string, Array<{ index: number; station: ExternalRadioStationDTO }>>();
  stationsToValidate.forEach((station, index) => {
    const key = stationHostKey(station.streamUrl, index);
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, [{ index, station }]);
    } else {
      bucket.push({ index, station });
    }
  });

  const results = new Array<ExternalRadioStationDTO>(stationsToValidate.length);
  await Promise.all(
    Array.from(buckets.values()).map(async (entries) => {
      for (const { index, station } of entries) {
        results[index] = await probeStation(station);
      }
    }),
  );

  return [...results, ...remainingStations];
}

/**
 * Discover radio stations via Radio Browser API
 */
export async function discoverRadioStations(
  config: Config,
  args: unknown
): Promise<DiscoverRadioStationsResponse> {
  try {
    const params = DiscoverRadioStationsArgsSchema.parse(args);
    // Popularity orders read best first. A name order reads A to Z.
    const reverse = params.reverse ?? params.order !== 'name';

    logger.debug('Tool discoverRadioStations called with args:', params);

    const radioBrowserBase = await getRadioBrowserBase(config.radioBrowserBaseOverride);

    const searchParams = new URLSearchParams();
    if (params.query !== undefined && params.query !== '') searchParams.set('name', params.query);
    if (params.tag !== undefined && params.tag !== '') searchParams.set('tag', params.tag);
    if (params.countryCode !== undefined && params.countryCode !== '') searchParams.set('countrycode', params.countryCode);
    if (params.language !== undefined && params.language !== '') searchParams.set('language', params.language);
    if (params.codec !== undefined && params.codec !== '') searchParams.set('codec', params.codec);
    if (params.bitrateMin !== undefined) searchParams.set('bitrateMin', String(params.bitrateMin));
    if (params.isHttps !== undefined) searchParams.set('is_https', params.isHttps ? 'true' : 'false');
    searchParams.set('order', params.order);
    searchParams.set('reverse', reverse ? 'true' : 'false');
    searchParams.set('offset', String(params.offset));
    searchParams.set('limit', String(params.limit));
    searchParams.set('hidebroken', params.hideBroken ? 'true' : 'false');

    const data = await radioBrowserGetJson<RadioBrowserStation[]>(
      config,
      radioBrowserBase,
      `/json/stations/search?${searchParams.toString()}`,
      { retryPolicy: 'safe', label: '/json/stations/search' },
    );

    const rawStations = data.map(mapStationToDTO).filter((s): s is ExternalRadioStationDTO => s !== null);

    // Radio Browser returns one stream under several name spellings, so streamUrl is
    // the dedupe key. Deduping before validation avoids probing a stream twice.
    const seen = new Set<string>();
    const stations = rawStations.filter(s => {
      if (seen.has(s.streamUrl)) {
        logger.debug('discoverRadioStations: deduping duplicate station', { name: s.name, streamUrl: s.streamUrl });
        return false;
      }
      seen.add(s.streamUrl);
      return true;
    });

    const validatedStations = await validateDiscoveredStations(stations);

    const validatedCount = validatedStations.filter(s => s.validation?.validated === true).length;
    const workingCount = validatedStations.filter(s => s.validation?.isValid === true).length;

    const result: DiscoverRadioStationsResponse = {
      stations: validatedStations,
      source: 'radio-browser',
      mirrorUsed: radioBrowserBase
    };

    if (validatedCount > 0) {
      const failedCount = validatedCount - workingCount;
      // Parallel probes can time out on slow or throttling hosts, so a FAIL is not a verdict.
      const failNote = failedCount > 0
        ? ' A "FAIL" is a best-effort parallel probe and can be a false negative for slow or rate-limiting hosts. Re-check a FAIL with validate_radio_stream before discarding it.'
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
    throw new Error(ErrorFormatter.toolExecution('discover_radio_stations', error));
  }
}

interface RadioFilterSpec {
  kind: RadioFilterKind;
  pathAndQuery: string;
  limit: number;
  map: (rows: unknown[]) => RadioFiltersResponse;
}

// Radio Browser sorts these lists by name by default, which puts junk rows first and pushes out rock, english and US.
const POPULAR_FIRST = 'order=stationcount&reverse=true&hidebroken=true';

const RADIO_FILTER_SPECS: readonly RadioFilterSpec[] = [
  {
    kind: 'tags',
    pathAndQuery: `/json/tags?${POPULAR_FIRST}&limit=100`,
    limit: 100,
    map: rows => ({
      tags: (rows as RadioBrowserNamedCount[]).map(t => ({ name: t.name, stationCount: safeNumber(t.stationcount) })),
    }),
  },
  {
    kind: 'countries',
    pathAndQuery: `/json/countries?${POPULAR_FIRST}&limit=100`,
    limit: 100,
    map: rows => ({
      countries: (rows as RadioBrowserCountry[]).map(c => ({
        code: c.iso_3166_1,
        name: c.name,
        stationCount: safeNumber(c.stationcount),
      })),
    }),
  },
  {
    kind: 'languages',
    pathAndQuery: `/json/languages?${POPULAR_FIRST}&limit=100`,
    limit: 100,
    map: rows => ({
      languages: (rows as RadioBrowserNamedCount[]).map(l => ({ name: l.name, stationCount: safeNumber(l.stationcount) })),
    }),
  },
  {
    kind: 'codecs',
    pathAndQuery: `/json/codecs?${POPULAR_FIRST}&limit=50`,
    limit: 50,
    map: rows => ({
      codecs: (rows as RadioBrowserNamedCount[]).map(c => ({ name: c.name, stationCount: safeNumber(c.stationcount) })),
    }),
  },
];

async function fetchRadioFilter(config: Config, base: string, spec: RadioFilterSpec): Promise<RadioFiltersResponse> {
  const rows = await radioBrowserGetJson<unknown[]>(config, base, spec.pathAndQuery, {
    retryPolicy: 'safe',
    label: `/json/${spec.kind}`,
  });
  // The server limit already applies. The slice caps a mirror that ignores it.
  return spec.map(rows.slice(0, spec.limit));
}

type RadioFilterOutcome =
  | { kind: RadioFilterKind; entries: RadioFiltersResponse }
  | { kind: RadioFilterKind; reason: unknown };

/**
 * Get available filter options for radio station discovery
 */
export async function getRadioFilters(config: Config, args: unknown): Promise<RadioFiltersResponse> {
  try {
    const params = GetRadioFiltersArgsSchema.parse(args);
    const result: RadioFiltersResponse = {};

    logger.debug('Tool getRadioFilters called with args:', params);

    const radioBrowserBase = await getRadioBrowserBase(config.radioBrowserBaseOverride);

    const outcomes = await Promise.all(
      RADIO_FILTER_SPECS
        .filter(spec => params.kinds.includes(spec.kind))
        .map(async (spec): Promise<RadioFilterOutcome> => {
          try {
            return { kind: spec.kind, entries: await fetchRadioFilter(config, radioBrowserBase, spec) };
          } catch (reason) {
            return { kind: spec.kind, reason };
          }
        }),
    );
    const failures = outcomes.filter((outcome) => 'reason' in outcome);

    if (outcomes.length > 0 && failures.length === outcomes.length) {
      const firstReason = failures[0]?.reason;
      throw firstReason instanceof Error ? firstReason : new Error(String(firstReason));
    }
    for (const outcome of outcomes) {
      if ('entries' in outcome) {
        Object.assign(result, outcome.entries);
      }
    }
    if (failures.length > 0) {
      // A missing category would otherwise read as zero available options.
      result.partialFailures = failures.map((f) => f.kind);
      for (const f of failures) {
        logger.warn('getRadioFilters sub-fetch failed:', f.kind, f.reason);
      }
    }
    return result;
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_radio_filters', error));
  }
}

/**
 * Get a specific radio station by UUID
 */
export async function getStationByUuid(config: Config, args: unknown): Promise<ExternalRadioStationDTO> {
  try {
    const { stationUuid } = StationUuidSchema.parse(args);

    logger.debug('Tool getStationByUuid called with args:', { stationUuid });

    const radioBrowserBase = await getRadioBrowserBase(config.radioBrowserBaseOverride);
    const data = await radioBrowserGetJson<RadioBrowserStation[]>(
      config,
      radioBrowserBase,
      `/json/stations/byuuid?uuids=${encodeURIComponent(stationUuid)}`,
      { retryPolicy: 'safe', label: '/json/stations/byuuid' },
    );

    const firstStation = data[0];
    const dto = firstStation === undefined ? null : mapStationToDTO(firstStation);
    if (dto === null) {
      throw new Error(ErrorFormatter.notFound('Station', stationUuid));
    }
    return dto;
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_station_by_uuid', error));
  }
}

/**
 * Register a play click for a station (helps with popularity metrics).
 *
 * A second click for the same UUID in this process returns a no-op instead of
 * calling Radio Browser, which counts one click per IP per day.
 */
export async function clickStation(config: Config, args: unknown): Promise<ClickRadioStationResponse> {
  try {
    const { stationUuid } = StationUuidSchema.parse(args);

    logger.debug('Tool clickStation called with args:', { stationUuid });

    if (hasRecentlyClicked(stationUuid)) {
      logger.debug(`clickStation: deduped (already clicked ${stationUuid} this session)`);
      return {
        success: false,
        streamUrl: '',
        message: `Already clicked station ${stationUuid} this session. Radio Browser counts unique clicks per IP per day, so additional calls would be no-ops anyway.`
      };
    }

    const radioBrowserBase = await getRadioBrowserBase(config.radioBrowserBaseOverride);
    // No retry: a retried click could be counted twice if the first one landed.
    const data = await radioBrowserGetJson<RadioBrowserActionResponse>(
      config,
      radioBrowserBase,
      `/json/url/${encodeURIComponent(stationUuid)}`,
      { retryPolicy: 'never', label: '/json/url (click)' },
    );
    const ok = Boolean(data.ok);

    // A rejected click stays unmarked so the caller can retry it.
    if (ok) {
      markClicked(stationUuid);
    }

    // Upstream's success text "retrieved station url" reads as an implementation leak, so success gets our own message.
    return {
      success: ok,
      streamUrl: data.url ?? '',
      message: ok ? 'Click registered successfully' : (data.message ?? 'Click failed'),
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('click_station', error));
  }
}

/**
 * Vote for a radio station.
 *
 * A second vote for the same UUID in this process returns a no-op instead of
 * calling Radio Browser, which accepts one vote per IP per day.
 */
export async function voteStation(config: Config, args: unknown): Promise<VoteRadioStationResponse> {
  try {
    const { stationUuid } = StationUuidSchema.parse(args);

    logger.debug('Tool voteStation called with args:', { stationUuid });

    if (hasRecentlyVoted(stationUuid)) {
      logger.debug(`voteStation: deduped (already voted ${stationUuid} this session)`);
      return {
        success: false,
        message: `Already voted for station ${stationUuid} this session. Radio Browser counts unique votes per IP per day, so additional calls would be rejected anyway.`
      };
    }

    const radioBrowserBase = await getRadioBrowserBase(config.radioBrowserBaseOverride);
    // No retry: a retried vote could be recorded twice if the first one landed.
    const data = await radioBrowserGetJson<RadioBrowserActionResponse>(
      config,
      radioBrowserBase,
      `/json/vote/${encodeURIComponent(stationUuid)}`,
      { retryPolicy: 'never', label: '/json/vote' },
    );
    const ok = Boolean(data.ok);

    // A declined vote stays unmarked, so a retry later is still meaningful.
    if (ok) {
      markVoted(stationUuid);
    }

    return {
      success: ok,
      message: ok ? 'Vote registered successfully' : (data.message ?? 'Vote failed'),
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('vote_station', error));
  }
}
