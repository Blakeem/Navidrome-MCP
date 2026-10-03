import type { z } from 'zod';
import type { Config } from '../config.js';
import type { NavidromeClient } from '../client/navidrome-client.js';
import type {
  RadioStationDTO,
  CreateRadioStationResponse,
  DeleteRadioStationResponse,
  ListRadioStationsResponse,
} from '../types/index.js';
import { CreateRadioStationArgsSchema, RadioStationIdSchema } from '../schemas/index.js';
import { logger } from '../utils/logger.js';
import { getMessageManager } from '../utils/message-manager.js';
import { BATCH_VALIDATION_TIMEOUT } from '../constants/timeouts.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { playbackEngine } from '../services/playback/playback-engine.js';
import { Cache } from '../utils/cache.js';
import { nullIfGoZeroTime } from '../utils/go-time.js';
import { hasControlChars, isHttpUrlScheme } from '../utils/network-safety.js';
import { validateRadioStream } from './radio-validation.js';

/**
 * Why a URL is unusable as a station URL, phrased to complete the sentence
 * "Stream URL for station X ...", or null when it is fine. The control-char
 * case is called out separately because the scheme message is actively
 * misleading for it: a URL pasted with a trailing newline DOES start with
 * http:// and the user has no way to see the character that failed.
 */
function describeUrlProblem(url: string): string | null {
  if (hasControlChars(url)) return 'must not contain line breaks or control characters';
  if (!isHttpUrlScheme(url)) return 'must use http:// or https://';
  return null;
}

type StationInput = z.infer<typeof CreateRadioStationArgsSchema>['stations'][number];

// Snapshot of REST `/api/radio` fetched with `_start=0&_end=10000`, kept for `config.cacheTtl`.
// Single-station lookups and play_radio_station read it, and create and delete invalidate it.
let stationCache: Cache<RadioStationDTO[]> | null = null;
const CACHE_KEY = 'all';

// Concurrent cold-cache callers share one fetch. Invalidation clears it and bumps the
// generation, so a fetch that started before a create or delete never writes the cache.
let inflightFetch: Promise<RadioStationDTO[]> | null = null;
let stationCacheGeneration = 0;

function getStationCache(config: Config): Cache<RadioStationDTO[]> {
  // Auto-cleanup is off. Reads already check the TTL, and its timer would keep the process alive.
  stationCache ??= new Cache<RadioStationDTO[]>(config.cacheTtl, false);
  return stationCache;
}

/**
 * Drop the cached station snapshot. Call after any successful mutation
 * (create/delete) so the next read goes back to Navidrome.
 */
export function invalidateRadioStationCache(): void {
  if (stationCache !== null) {
    stationCache.delete(CACHE_KEY);
  }
  inflightFetch = null;
  stationCacheGeneration += 1;
}

/**
 * Test-only: fully discard the cache instance (releases setInterval if
 * auto-cleanup were ever enabled, and resets singleton state). Production
 * code calls invalidateRadioStationCache() instead.
 */
export function resetRadioStationCacheForTesting(): void {
  if (stationCache !== null) {
    stationCache.destroy();
  }
  stationCache = null;
  inflightFetch = null;
}

/**
 * Raw row shape from Navidrome's REST `/api/radio` endpoint.
 *
 * Why REST instead of Subsonic /getInternetRadioStations:
 *  - Subsonic drops `homePageUrl` and ships no per-station timestamps.
 *    Every station shared one bulk-import timestamp, which made the list
 *    response look like a bug to LLM consumers.
 *  - REST `/radio` returns `homePageUrl`, real per-station `createdAt`
 *    and `updatedAt`. It's the same auth (X-ND-Authorization) the rest
 *    of the codebase already uses for non-Subsonic endpoints.
 *
 * `homePageUrl` is often emitted as an empty string for stations created
 * without one, which is treated as "unset" downstream.
 */
