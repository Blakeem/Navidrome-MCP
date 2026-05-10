import type { Config } from '../config.js';
import type { NavidromeClient } from '../client/navidrome-client.js';
import type {
  RadioStationDTO,
  CreateRadioStationRequest,
  CreateRadioStationResponse,
  DeleteRadioStationResponse,
  ListRadioStationsResponse,
} from '../types/index.js';
import { logger } from '../utils/logger.js';
import { getMessageManager } from '../utils/message-manager.js';
import { BATCH_VALIDATION_TIMEOUT } from '../constants/timeouts.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { playbackEngine } from '../services/playback/playback-engine.js';

interface InternetRadioStationsResponse {
  internetRadioStations?: {
    internetRadioStation?: Array<{
      id: string;
      name: string;
      streamUrl: string;
      homePageUrl?: string;
    }>;
  };
}

/**
 * List all internet radio stations
 */
export async function listRadioStations(
  client: NavidromeClient,
  args: unknown
): Promise<ListRadioStationsResponse> {
  try {
    logger.debug('Listing radio stations', args);

    const response = await client.subsonicRequest('/getInternetRadioStations') as InternetRadioStationsResponse;
    const radioStations = response.internetRadioStations?.internetRadioStation ?? [];

    const stations: RadioStationDTO[] = radioStations.map(station => {
      const stationDto: RadioStationDTO = {
        id: station.id,
        name: station.name,
        streamUrl: station.streamUrl,
        createdAt: new Date().toISOString(), // Subsonic API doesn't provide timestamps
        updatedAt: new Date().toISOString(),
      };

      if (station.homePageUrl !== null && station.homePageUrl !== undefined && station.homePageUrl !== '') {
        stationDto.homePageUrl = station.homePageUrl;
      }

      return stationDto;
    });

    // Get one-time message for radio list tip
    const messageManager = getMessageManager();
    const tip = messageManager.getMessage('radio.list_tip');

    const apiResponse: ListRadioStationsResponse = {
      stations,
      total: stations.length,
    };

    // Add tip if this is the first time showing the list
    if (tip !== null && tip !== undefined && tip !== '') {
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
  const params = args as {
    stations: CreateRadioStationRequest[];
    validateBeforeAdd?: boolean;
  };

  // Validate input
  if (params.stations === null || params.stations === undefined || !Array.isArray(params.stations)) {
    throw new Error('Provide stations array. Example: {"stations": [{"name": "Station Name", "streamUrl": "http://stream.url"}]}');
  }

  if (params.stations.length === 0) {
    throw new Error('At least one station must be provided in the stations array');
  }

  logger.debug(`Creating ${params.stations.length} radio station(s)`);

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

      logger.debug('Creating radio station:', station);

      // Optional stream validation. validateRadioStream's `client` parameter
      // is currently unused (it makes outbound HTTP calls only) but the
      // signature requires it — pass the existing client, no new auth needed.
      if (params.validateBeforeAdd === true) {
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
      const subsonicParams: Record<string, string> = {
        streamUrl: station.streamUrl,
        name: station.name,
      };
      if (station.homePageUrl !== null && station.homePageUrl !== undefined && station.homePageUrl.trim() !== '') {
        subsonicParams['homePageUrl'] = station.homePageUrl;
      }
      await client.subsonicRequest('/createInternetRadioStation', subsonicParams);

      // Successfully created
      const createdStation: RadioStationDTO = {
        id: 'created', // Subsonic API doesn't return the created station details
        name: station.name,
        streamUrl: station.streamUrl,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      if (station.homePageUrl !== null && station.homePageUrl !== undefined && station.homePageUrl.trim() !== '') {
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

  // Generate summary
  let summary = `Added ${successCount} of ${params.stations.length} station(s).`;
  if (failedCount > 0) {
    summary += ` ${failedCount} failed`;
    if (validationFailedCount > 0) {
      summary += ` (${validationFailedCount} due to validation)`;
    }
    summary += '.';
  }

  // Add validation reminder for first-time users (single station only)
  if (successCount > 0 && params.stations.length === 1) {
    const messageManager = getMessageManager();
    const validationReminder = messageManager.getMessage('radio.validation_reminder');
    if (validationReminder !== null && validationReminder !== undefined && validationReminder !== '') {
      summary += ` ${validationReminder}`;
    }
  }

  // Suppress unused-parameter warning — config remains in the signature for
  // future use (e.g. honoring validation timeouts from config) and for
  // call-site symmetry with discoverRadioStations.
  void config;

  return {
    results,
    summary
  };
}

/**
 * Delete a radio station by ID
 */
export async function deleteRadioStation(
  client: NavidromeClient,
  args: unknown
): Promise<DeleteRadioStationResponse> {
  try {
    const params = args as { id: string };

    if (!params.id) {
      throw new Error('Radio station ID is required');
    }

    logger.debug('Deleting radio station:', params.id);

    await client.subsonicRequest('/deleteInternetRadioStation', { id: params.id });

    return {
      success: true,
      id: params.id,
    };
  } catch (error) {
    logger.error('Error deleting radio station:', error);
    throw new Error(ErrorFormatter.toolExecution('delete_radio_station', error));
  }
}

/**
 * Get a specific radio station by ID
 */
export async function getRadioStation(
  client: NavidromeClient,
  args: unknown
): Promise<RadioStationDTO> {
  try {
    const params = args as { id: string };

    if (!params.id) {
      throw new Error('Radio station ID is required');
    }

    logger.debug('Getting radio station:', params.id);

    // Since Subsonic API doesn't have a get single station endpoint,
    // we'll get all stations and filter by ID
    const allStations = await listRadioStations(client, {});
    const station = allStations.stations.find(s => s.id === params.id);

    if (!station) {
      throw new Error(`Radio station with ID ${params.id} not found`);
    }

    return station;
  } catch (error) {
    logger.error('Error getting radio station:', error);
    throw new Error(ErrorFormatter.toolExecution('get_radio_station', error));
  }
}

interface PlayRadioStationResult {
  success: true;
  station: {
    id: string;
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
  args: unknown
): Promise<PlayRadioStationResult> {
  try {
    const params = args as { id?: unknown };
    const id = typeof params.id === 'string' ? params.id : '';

    if (id === '') {
      throw new Error('Radio station ID is required');
    }

    logger.debug('Playing radio station:', id);

    const station = await getRadioStation(client, { id });

    if (typeof station.streamUrl !== 'string' || station.streamUrl.trim() === '') {
      throw new Error(`Radio station "${station.name}" has no stream URL`);
    }

    await playbackEngine.enqueueRadio(station.streamUrl, station.name);

    return {
      success: true,
      station: {
        id: station.id,
        name: station.name,
        streamUrl: station.streamUrl,
      },
    };
  } catch (error) {
    logger.error('Error playing radio station:', error);
    throw new Error(ErrorFormatter.toolExecution('play_radio_station', error));
  }
}
