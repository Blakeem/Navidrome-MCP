/**
 * Navidrome MCP Server - Radio Station Tools
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
import type { NavidromeClient } from '../client/navidrome-client.js';
import type {
  RadioStationDTO,
  CreateRadioStationResponse,
  DeleteRadioStationResponse,
  ListRadioStationsResponse,
} from '../types/index.js';
import { CreateRadioStationSchema, RadioStationIdSchema } from '../schemas/index.js';
import { logger } from '../utils/logger.js';
import { getMessageManager } from '../utils/message-manager.js';
import { BATCH_VALIDATION_TIMEOUT_MS } from '../constants/timeouts.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { playbackEngine } from '../services/playback/playback-engine.js';
import { nullIfGoZeroTime } from '../utils/go-time.js';
import { hasControlChars, isHttpUrlScheme } from '../utils/network-safety.js';
import { validateRadioStream } from './radio-validation.js';

/**
 * Completes "Stream URL for station X ...", or null when the URL is fine. A control character gets its own message,
 * since the URL still starts with http:// and the user cannot see the failing character.
 */
function describeUrlProblem(url: string): string | null {
  if (hasControlChars(url)) return 'must not contain line breaks or control characters';
  if (!isHttpUrlScheme(url)) return 'must use http:// or https://';
  return null;
}

// create_radio_station refuses these schemes, but the Navidrome web UI can add a station that uses one.
const WEB_UI_ONLY_STREAM_SCHEMES = ['mms:', 'mmsh:', 'rtsp:', 'rtmp:'];

