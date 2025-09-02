import crypto from 'crypto';
import type { Config } from '../config.js';
import type { 
  RadioStationDTO, 
  CreateRadioStationRequest, 
  CreateRadioStationResponse,
  DeleteRadioStationResponse,
  ListRadioStationsResponse,
  RadioPlaybackInfo 
} from '../types/dto.js';
import { logger } from '../utils/logger.js';
import { getMessageManager } from '../utils/message-manager.js';
import { BATCH_VALIDATION_TIMEOUT } from '../constants/timeouts.js';

interface SubsonicResponse<T = unknown> {
  'subsonic-response': {
    status: string;
    version: string;
    type?: string;
    serverVersion?: string;
    error?: {
      code: number;
      message: string;
    };
    internetRadioStations?: {
      internetRadioStation?: Array<{
        id: string;
        name: string;
        streamUrl: string;
        homePageUrl?: string;
      }>;
    };
  } & T;
}

function createSubsonicAuth(config: Config): URLSearchParams {
  const salt = crypto.randomBytes(16).toString('hex');
  const token = crypto.createHash('md5').update(config.navidromePassword + salt).digest('hex');
  
  return new URLSearchParams({
    u: config.navidromeUsername,
    t: token,
    s: salt,
    v: '1.16.1',
    c: 'NavidromeMCP',
    f: 'json',
  });
}

/**
 * List all internet radio stations
 */
