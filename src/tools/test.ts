/**
 * Navidrome MCP Server - Test Tool
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

import type { NavidromeClient } from '../client/navidrome-client.js';
import type { Config } from '../config.js';
import { getPackageVersion } from '../utils/version.js';
import { TestConnectionSchema } from '../schemas/index.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { logger } from '../utils/logger.js';
import { LASTFM_TOOL_NAMES } from './handlers/lastfm-handlers.js';
import { LRCLIB_TOOL_NAMES } from './handlers/lyrics-handlers.js';
import { PLAYBACK_TOOL_NAMES } from './handlers/playback-handlers.js';
import { RADIO_BROWSER_TOOL_NAMES, RADIO_PLAYBACK_TOOL_NAMES } from './handlers/radio-handlers.js';

interface TestConnectionResult {
  success: true;
  message: string;
  serverInfo?: {
    url: string;
    authenticated: boolean;
    timestamp: string;
    version: string;
    features?: {
      lastfm: {
        enabled: boolean;
        description: string;
        tools: string[];
      };
      radioBrowser: {
        enabled: boolean;
        description: string;
        tools: string[];
      };
      lyrics: {
        enabled: boolean;
        description: string;
        tools: string[];
      };
      playback: {
        enabled: boolean;
        description: string;
        tools: string[];
      };
    };
  };
}

export async function testConnection(
  client: NavidromeClient,
  config: Config,
  args: unknown
): Promise<TestConnectionResult> {
  try {
    const params = TestConnectionSchema.parse(args);
    logger.debug('Tool testConnection called with args:', params);

    // Try to make a simple API call to verify authentication using working /song endpoint
    const queryParams = new URLSearchParams({
      _start: '0',
      _end: '1', // Just get 1 song to test connectivity
    });

    await client.request(`/song?${queryParams.toString()}`);

    const result: TestConnectionResult = {
      success: true,
      message: 'Successfully connected to Navidrome server',
    };

    if (params.includeServerInfo) {
      // Use feature flags from config
      const hasLastFm = config.features.lastfm;
      const hasRadioBrowser = config.features.radioBrowser;
      const hasLyrics = config.features.lyrics;
      const hasPlayback = config.features.playback;

      result.serverInfo = {
        url: config.navidromeUrl,
        authenticated: true,
        timestamp: new Date().toISOString(),
        version: getPackageVersion(),
        features: {
          lastfm: {
            enabled: hasLastFm,
            description: hasLastFm
              ? 'Last.fm integration enabled - music discovery and recommendations available'
              : 'Last.fm integration disabled - set features.lastFmApiKey in settings.json (run navidrome-config to edit)',
            tools: hasLastFm ? [...LASTFM_TOOL_NAMES] : []
          },
          radioBrowser: {
            enabled: hasRadioBrowser,
            description: hasRadioBrowser
              ? 'Radio Browser integration enabled - internet radio station discovery available'
              : 'Radio Browser integration disabled - set features.radioBrowserUserAgent in settings.json (run navidrome-config to edit)',
            tools: hasRadioBrowser ? [...RADIO_BROWSER_TOOL_NAMES] : []
          },
          lyrics: {
            enabled: hasLyrics,
            description: hasLyrics
              ? 'Lyrics integration enabled via LRCLIB - synced and unsynced lyrics available'
              : 'Lyrics integration disabled - get_lyrics still reads the lyrics stored in the audio file. Set features.lyricsProvider (lrclib) and features.lrclibUserAgent in settings.json (run navidrome-config to edit)',
            tools: hasLyrics ? [...LRCLIB_TOOL_NAMES] : []
          },
          playback: {
            enabled: hasPlayback,
            description: hasPlayback
              ? 'Local playback enabled - mpv was found, so the play tools drive the local speakers'
              : 'Local playback disabled - mpv was not found. Install mpv or set playback.mpvPath in settings.json (run navidrome-config to edit)',
            tools: hasPlayback ? [...PLAYBACK_TOOL_NAMES, ...RADIO_PLAYBACK_TOOL_NAMES] : []
          }
        }
      };
    }

    return result;
  } catch (error) {
    // A failed check is a tool error, so the agent sees the failure flagged instead of a success-shaped result.
    throw new Error(ErrorFormatter.toolExecution('test_connection', error));
  }
}