function isWebUiOnlyStreamUrl(url: string): boolean {
  try {
    return WEB_UI_ONLY_STREAM_SCHEMES.includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

type StationInput = z.infer<typeof CreateRadioStationSchema>['stations'][number];

/**
 * REST /api/radio is used over Subsonic getInternetRadioStations, because Subsonic drops homePageUrl and
 * per-station timestamps. Navidrome emits an empty homePageUrl for an unset one.
 */
interface RestRadioStationRow {
  id: string;
  name: string;
  streamUrl: string;
  homePageUrl?: string;
  createdAt?: string;
  updatedAt?: string;
}

function toRadioStationDTO(row: RestRadioStationRow): RadioStationDTO {
  const stationDto: RadioStationDTO = {
    id: row.id,
    name: row.name,
    streamUrl: row.streamUrl,
    // A Go zero-time timestamp becomes null so the DTO does not show a fake date.
    createdAt: nullIfGoZeroTime(row.createdAt),
    updatedAt: nullIfGoZeroTime(row.updatedAt),
  };

  if (row.homePageUrl !== undefined && row.homePageUrl !== '') {
    stationDto.homePageUrl = row.homePageUrl;
  }

  return stationDto;
}

/** Read fresh on every call, since a station added, edited or deleted in the Navidrome web UI must show at once. */
export async function fetchRadioStations(client: NavidromeClient): Promise<RadioStationDTO[]> {
  // `_end=10000` fetches every station in one round trip. Instances hold hundreds at most.
  const rows = await client.request<RestRadioStationRow[]>('/radio?_start=0&_end=10000');
  return rows.map(toRadioStationDTO);
}

export async function listRadioStations(
  client: NavidromeClient,
  args: unknown,
): Promise<ListRadioStationsResponse> {
  try {
    logger.debug('Tool listRadioStations called with args:', args);

    const stations = await fetchRadioStations(client);
    const tip = getMessageManager().getMessage('radio.list_tip');

    const apiResponse: ListRadioStationsResponse = {
      stations,
      total: stations.length,
    };

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
    const webUiRoute = isWebUiOnlyStreamUrl(station.streamUrl)
      ? '. Add mms://, rtsp:// or rtmp:// stations in the Navidrome web UI instead.'
      : '';
    return `Stream URL for station "${station.name}" ${streamProblem}${webUiRoute}`;
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

// Navidrome radio ids are random, so createdAt orders duplicates. An unknown createdAt counts as the epoch and sorts last.
function createdAtMs(station: RadioStationDTO): number {
  const ms = station.createdAt === null ? Number.NaN : Date.parse(station.createdAt);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Subsonic's create does not echo the id, so one list call resolves the batch by (name, streamUrl), newest
 * createdAt first, assigning each id once since Navidrome allows duplicates. The same listing flags a stream URL
 * that another saved station already uses.
 */
async function resolveCreatedStationIds(
  client: NavidromeClient,
  pendingLookups: CreatedStationResult[],
): Promise<void> {
  try {
    const allStations = await fetchRadioStations(client);
    const assignedIds = new Set<string>();
    for (const result of pendingLookups) {
      const matches = allStations
        .filter(s => s.name === result.station.name && s.streamUrl === result.station.streamUrl)
        .filter(s => !assignedIds.has(s.id))
        .sort((a, b) => createdAtMs(b) - createdAtMs(a));
      const newest = matches[0];
      if (newest !== undefined) {
        result.station.id = newest.id;
        result.station.createdAt = newest.createdAt;
        result.station.updatedAt = newest.updatedAt;
        assignedIds.add(newest.id);
        const sameStream = allStations.find((s) => s.streamUrl === newest.streamUrl && s.id !== newest.id);
        if (sameStream !== undefined) {
          result.note = `Saved station "${sameStream.name}" already uses this stream URL.`;
        }
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

export async function createRadioStation(
  client: NavidromeClient,
  args: unknown
): Promise<{ results: CreateRadioStationResponse[]; summary: string }> {
  try {
    const params = CreateRadioStationSchema.parse(args);

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
            timeout: BATCH_VALIDATION_TIMEOUT_MS
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

        // The empty id and null timestamps are sentinels that resolveCreatedStationIds fills in after the batch.
        const createdStation: RadioStationDTO = {
          id: '',
          name: station.name,
          streamUrl: station.streamUrl,
          createdAt: null,
          updatedAt: null,
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
        // The batch summary already names the operation, so the raw message is not wrapped by ErrorFormatter.
        results.push({
          success: false,
          error: `Failed to add "${station.name}": ${error instanceof Error ? error.message : 'Unknown error'}`
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failedCount = results.length - successCount;

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

/** The deleted id is not echoed back, since the LLM just sent it. */
export async function deleteRadioStation(
  client: NavidromeClient,
  args: unknown
): Promise<DeleteRadioStationResponse> {
  try {
    const params = RadioStationIdSchema.parse(args);

    logger.debug('Tool deleteRadioStation called with args:', params);

    // Navidrome's Subsonic delete answers ok for an id that matches no station.
    const stations = await fetchRadioStations(client);
    if (!stations.some((station) => station.id === params.stationId)) {
      throw new Error(`${ErrorFormatter.notFound('Radio station', params.stationId)}. Call list_radio_stations for current station ids.`);
    }

    await client.subsonicRequest('/deleteInternetRadioStation', { id: params.stationId }, { retryPolicy: 'never' });

    return {
      success: true,
      message: 'Successfully deleted radio station',
    };
  } catch (error) {
    logger.error('Error deleting radio station:', error);
    throw new Error(ErrorFormatter.toolExecution('delete_radio_station', error));
  }
}

export async function getRadioStation(
  client: NavidromeClient,
  args: unknown,
): Promise<RadioStationDTO> {
  try {
    const params = RadioStationIdSchema.parse(args);

    logger.debug('Tool getRadioStation called with args:', params);

    const stations = await fetchRadioStations(client);
    const station = stations.find(s => s.id === params.stationId);

    if (station === undefined) {
      throw new Error(ErrorFormatter.notFound('Radio station', params.stationId));
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
 * Radio replaces the whole play queue, because mpv playlists that mix infinite streams with finite tracks
 * behave unpredictably.
 */
export async function playRadioStation(
  client: NavidromeClient,
  args: unknown,
): Promise<PlayRadioStationResult> {
  try {
    const { stationId } = RadioStationIdSchema.parse(args);

    logger.debug('Tool playRadioStation called with args:', { stationId });

    const station = await getRadioStation(client, { stationId });

    if (typeof station.streamUrl !== 'string' || station.streamUrl.trim() === '') {
      throw new Error(`Radio station "${station.name}" has no stream URL`);
    }

    await playbackEngine.enqueueRadio(station.streamUrl, station.id);

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
