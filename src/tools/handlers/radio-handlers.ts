/**
 * Navidrome MCP Server - Radio Tool Handlers
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

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { NavidromeClient } from '../../client/navidrome-client.js';
import type { Config } from '../../config.js';
import type { ToolCategory } from './registry.js';
import { DEFAULT_VALUES } from '../../constants/defaults.js';
import { ErrorFormatter } from '../../utils/error-formatter.js';

// Import tool functions
import {
  listRadioStations,
  createRadioStation,
  deleteRadioStation,
  getRadioStation,
  playRadioStation,
} from '../radio.js';
import { validateRadioStream } from '../radio-validation.js';
import {
  discoverRadioStations,
  getRadioFilters,
  getStationByUuid,
  clickStation,
  voteStation,
} from '../radio-discovery.js';

// Helper function to get radio tools based on config
function getRadioTools(config: Config): Tool[] {
  const baseTools: Tool[] = [
    {
      name: 'list_radio_stations',
      description: 'List all internet radio stations from Navidrome',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'create_radio_station',
      description: 'Create one or more radio stations. Always provide stations as a JSON array - use a single-item array for one station. Each station requires name and streamUrl, with optional homePageUrl.',
      inputSchema: {
        type: 'object',
        properties: {
          stations: {
            type: 'array',
            description: 'Array of radio stations to create. For a single station, use: [{"name": "Station Name", "streamUrl": "http://stream.url"}]. For multiple stations, add more objects to the array.',
            minItems: 1,
            items: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Station name (required)',
                  minLength: 1,
                },
                streamUrl: {
                  type: 'string',
                  description: 'Stream URL (required) - must be valid HTTP/HTTPS URL',
                  pattern: '^https?://.+',
                },
                homePageUrl: {
                  type: 'string',
                  description: 'Optional homepage URL for the station',
                  pattern: '^https?://.+',
                },
              },
              required: ['name', 'streamUrl'],
              additionalProperties: false,
            },
          },
          validateBeforeAdd: {
            type: 'boolean',
            description: 'Test stream URLs before adding to ensure they work (default: false). Recommended for unknown streams.',
            default: false,
          },
        },
        required: ['stations'],
        additionalProperties: false,
      },
    },
    {
      name: 'delete_radio_station',
      description: 'Delete an internet radio station by ID',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The unique ID of the radio station to delete',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'get_radio_station',
      description: 'Get detailed information about a specific radio station by ID',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The unique ID of the radio station',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'validate_radio_stream',
      description: 'Tests if an HTTP/HTTPS radio stream URL is valid, accessible, and streams audio content. Checks HTTP response, content type, streaming headers, and samples a small audio chunk. Note: this tool can only probe http:// and https:// URLs — other valid radio protocols (mms://, rtsp://, rtmp://) play fine through play_radio_station but cannot be validated here. Redirects to private/loopback addresses are refused.',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            format: 'uri',
            description: 'The radio stream URL to validate (http:// or https:// only)',
          },
          timeout: {
            type: 'number',
            description: 'Timeout in milliseconds (default: 8000, max: 30000)',
            minimum: 1000,
            maximum: 30000,
            default: 8000,
          },
          followRedirects: {
            type: 'boolean',
            description: 'Follow HTTP redirects (default: true)',
            default: true,
          },
        },
        required: ['url'],
      },
    },
  ];

  // Only expose play_radio_station when local playback (mpv) is available.
  // Without mpv the engine never gets configured and the call would fail with
  // an internal error — hiding the tool keeps parity with the other mpv tools.
  if (config.features.playback) {
    baseTools.push({
      name: 'play_radio_station',
      description: 'Play a radio station through the local mpv speakers (requires mpv on the host). Replaces the entire live play queue with this single radio stream — radio is mutually exclusive with songs/albums in the play queue, matching Navidrome\'s web UI convention. Use `now_playing` to see the currently-playing station name and ICY metadata.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The unique ID of the radio station to play',
          },
        },
        required: ['id'],
      },
    });
  }

  // Add radio discovery tools if Radio Browser is enabled
  if (config.features.radioBrowser) {
    baseTools.push(
      {
        name: 'discover_radio_stations',
        description: 'Discover internet radio stations worldwide via Radio Browser API. Search by genre/tag, country, language, quality, and more. Returns validated streams with metadata, sorted by popularity by default.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query for station names (e.g., "BBC", "Classic FM", "Jazz FM")',
            },
            tag: {
              type: 'string',
              description: 'Filter by music genre/tag (e.g., "jazz", "rock", "classical", "electronic", "hip-hop", "country", "reggae", "latin")',
            },
            countryCode: {
              type: 'string',
              description: 'ISO 2-letter country code (e.g., "US"=United States, "GB"=United Kingdom, "FR"=France, "DE"=Germany, "JP"=Japan, "AU"=Australia)',
            },
            language: {
              type: 'string',
              description: 'Broadcast language (e.g., "english", "spanish", "french", "german", "japanese", "portuguese", "italian")',
            },
            codec: {
              type: 'string',
              description: 'Audio codec preference (e.g., "MP3" for best compatibility, "AAC" for better quality, "OGG" for open standard)',
            },
            bitrateMin: {
              type: 'number',
              description: 'Minimum audio quality in kbps (e.g., 128 for standard quality, 256 for high quality, 320 for maximum quality)',
              minimum: 0,
            },
            isHttps: {
              type: 'boolean',
              description: 'Require secure HTTPS streams (recommended for security)',
            },
            order: {
              type: 'string',
              description: 'Sort results by: "votes"=popularity, "name"=alphabetical, "clickcount"=most played, "bitrate"=quality, "lastcheckok"=reliability, "random"=shuffle',
              enum: ['name', 'votes', 'clickcount', 'bitrate', 'lastcheckok', 'random'],
              default: 'votes',
            },
            reverse: {
              type: 'boolean',
              description: 'Reverse sort order (true=descending/best first, false=ascending)',
              default: true,
            },
            offset: {
              type: 'number',
              description: 'Skip first N results for pagination',
              minimum: 0,
            },
            limit: {
              type: 'number',
              description: 'Maximum number of stations to return (15=quick discovery, 50=extensive search, 500=maximum)',
              minimum: 1,
              maximum: 500,
              default: DEFAULT_VALUES.RADIO_DISCOVERY_LIMIT,
            },
            hideBroken: {
              type: 'boolean',
              description: 'Hide stations that failed recent connectivity checks (recommended: true)',
              default: true,
            },
          },
        },
      },
      {
        name: 'get_radio_filters',
        description: 'Get available filter options for radio station discovery (tags, countries, languages, codecs)',
        inputSchema: {
          type: 'object',
          properties: {
            kinds: {
              type: 'array',
              description: 'Filter types to retrieve',
              items: {
                type: 'string',
                enum: ['tags', 'countries', 'languages', 'codecs'],
              },
              default: ['tags', 'countries', 'languages', 'codecs'],
            },
          },
        },
      },
      {
        name: 'get_station_by_uuid',
        description: 'Get detailed information about a specific radio station by its UUID',
        inputSchema: {
          type: 'object',
          properties: {
            stationUuid: {
              type: 'string',
              description: 'The unique UUID of the radio station',
            },
          },
          required: ['stationUuid'],
        },
      },
      {
        name: 'click_station',
        description: 'Register a play click for a radio station (helps with popularity metrics). Call this when starting playback.',
        inputSchema: {
          type: 'object',
          properties: {
            stationUuid: {
              type: 'string',
              description: 'The unique UUID of the radio station',
            },
          },
          required: ['stationUuid'],
        },
      },
      {
        name: 'vote_station',
        description: 'Vote for a radio station to increase its popularity',
        inputSchema: {
          type: 'object',
          properties: {
            stationUuid: {
              type: 'string',
              description: 'The unique UUID of the radio station',
            },
          },
          required: ['stationUuid'],
        },
      }
    );
  }

  return baseTools;
}

// Factory function for creating radio tool category with dependencies  
export function createRadioToolCategory(client: NavidromeClient, config: Config): ToolCategory {
  return {
    tools: getRadioTools(config),
    async handleToolCall(name: string, args: unknown): Promise<unknown> {
      switch (name) {
        case 'list_radio_stations':
          return await listRadioStations(client, args);
        case 'create_radio_station':
          return await createRadioStation(client, config, args);
        case 'delete_radio_station':
          return await deleteRadioStation(client, args);
        case 'get_radio_station':
          return await getRadioStation(client, args);
        case 'play_radio_station':
          return await playRadioStation(client, args);
        case 'validate_radio_stream':
          return await validateRadioStream(client, args);
        case 'discover_radio_stations':
          return await discoverRadioStations(config, client, args);
        case 'get_radio_filters':
          return await getRadioFilters(config, args);
        case 'get_station_by_uuid':
          return await getStationByUuid(config, args);
        case 'click_station':
          return await clickStation(config, args);
        case 'vote_station':
          return await voteStation(config, args);
        default:
          throw new Error(ErrorFormatter.toolUnknown(`radio ${name}`));
      }
    }
  };
}