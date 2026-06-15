import { z } from 'zod';
import type { Config } from '../config.js';
import type { NavidromeClient } from '../client/navidrome-client.js';
import type {
  RadioStationDTO,
  CreateRadioStationResponse,
  DeleteRadioStationResponse,
  ListRadioStationsResponse,
} from '../types/index.js';
import { logger } from '../utils/logger.js';
import { getMessageManager } from '../utils/message-manager.js';
import { BATCH_VALIDATION_TIMEOUT } from '../constants/timeouts.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { playbackEngine } from '../services/playback/playback-engine.js';
import { Cache } from '../utils/cache.js';
import { nullIfGoZeroTime } from '../utils/go-time.js';
import { isHttpUrlScheme } from '../utils/network-safety.js';

// Zod schemas for radio tool arguments — used instead of `args as { ... }` casts
// to catch invalid inputs before they reach the Subsonic API.
const RadioStationIdSchema = z.object({
  stationId: z.string().min(1, 'Radio station ID is required'),
});

// Per-station name/url validation is intentionally kept in the loop below so
// that a batch with one bad entry still processes the rest and returns per-item
// success/failure results rather than throwing for the entire batch.
const CreateRadioStationArgsSchema = z.object({
  stations: z.array(z.object({
    name: z.string(),
    streamUrl: z.string(),
    homePageUrl: z.string().optional(),
  })).min(1, 'At least one station must be provided'),
  validateBeforeAdd: z.boolean().optional().default(false),
});

/**
 * Cache for the Subsonic /getInternetRadioStations result.
 *
 * Why: Subsonic has no "get one station" endpoint, so getRadioStation()
 * (and play_radio_station via getRadioStation) used to do a full list-fetch
 * + in-memory filter on every call. For a user with hundreds of saved
 * stations that's hundreds of rows pulled per play. Cache the snapshot so
 * a typical "play this station" hits memory.
 *
 * Shape: single keyed entry ('all') holding the full station array.
 * Subsonic returns the whole list anyway and Navidrome's free API has no
 * pagination on this endpoint — caching the entire array keeps the lookup
 * trivially correct (no partial-page corner cases) and the memory cost is
 * negligible (a few KB even for 1000+ stations).
 *
 * TTL: pulled from `config.cacheTtl` (default 300s, env-configurable via
 * CACHE_TTL). This is the only consumer of `cacheTtl` so it doubles as a
 * fix for the "cacheTtl parsed but never read" review item.
 *
 * Invalidation: createRadioStation and deleteRadioStation both call
 * invalidateRadioStationCache() after a successful mutation. Discovery
 * (Radio Browser) does NOT touch this cache — those are external stations,
 * not Navidrome's saved list. There is no updateRadioStation in Subsonic;
 * if Navidrome ever ships one, add a call site here.
 *
 * Module-level singleton so every getRadioStation/listRadioStations call
 * across all tool invocations shares the same snapshot. Auto-cleanup is
 * disabled — the data set is small and already TTL-checked on every read,
 * so the periodic-cleanup timer would just keep the process alive for no
 * reason.
 */
let stationCache: Cache<RadioStationDTO[]> | null = null;
const CACHE_KEY = 'all';

// In-flight fetch dedup so concurrent cold-cache callers (e.g. two rapid
// `play_radio_station` calls at startup) all await the same Subsonic round
// trip instead of stampeding the server. Mirrors the inflight pattern in
// `radio-browser-resolver.ts`.
let inflightFetch: Promise<RadioStationDTO[]> | null = null;