export async function listRadioStations(
  config: Config, 
  args: unknown
): Promise<ListRadioStationsResponse> {
  try {
    logger.debug('Listing radio stations', args);
    
    const authParams = createSubsonicAuth(config);
    const httpResponse = await fetch(`${config.navidromeUrl}/rest/getInternetRadioStations?${authParams.toString()}`);
    
    if (!httpResponse.ok) {
      throw new Error(`Subsonic API request failed: ${httpResponse.status} ${httpResponse.statusText}`);
    }

    const data = await httpResponse.json() as SubsonicResponse;
    
    if (data['subsonic-response'].status !== 'ok') {
      const errorMsg = data['subsonic-response'].error?.message || 'Unknown error';
      throw new Error(`Subsonic API error: ${errorMsg}`);
    }

    const radioStations = data['subsonic-response'].internetRadioStations?.internetRadioStation || [];
    const stations: RadioStationDTO[] = radioStations.map(station => {
      const stationDto: RadioStationDTO = {
        id: station.id,
        name: station.name,
        streamUrl: station.streamUrl,
        createdAt: new Date().toISOString(), // Subsonic API doesn't provide timestamps
        updatedAt: new Date().toISOString(),
      };
      
      if (station.homePageUrl) {
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
    if (tip) {
      apiResponse.tip = tip;
    }
    
    return apiResponse;
  } catch (error) {
    logger.error('Error listing radio stations:', error);
    throw new Error(`Failed to list radio stations: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Create a new radio station
 */
export async function createRadioStation(
  config: Config, 
  args: unknown
): Promise<CreateRadioStationResponse> {
  try {
    const params = args as CreateRadioStationRequest & { validateBeforeAdd?: boolean };
    
    if (!params.name || !params.streamUrl) {
      throw new Error('Name and streamUrl are required');
    }
    
    logger.debug('Creating radio station:', params);
    
    // If validation is requested, validate the stream first
    if (params.validateBeforeAdd) {
      const { validateRadioStream } = await import('./radio-validation.js');
      const { NavidromeClient } = await import('../client/navidrome-client.js');
      const client = new NavidromeClient(config);
      await client.initialize();
      
      const validationResult = await validateRadioStream(client, {
        url: params.streamUrl,
        timeout: BATCH_VALIDATION_TIMEOUT
      });
      
      if (!validationResult.success) {
        return {
          success: false,
          error: `Stream validation failed: ${validationResult.status}. Station was not added.`,
        };
      }
    }
    
    const authParams = createSubsonicAuth(config);
    authParams.set('streamUrl', params.streamUrl);
    authParams.set('name', params.name);
    if (params.homePageUrl) {
      authParams.set('homePageUrl', params.homePageUrl);
    }
    
    const httpResponse = await fetch(`${config.navidromeUrl}/rest/createInternetRadioStation?${authParams.toString()}`, {
      method: 'POST',
    });
    
    if (!httpResponse.ok) {
      throw new Error(`Subsonic API request failed: ${httpResponse.status} ${httpResponse.statusText}`);
    }

    const data = await httpResponse.json() as SubsonicResponse;
    
    if (data['subsonic-response'].status !== 'ok') {
      const errorMsg = data['subsonic-response'].error?.message || 'Unknown error';
      throw new Error(`Subsonic API error: ${errorMsg}`);
    }
    
    const createdStation: RadioStationDTO = {
      id: 'created', // Subsonic API doesn't return the created station details
      name: params.name,
      streamUrl: params.streamUrl,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    if (params.homePageUrl) {
      createdStation.homePageUrl = params.homePageUrl;
    }

    // Get one-time validation reminder message
    const messageManager = getMessageManager();
    const validationReminder = messageManager.getMessage('radio.validation_reminder');
    
    const apiResponse: CreateRadioStationResponse = {
      success: true,
      station: createdStation,
    };

    // Add validation reminder if this is the first time creating a station
    if (validationReminder) {
      apiResponse.validation_reminder = validationReminder;
    }
    
    return apiResponse;
  } catch (error) {
    logger.error('Error creating radio station:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Delete a radio station by ID
 */
export async function deleteRadioStation(
  config: Config, 
  args: unknown
): Promise<DeleteRadioStationResponse> {
  try {
    const params = args as { id: string };
    
    if (!params.id) {
      throw new Error('Radio station ID is required');
    }
    
    logger.debug('Deleting radio station:', params.id);
    
    const authParams = createSubsonicAuth(config);
    authParams.set('id', params.id);
    
    const httpResponse = await fetch(`${config.navidromeUrl}/rest/deleteInternetRadioStation?${authParams.toString()}`, {
      method: 'POST',
    });
    
    if (!httpResponse.ok) {
      throw new Error(`Subsonic API request failed: ${httpResponse.status} ${httpResponse.statusText}`);
    }

    const data = await httpResponse.json() as SubsonicResponse;
    
    if (data['subsonic-response'].status !== 'ok') {
      const errorMsg = data['subsonic-response'].error?.message || 'Unknown error';
      throw new Error(`Subsonic API error: ${errorMsg}`);
    }
    
    return {
      success: true,
      id: params.id,
    };
  } catch (error) {
    logger.error('Error deleting radio station:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get a specific radio station by ID
 */
export async function getRadioStation(
  config: Config, 
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
    const allStations = await listRadioStations(config, {});
    const station = allStations.stations.find(s => s.id === params.id);
    
    if (!station) {
      throw new Error(`Radio station with ID ${params.id} not found`);
    }
    
    return station;
  } catch (error) {
    logger.error('Error getting radio station:', error);
    throw new Error(`Failed to get radio station: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Play a radio station (sets it in the queue)
 */
export async function playRadioStation(
  config: Config, 
  args: unknown
): Promise<{ success: boolean; message: string; station?: RadioStationDTO }> {
  try {
    const params = args as { id: string };
    
    if (!params.id) {
      throw new Error('Radio station ID is required');
    }
    
    logger.debug('Playing radio station:', params.id);
    
    // First get the station details
    const station = await getRadioStation(config, params);
    
    // Note: The actual playback implementation would require additional Subsonic API calls
    // to set up playback. For now, we'll return success with the station info.
    // In a full implementation, this might involve:
    // 1. Calling setQueue to set up radio playback
    // 2. Using stream endpoint to start playing
    
    return {
      success: true,
      message: `Radio station "${station.name}" is ready to play. Stream URL: ${station.streamUrl}`,
      station,
    };
  } catch (error) {
    logger.error('Error playing radio station:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Batch create multiple radio stations
 */
export async function batchCreateRadioStations(
  config: Config,
  args: unknown
): Promise<{ results: CreateRadioStationResponse[]; summary: string }> {
  const params = args as {
    stations: CreateRadioStationRequest[];
    validateBeforeAdd?: boolean;
  };
  
  if (!params.stations || !Array.isArray(params.stations)) {
    throw new Error('Stations array is required');
  }
  
  if (params.stations.length === 0) {
    throw new Error('At least one station must be provided');
  }
  
  logger.debug(`Batch creating ${params.stations.length} radio stations`);
  
  const results: CreateRadioStationResponse[] = [];
  let successCount = 0;
  let failedCount = 0;
  let validationFailedCount = 0;
  
  for (const station of params.stations) {
    try {
      const result = await createRadioStation(config, {
        ...station,
        validateBeforeAdd: params.validateBeforeAdd
      });
      
      results.push(result);
      
      if (result.success) {
        successCount++;
      } else {
        failedCount++;
        if (result.error?.includes('validation failed')) {
          validationFailedCount++;
        }
      }
    } catch (error) {
      results.push({
        success: false,
        error: `Failed to add ${station.name}: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
      failedCount++;
    }
  }
  
  let summary = `Added ${successCount} of ${params.stations.length} stations.`;
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
}

/**
 * Get current radio playback information
 */
export async function getCurrentRadioInfo(
  _config: Config, 
  _args: unknown
): Promise<RadioPlaybackInfo> {
  try {
    logger.debug('Getting current radio info');
    
    // Note: This implementation depends on Navidrome's current playback status API
    // The Subsonic API has getNowPlaying but it's for regular tracks, not radio streams
    // This is a placeholder implementation that would need to be adjusted based on
    // the actual Navidrome radio status endpoints
    
    // For now, we'll return a basic response indicating no radio is currently playing
    // In a real implementation, this would query the current playback status
    
    return {
      playing: false,
      metadata: {
        description: 'Radio playback status not available - use getNowPlaying for regular track status',
      },
    };
  } catch (error) {
    logger.error('Error getting current radio info:', error);
    return {
      playing: false,
      metadata: {
        description: `Error getting radio info: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
    };
  }
}