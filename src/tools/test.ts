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

import { z } from 'zod';
import type { NavidromeClient } from '../client/navidrome-client.js';
import type { Config } from '../config.js';

const TestConnectionSchema = z.object({
  includeServerInfo: z.boolean().optional().default(false),
});

export interface TestConnectionResult {
  success: boolean;
  message: string;
  serverInfo?: {
    url: string;
    authenticated: boolean;
    timestamp: string;
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
    };
  };
}

export async function testConnection(
  client: NavidromeClient,
  config: Config,
  args: unknown
): Promise<TestConnectionResult> {
  const params = TestConnectionSchema.parse(args);

  try {
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

      result.serverInfo = {
        url: 'Connected to Navidrome',
        authenticated: true,
        timestamp: new Date().toISOString(),
        features: {
          lastfm: {
            enabled: hasLastFm,
            description: hasLastFm 
              ? 'Last.fm integration enabled - music discovery and recommendations available'
              : 'Last.fm integration disabled - LASTFM_API_KEY not configured',
            tools: hasLastFm 
              ? ['get_similar_artists', 'get_similar_tracks', 'get_artist_info', 'get_top_tracks_by_artist', 'get_trending_music']
              : []
          },
          radioBrowser: {
            enabled: hasRadioBrowser,
            description: hasRadioBrowser
              ? 'Radio Browser integration enabled - internet radio station discovery available'
              : 'Radio Browser integration disabled - RADIO_BROWSER_USER_AGENT not configured',
            tools: hasRadioBrowser
              ? ['discover_radio_stations', 'get_radio_filters', 'get_station_by_uuid', 'click_station', 'vote_station']
              : []
          },
          lyrics: {
            enabled: hasLyrics,
            description: hasLyrics
              ? 'Lyrics integration enabled via LRCLIB - synced and unsynced lyrics available'
              : 'Lyrics integration disabled - LYRICS_PROVIDER and LRCLIB_USER_AGENT must be configured',
            tools: hasLyrics
              ? ['get_lyrics']
              : []
          }
        }
      };
    }

    return result;
  } catch (error) {
    return {
      success: false,
      message: `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