function getStationCache(config: Config): Cache<RadioStationDTO[]> {
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
 *  - Subsonic drops `homePageUrl` and ships no per-station timestamps —
 *    every station shared one bulk-import timestamp, which made the list
 *    response look like a bug to LLM consumers.
 *  - REST `/radio` returns `homePageUrl`, real per-station `createdAt`
 *    and `updatedAt`. It's the same auth (X-ND-Authorization) the rest
 *    of the codebase already uses for non-Subsonic endpoints.
 *
 * `homePageUrl` is often emitted as an empty string for stations created
 * without one — treated as "unset" downstream.
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
 * List all internet radio stations.
 *
 * Cached for `config.cacheTtl` seconds (default 300) — Subsonic only offers
 * a list endpoint, so all single-station lookups (`getRadioStation`,
 * `play_radio_station`) flow through this and benefit from the snapshot.
 * Mutations (create/delete) invalidate the cache so the next read is fresh.
 *
 * `config` is optional purely for backward compat with internal callers
 * (the post-create id-resolution path inside `createRadioStation` already
 * has config in scope but threads through `client` only). When omitted,
 * the cache is bypassed for that single call.
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
      // Another caller is already fetching — piggy-back instead of stampeding.
      stations = await inflightFetch;
      // The in-flight owner only warms the cache if IT had a config. A
      // config-less owner (e.g. the post-create id lookup) fetches without
      // writing, so a piggybacking caller that DOES have config must warm
      // the cache itself — otherwise the next read re-fetches needlessly.
      if (config !== undefined && getStationCache(config).get(CACHE_KEY) === undefined) {
        getStationCache(config).set(CACHE_KEY, stations);
      }
    } else {
      const fetchPromise = (async (): Promise<RadioStationDTO[]> => {
        // Use Navidrome's REST `/radio` endpoint instead of Subsonic
        // `/getInternetRadioStations`. The REST endpoint preserves
        // `homePageUrl` and ships real per-station `createdAt`/`updatedAt`
        // timestamps. `_end=10000` is the same "fetch all" idiom used for
        // other unpaginated list views — Navidrome instances in the wild top
        // out at hundreds of radio stations, so this is one HTTP round trip.
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

        if (config !== undefined) {
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
 * Create radio stations - always processes as batch (single station = batch of 1)
 */
export async function createRadioStation(
  client: NavidromeClient,
  config: Config,
  args: unknown
): Promise<{ results: CreateRadioStationResponse[]; summary: string }> {
  try {
    const params = CreateRadioStationArgsSchema.parse(args);

    logger.debug('Tool createRadioStation called with args:', { stationCount: params.stations.length, validateBeforeAdd: params.validateBeforeAdd });

    const results: CreateRadioStationResponse[] = [];
    let successCount = 0;
    let failedCount = 0;
    let validationFailedCount = 0;

    // Process each station
    for (const station of params.stations) {
      try {
        // Validate required fields
        if (!station.name || station.name.trim() === '') {
          results.push({
            success: false,
            error: 'Station name is required and cannot be empty'
          });
          failedCount++;
          continue;
        }

        if (!station.streamUrl || station.streamUrl.trim() === '') {
          results.push({
            success: false,
            error: `Stream URL is required for station "${station.name}"`
          });
          failedCount++;
          continue;
        }

        // Enforce an http/https-only scheme on the DEFAULT path (independent
        // of validateBeforeAdd). Without this, file://, smb://, gopher:// etc.
        // would sail through and later reach mpv loadfile via
        // play_radio_station. Reuses the same isHttpUrlScheme helper the
        // opt-in validator uses. mpv-only protocols (mms://, rtsp://, rtmp://)
        // are also rejected here for safety — callers needing those should be
        // explicit, and Navidrome's saved-station path is the wrong place to
        // smuggle arbitrary schemes.
        if (!isHttpUrlScheme(station.streamUrl)) {
          results.push({
            success: false,
            error: `Stream URL for station "${station.name}" must use http:// or https://`
          });
          failedCount++;
          continue;
        }

        logger.debug('Creating radio station:', station);

        // Optional stream validation. validateRadioStream's `client` parameter
        // is currently unused (it makes outbound HTTP calls only) but the
        // signature requires it — pass the existing client, no new auth needed.
        if (params.validateBeforeAdd) {
          const { validateRadioStream } = await import('./radio-validation.js');

          const validationResult = await validateRadioStream(client, {
            url: station.streamUrl,
            timeout: BATCH_VALIDATION_TIMEOUT
          });

          if (!validationResult.success) {
            results.push({
              success: false,
              error: `Stream validation failed for "${station.name}": ${validationResult.errors.join(', ')}`
            });
            failedCount++;
            validationFailedCount++;
            continue;
          }
        }

        // Create the station via Subsonic API. Auth travels in the POST body
        // (via client.subsonicRequest) — never in URL query params where access
        // logs would capture it.
        //
        // Param name pedantry: the Subsonic spec parameter is `homepageUrl`
        // (lowercase 'p'), NOT `homePageUrl` — Navidrome silently drops the
        // mis-cased variant and stores an empty string, which is why every
        // existing station in the wild has an empty homePageUrl even though
        // create_radio_station echoed it back to the caller. The REST `/radio`
        // response field is `homePageUrl` (camelCase 'P'), so input and output
        // capitalisation differ. We accept the camelCase form in our schema for
        // consistency with the output shape but translate to lowercase here.
        const subsonicParams: Record<string, string> = {
          streamUrl: station.streamUrl,
          name: station.name,
        };
        if (station.homePageUrl !== undefined && station.homePageUrl.trim() !== '') {
          subsonicParams['homepageUrl'] = station.homePageUrl;
        }
        await client.subsonicRequest('/createInternetRadioStation', subsonicParams);

        // Successfully created. Subsonic's createInternetRadioStation does not
        // echo back the new id; we resolve the real id below by listing all
        // stations once after the batch and matching on (name, streamUrl).
        // The empty id here is a sentinel — the post-loop lookup either fills
        // it in or logs a warning if the station can't be matched.
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
        successCount++;

      } catch (error) {
        logger.error(`Error creating radio station "${station.name}":`, error);
        // Per-station error inside batch loop: the outer prefix already names
        // the operation, so we keep the raw extracted message rather than
        // double-wrapping with ErrorFormatter.toolExecution.
        results.push({
          success: false,
          error: `Failed to add "${station.name}": ${error instanceof Error ? error.message : 'Unknown error'}`
        });
        failedCount++;
      }
    }

    // We just mutated the station list — drop any cached snapshot so the
    // next listRadioStations/getRadioStation call refetches.
    if (successCount > 0) {
      invalidateRadioStationCache();
    }

    // Resolve the real station IDs for everything we just created. Subsonic's
    // createInternetRadioStation doesn't echo the new id, so without this
    // lookup the response carries empty ids and a follow-up
    // delete_radio_station/get_radio_station call would fail. Single batch
    // call (one extra listRadioStations request regardless of batch size).
    // Match on (name, streamUrl); track assignedIds so that two creates with
    // identical (name, streamUrl) in the same batch each get a distinct id
    // (Navidrome doesn't enforce uniqueness — both would otherwise collide on
    // the lex-max match). Lex-max == newest because Navidrome IDs are monotonic.
    const pendingLookups = results.filter((r): r is CreateRadioStationResponse & { station: RadioStationDTO } =>
      r.success && r.station !== undefined && r.station.id === ''
    );
    if (pendingLookups.length > 0) {
      try {
        // Bypass cache for the post-create lookup — we just mutated Navidrome
        // and need a fresh snapshot to match the new ids. Passing no config
        // skips the cache entirely (rather than using a stale snapshot from
        // before this batch ran).
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
            // No fresh match — either Navidrome dropped the create silently,
            // or another batch entry already claimed every duplicate. Surface
            // this to the LLM via `note` so it knows to re-list rather than
            // call delete_radio_station('') with the empty id.
            result.note = `Created "${result.station.name}" but could not resolve its id. Call list_radio_stations to find it.`;
            logger.warn(
              `Created station "${result.station.name}" but could not find a fresh match in the post-create listing — leaving id empty.`
            );
          }
        }
      } catch (lookupError) {
        // Lookup itself failed — annotate every pending result so the LLM
        // doesn't silently round-trip an empty id into delete/get.
        for (const result of pendingLookups) {
          result.note = `Created "${result.station.name}" but failed to look up its id. Call list_radio_stations to find it.`;
        }
        logger.warn('Failed to resolve created radio station IDs:', lookupError);
      }
    }

    // Generate summary. Plain prose — no emoji, no inline tips. The previous
    // implementation always appended a static "STREAM VALIDATION RECOMMENDED"
    // reminder block for single-station creates, even when validateBeforeAdd
    // had already validated the stream end-to-end. The reminder was both
    // factually wrong (validation had just happened) and visually noisy.
    // It is now omitted entirely: discover_radio_stations validates as part
    // of the discovery surface, and create_radio_station(validateBeforeAdd:true)
    // validates inline — so by the time a row reaches the LLM, validation is
    // either done or was explicitly opted out of by the caller.
    let summary = `Added ${successCount} of ${params.stations.length} station(s).`;
    if (failedCount > 0) {
      summary += ` ${failedCount} failed`;
      if (validationFailedCount > 0) {
        summary += ` (${validationFailedCount} due to validation)`;
      }
      summary += '.';
    }

    // Suppress unused-parameter warning — config remains in the signature for
    // future use (e.g. honoring validation timeouts from config) and for
    // call-site symmetry with discoverRadioStations.
    void config;

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
 * Delete a radio station by ID. The deleted id is intentionally NOT echoed
 * back — the LLM just sent it; success: true is sufficient confirmation.
 * The id surfaces in the DEBUG log line for diagnostics.
 */
export async function deleteRadioStation(
  client: NavidromeClient,
  args: unknown
): Promise<DeleteRadioStationResponse> {
  try {
    const params = RadioStationIdSchema.parse(args);

    logger.debug('Tool deleteRadioStation called with args:', params);

    await client.subsonicRequest('/deleteInternetRadioStation', { id: params.stationId });

    // Drop the cached station snapshot — a subsequent get_radio_station(deleted-id)
    // would otherwise return the stale row and confuse the LLM.
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
 * Get a specific radio station by ID.
 *
 * Subsonic has no "get one" endpoint, so this fetches the full list and
 * filters in memory. The list is cached (see `getStationCache`) so a
 * sequence of getRadioStation calls — or a play_radio_station that goes
 * through this — only hits the network once per `config.cacheTtl` window.
 *
 * `config` is optional so internal callers without one can fall back to
 * an uncached fetch (the post-create id-resolution path).
 */
export async function getRadioStation(
  client: NavidromeClient,
  args: unknown,
  config?: Config
): Promise<RadioStationDTO> {
  try {
    const params = RadioStationIdSchema.parse(args);

    logger.debug('Tool getRadioStation called with args:', params);

    // Since Subsonic API doesn't have a get single station endpoint,
    // we'll get all stations and filter by ID. listRadioStations handles
    // the cache lookup when config is provided.
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

// `station.id` is intentionally NOT echoed — the LLM just sent it. `name`
// and `streamUrl` are server-resolved (the LLM only knew the id) so they
// stay. Without `id`, the response is purely server-derived metadata.
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