interface RestRadioStationRow {
  id: string;
  name: string;
  streamUrl: string;
  homePageUrl?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * List all internet radio stations, cached for `config.cacheTtl` seconds.
 * Omitting `config` bypasses the cache on purpose. The post-create id lookup in createRadioStation relies on that.
 */
export async function listRadioStations(
  client: NavidromeClient,
  args: unknown,
  config?: Config
): Promise<ListRadioStationsResponse> {
  try {
    logger.debug('Tool listRadioStations called with args:', args);

    let cachedStations: RadioStationDTO[] | undefined;
    if (config !== undefined) {
      cachedStations = getStationCache(config).get(CACHE_KEY);
    }

    let stations: RadioStationDTO[];
    if (cachedStations !== undefined) {
      stations = cachedStations;
    } else if (inflightFetch !== null) {
      const generation = stationCacheGeneration;
      stations = await inflightFetch;
      // A config-less owner fetches without writing, so a piggybacking caller with
      // config warms the cache itself unless an invalidation landed meanwhile.
      if (config !== undefined && generation === stationCacheGeneration && getStationCache(config).get(CACHE_KEY) === undefined) {
        getStationCache(config).set(CACHE_KEY, stations);
      }
    } else {
      const generation = stationCacheGeneration;
      const fetchPromise = (async (): Promise<RadioStationDTO[]> => {
        // `_end=10000` fetches every station in one round trip. Instances hold hundreds at most.
        const rows = await client.request<RestRadioStationRow[]>('/radio?_start=0&_end=10000');

        const result = rows.map(row => {
          const stationDto: RadioStationDTO = {
            id: row.id,
            name: row.name,
            streamUrl: row.streamUrl,
            // nullIfGoZeroTime guards against Navidrome rows that somehow
            // came through without a real timestamp (would be the Go zero
            // value), returning null so the DTO honestly signals an absent
            // timestamp instead of a misleading sentinel date.
            createdAt: nullIfGoZeroTime(row.createdAt),
            updatedAt: nullIfGoZeroTime(row.updatedAt),
          };

          if (row.homePageUrl !== undefined && row.homePageUrl !== '') {
            stationDto.homePageUrl = row.homePageUrl;
          }

          return stationDto;
        });

        if (config !== undefined && generation === stationCacheGeneration) {
          getStationCache(config).set(CACHE_KEY, result);
        }
        return result;
      })();
      inflightFetch = fetchPromise;
      try {
        stations = await fetchPromise;
      } finally {
        // Clear regardless of success/failure so a failed fetch doesn't poison
        // subsequent retries. The cache itself is only written on success.
        if (inflightFetch === fetchPromise) inflightFetch = null;
      }
    }

    // Get one-time message for radio list tip
    const messageManager = getMessageManager();
    const tip = messageManager.getMessage('radio.list_tip');

    const apiResponse: ListRadioStationsResponse = {
      stations,
      total: stations.length,
    };

    // Add tip if this is the first time showing the list
    if (tip !== null && tip !== '') {
      apiResponse.tip = tip;
    }

    return apiResponse;
  } catch (error) {
    logger.error('Error listing radio stations:', error);
    throw new Error(ErrorFormatter.toolExecution('list_radio_stations', error));
  }
}

/**
 * The input problem that rejects a station before any network call, or null when it may be created.
 */
function describeStationInputProblem(station: StationInput): string | null {
  if (!station.name || station.name.trim() === '') {
    return 'Station name is required and cannot be empty';
  }

  if (!station.streamUrl || station.streamUrl.trim() === '') {
    return `Stream URL is required for station "${station.name}"`;
  }

  // The scheme check runs whatever validateBeforeAdd says, since file://, smb:// and
  // mpv-only schemes would otherwise reach mpv loadfile through play_radio_station.
  const streamProblem = describeUrlProblem(station.streamUrl);
  if (streamProblem !== null) {
    return `Stream URL for station "${station.name}" ${streamProblem}`;
  }

  // homePageUrl reaches Navidrome and comes back out in the station DTO,
  // so an unchecked `javascript:`/`file:` value would be stored and handed
  // to whatever renders it. Same rule as the stream URL.
  const homePageProblem = station.homePageUrl !== undefined && station.homePageUrl.trim() !== ''
    ? describeUrlProblem(station.homePageUrl)
    : null;
  if (homePageProblem !== null) {
    return `Home page URL for station "${station.name}" ${homePageProblem}`;
  }

  return null;
}

type CreatedStationResult = CreateRadioStationResponse & { station: RadioStationDTO };

/**
 * Fill in the real ids of just-created stations. Subsonic's create does not echo
 * the id, and an empty id would make a follow-up delete or get fail.
 *
 * One list call serves the whole batch. Matches use (name, streamUrl), newest id
 * first since Navidrome ids are monotonic, and each id is assigned once because
 * Navidrome allows duplicate stations.
 */
async function resolveCreatedStationIds(
  client: NavidromeClient,
  pendingLookups: CreatedStationResult[],
): Promise<void> {
  try {
    const allStations = await listRadioStations(client, {});
    const assignedIds = new Set<string>();
    for (const result of pendingLookups) {
      const matches = allStations.stations
        .filter(s => s.name === result.station.name && s.streamUrl === result.station.streamUrl)
        .filter(s => !assignedIds.has(s.id))
        .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
      const newest = matches[0];
      if (newest !== undefined) {
        result.station.id = newest.id;
        result.station.createdAt = newest.createdAt;
        result.station.updatedAt = newest.updatedAt;
        assignedIds.add(newest.id);
      } else {
        // The note keeps the LLM from calling delete_radio_station('') with the empty id.
        result.note = `Created "${result.station.name}" but could not resolve its id. Call list_radio_stations to find it.`;
        logger.warn(
          `Created station "${result.station.name}" but could not find a fresh match in the post-create listing. Leaving id empty.`
        );
      }
    }
  } catch (lookupError) {
    // Every pending result is annotated so the LLM does not round-trip an empty id into delete or get.
    for (const result of pendingLookups) {
      result.note = `Created "${result.station.name}" but failed to look up its id. Call list_radio_stations to find it.`;
    }
    logger.warn('Failed to resolve created radio station IDs:', lookupError);
  }
}

/**
 * Create radio stations - always processes as batch (single station = batch of 1)
 */
export async function createRadioStation(
  client: NavidromeClient,
  args: unknown
): Promise<{ results: CreateRadioStationResponse[]; summary: string }> {
  try {
    const params = CreateRadioStationArgsSchema.parse(args);

    logger.debug('Tool createRadioStation called with args:', { stationCount: params.stations.length, validateBeforeAdd: params.validateBeforeAdd });

    const results: CreateRadioStationResponse[] = [];
    // A result row does not record why it failed, so validation failures keep their own counter.
    let validationFailedCount = 0;

    for (const station of params.stations) {
      try {
        const inputProblem = describeStationInputProblem(station);
        if (inputProblem !== null) {
          results.push({ success: false, error: inputProblem });
          continue;
        }

        logger.debug('Creating radio station:', station);

        if (params.validateBeforeAdd) {
          const validationResult = await validateRadioStream({
            url: station.streamUrl,
            timeout: BATCH_VALIDATION_TIMEOUT
          });

          if (!validationResult.success) {
            results.push({
              success: false,
              error: `Stream validation failed for "${station.name}": ${validationResult.errors.join(', ')}`
            });
            validationFailedCount++;
            continue;
          }
        }

        // The Subsonic parameter is `homepageUrl`. Navidrome drops the camelCase `homePageUrl` form.
        const subsonicParams: Record<string, string> = {
          streamUrl: station.streamUrl,
          name: station.name,
        };
        if (station.homePageUrl !== undefined && station.homePageUrl.trim() !== '') {
          subsonicParams['homepageUrl'] = station.homePageUrl;
        }
        await client.subsonicRequest('/createInternetRadioStation', subsonicParams, { retryPolicy: 'never' });

        // The empty id is a sentinel that resolveCreatedStationIds fills in after the batch.
        const createdStation: RadioStationDTO = {
          id: '',
          name: station.name,
          streamUrl: station.streamUrl,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        if (station.homePageUrl !== undefined && station.homePageUrl.trim() !== '') {
          createdStation.homePageUrl = station.homePageUrl;
        }

        results.push({
          success: true,
          station: createdStation,
        });

      } catch (error) {
        logger.error(`Error creating radio station "${station.name}":`, error);
        // Per-station error inside batch loop: the outer prefix already names
        // the operation, so we keep the raw extracted message rather than
        // double-wrapping with ErrorFormatter.toolExecution.
        results.push({
          success: false,
          error: `Failed to add "${station.name}": ${error instanceof Error ? error.message : 'Unknown error'}`
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failedCount = results.length - successCount;

    if (successCount > 0) {
      invalidateRadioStationCache();
    }

    const pendingLookups = results.filter((r): r is CreatedStationResult =>
      r.success && r.station !== undefined && r.station.id === ''
    );
    if (pendingLookups.length > 0) {
      await resolveCreatedStationIds(client, pendingLookups);
    }

    let summary = `Added ${successCount} of ${params.stations.length} station(s).`;
    if (failedCount > 0) {
      summary += ` ${failedCount} failed`;
      if (validationFailedCount > 0) {
        summary += ` (${validationFailedCount} due to validation)`;
      }
      summary += '.';
    }

    return {
      results,
      summary
    };
  } catch (error) {
    logger.error('Error creating radio station:', error);
    throw new Error(ErrorFormatter.toolExecution('create_radio_station', error));
  }
}

/**
 * Delete a radio station by ID. The deleted id is not echoed back, since
 * the LLM just sent it. success: true is sufficient confirmation.
 * The id surfaces in the DEBUG log line for diagnostics.
 */
export async function deleteRadioStation(
  client: NavidromeClient,
  args: unknown
): Promise<DeleteRadioStationResponse> {
  try {
    const params = RadioStationIdSchema.parse(args);

    logger.debug('Tool deleteRadioStation called with args:', params);

    await client.subsonicRequest('/deleteInternetRadioStation', { id: params.stationId }, { retryPolicy: 'never' });

    // A subsequent get_radio_station(deleted-id) would otherwise return the stale row.
    invalidateRadioStationCache();

    return {
      success: true,
      message: 'Successfully deleted radio station',
    };
  } catch (error) {
    logger.error('Error deleting radio station:', error);
    throw new Error(ErrorFormatter.toolExecution('delete_radio_station', error));
  }
}

/**
 * Get a specific radio station by ID from the station list, which is cached when `config` is given.
 */
export async function getRadioStation(
  client: NavidromeClient,
  args: unknown,
  config?: Config
): Promise<RadioStationDTO> {
  try {
    const params = RadioStationIdSchema.parse(args);

    logger.debug('Tool getRadioStation called with args:', params);

    const allStations = await listRadioStations(client, {}, config);
    const station = allStations.stations.find(s => s.id === params.stationId);

    if (!station) {
      throw new Error(`Radio station with ID ${params.stationId} not found`);
    }

    return station;
  } catch (error) {
    logger.error('Error getting radio station:', error);
    throw new Error(ErrorFormatter.toolExecution('get_radio_station', error));
  }
}

// `station.id` is not echoed because the LLM just sent it. `name` and
// `streamUrl` are server-resolved (the LLM only knew the id) so they stay.
interface PlayRadioStationResult {
  success: true;
  station: {
    name: string;
    streamUrl: string;
  };
}

/**
 * Play a radio station through the local mpv player.
 *
 * Behavior: replaces the entire live play queue with this single radio
 * stream and starts playback. Radio is mutually exclusive with songs and
 * albums in the play queue (mpv playlists mixing infinite streams with
 * finite tracks behave unintuitively, and Navidrome's web UI follows the
 * same convention). Conversely, calling `play_songs` / `play_albums` /
 * `play_*_search` while a radio is playing replaces the radio with songs.
 *
 * Requires `mpv` on the host (see `playback_status` to verify). Throws if
 * the station ID doesn't exist or mpv isn't available.
 */
export async function playRadioStation(
  client: NavidromeClient,
  args: unknown,
  config?: Config
): Promise<PlayRadioStationResult> {
  try {
    const { stationId } = RadioStationIdSchema.parse(args);

    logger.debug('Tool playRadioStation called with args:', { stationId });

    const station = await getRadioStation(client, { stationId }, config);

    if (typeof station.streamUrl !== 'string' || station.streamUrl.trim() === '') {
      throw new Error(`Radio station "${station.name}" has no stream URL`);
    }

    await playbackEngine.enqueueRadio(station.streamUrl, station.name);

    return {
      success: true,
      station: {
        name: station.name,
        streamUrl: station.streamUrl,
      },
    };
  } catch (error) {
    logger.error('Error playing radio station:', error);
    throw new Error(ErrorFormatter.toolExecution('play_radio_station', error));
  }
}
