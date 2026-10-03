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
import {
  MAX_VALIDATION_TIMEOUT,
  MIN_VALIDATION_TIMEOUT,
  SINGLE_VALIDATION_TIMEOUT,
} from '../../constants/timeouts.js';
import { ErrorFormatter } from '../../utils/error-formatter.js';
import { respawnWebForPlay } from './respawn-on-play.js';

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

const BASE_RADIO_TOOLS: Tool[] = [
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
                pattern: '^https?://.+$',
              },
              homePageUrl: {
                type: 'string',
                description: 'Optional homepage URL for the station',
                pattern: '^https?://.+$',
              },
            },
            required: ['name', 'streamUrl'],
            additionalProperties: false,
          },
        },
        validateBeforeAdd: {
          type: 'boolean',
          description: 'Test stream URLs before adding to ensure they work (default: false). Recommended for unknown streams. Streams on private or LAN addresses always fail validation, so leave this false for them.',
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
        stationId: {
          type: 'string',
          minLength: 1,
          description: 'The Navidrome saved-station ID, as returned by `list_radio_stations`.',
        },
      },
      required: ['stationId'],
    },
  },
  {
    name: 'get_radio_station',
    description: 'Get detailed information about a specific radio station by ID',
    inputSchema: {
      type: 'object',
      properties: {
        stationId: {
          type: 'string',
          minLength: 1,
          description: 'The Navidrome saved-station ID, as returned by `list_radio_stations`.',
        },
      },
      required: ['stationId'],
    },
  },
  {
    name: 'validate_radio_stream',
    description: 'Tests if an HTTP/HTTPS radio stream URL is valid, accessible, and streams audio content. Checks HTTP response, content type, streaming headers, and samples a small audio chunk. This validator probes only http:// and https:// URLs. An mms://, rtsp:// or rtmp:// station must first be added in the Navidrome web UI, and play_radio_station then plays it by stationId. URLs and redirect targets that resolve to private, loopback or link-local addresses are refused, so only publicly reachable streams can be validated.',
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
          description: `Timeout in milliseconds (default: ${SINGLE_VALIDATION_TIMEOUT}, max: ${MAX_VALIDATION_TIMEOUT})`,
          minimum: MIN_VALIDATION_TIMEOUT,
          maximum: MAX_VALIDATION_TIMEOUT,
          default: SINGLE_VALIDATION_TIMEOUT,
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

const PLAY_RADIO_STATION_TOOL: Tool = {
  name: 'play_radio_station',
  description: 'Play a radio station through the local mpv speakers (requires mpv on the host). Replaces the entire live play queue with this single radio stream. Radio is mutually exclusive with songs/albums in the play queue, matching Navidrome\'s web UI convention. Use `now_playing` to see the currently-playing station name and ICY metadata.',
  inputSchema: {
    type: 'object',
    properties: {
      stationId: {
        type: 'string',
        description: 'The Navidrome saved-station ID, as returned by `list_radio_stations`.',
      },
    },
    required: ['stationId'],
  },
};

const RADIO_BROWSER_TOOLS: Tool[] = [
  {
    name: 'discover_radio_stations',
    description: `Discover internet radio stations worldwide via Radio Browser API. Search by genre/tag, country, language, quality, and more. The first ${DEFAULT_VALUES.RADIO_DISCOVERY_PROBE_COUNT} results get a quick best-effort probe with a per-station verdict (OK or FAIL). Later results are unprobed. Sorted by popularity by default. Each station's streamUrl and homePageUrl feed create_radio_station unchanged.`,
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
          description: 'Broadcast language as a language name, as listed by get_radio_filters (e.g., "english", "spanish", "french", "german", "japanese", "portuguese", "italian"). ISO codes such as "en" do not work.',
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
          description: 'Reverse sort order (true=descending/best first, false=ascending). Omitted means false for "name" (A to Z) and true for every other order (highest first).',
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
    description: 'Get detailed information about a specific radio station by its UUID. Its streamUrl and homePageUrl feed create_radio_station unchanged.',
    inputSchema: {
      type: 'object',
      properties: {
        stationUuid: {
          type: 'string',
          minLength: 1,
          description: 'The unique UUID of the radio station',
        },
      },
      required: ['stationUuid'],
    },
  },
  {
    name: 'click_station',
    description: 'Register a play click for a radio station (helps with popularity metrics). Call this when starting playback. Returns the canonical streamUrl of the station.',
    inputSchema: {
      type: 'object',
      properties: {
        stationUuid: {
          type: 'string',
          minLength: 1,
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
          minLength: 1,
          description: 'The unique UUID of the radio station',
        },
      },
      required: ['stationUuid'],
    },
  },
];

export const RADIO_PLAYBACK_TOOL_NAMES = [PLAY_RADIO_STATION_TOOL.name];
export const RADIO_BROWSER_TOOL_NAMES = RADIO_BROWSER_TOOLS.map((tool) => tool.name);

// Helper function to get radio tools based on config
function getRadioTools(config: Config): Tool[] {
  const tools: Tool[] = [...BASE_RADIO_TOOLS];

  // Without mpv the engine never gets configured, so the call would fail with an internal error.
  if (config.features.playback) {
    tools.push(PLAY_RADIO_STATION_TOOL);
  }

  if (config.features.radioBrowser) {
    tools.push(...RADIO_BROWSER_TOOLS);
  }

  return tools;
}

// Factory function for creating radio tool category with dependencies
export function createRadioToolCategory(client: NavidromeClient, config: Config): ToolCategory {
  return {
    tools: getRadioTools(config),
    async handleToolCall(name: string, args: unknown): Promise<unknown> {
      switch (name) {
        case 'list_radio_stations':
          return await listRadioStations(client, args, config);
        case 'create_radio_station':
          return await createRadioStation(client, args);
        case 'delete_radio_station':
          return await deleteRadioStation(client, args);
        case 'get_radio_station':
          return await getRadioStation(client, args, config);
        case 'play_radio_station':
          await respawnWebForPlay(config);
          return await playRadioStation(client, args, config);
        case 'validate_radio_stream':
          return await validateRadioStream(args);
        case 'discover_radio_stations':
          return await discoverRadioStations(config, args);
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
