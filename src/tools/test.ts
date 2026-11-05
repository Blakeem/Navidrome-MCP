/**
 * Navidrome MCP Server - Test Tool
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { z } from 'zod';
import type { NavidromeClient } from '../client/navidrome-client.js';
import type { Config } from '../config.js';
import { getPackageVersion } from '../utils/version.js';
import { TestConnectionSchema } from '../schemas/index.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { logger } from '../utils/logger.js';
import { nullIfGoZeroTime } from '../utils/go-time.js';
import { fetchActiveLibraryCounts } from './library.js';
import { LASTFM_TOOL_NAMES } from './handlers/lastfm-handlers.js';
import { LRCLIB_TOOL_NAMES } from './handlers/lyrics-handlers.js';
import { PLAYBACK_TOOL_NAMES } from './handlers/playback-handlers.js';
import { RADIO_BROWSER_TOOL_NAMES, RADIO_PLAYBACK_TOOL_NAMES } from './handlers/radio-handlers.js';

/** Older Navidrome releases omit the OpenSubsonic fields, so every field is optional. */
const ScanStatusResponseSchema = z.object({
  version: z.string().optional(),
  serverVersion: z.string().optional(),
  openSubsonic: z.boolean().optional(),
  scanStatus: z.object({
    scanning: z.boolean().optional(),
    lastScan: z.string().optional(),
  }).optional(),
});

interface TestConnectionResult {
  success: true;
  message: string;
  navidrome: {
    serverVersion: string | null;
    subsonicApiVersion: string | null;
    openSubsonic: boolean;
    scanning: boolean | null;
    lastScan: string | null;
  };
  /** Covers the active libraries. A count is null when Navidrome did not report it. */
  library: {
    totalSongs: number | null;
    totalAlbums: number | null;
    totalArtists: number | null;
  };
  serverInfo?: {
    url: string;
    authenticated: boolean;
    timestamp: string;
    mcpServerVersion: string;
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

    // REST uses the JWT and Subsonic uses salted-MD5, so each call proves a separate auth path.
    const [library, scanStatusBody] = await Promise.all([
      fetchActiveLibraryCounts(client),
      client.subsonicRequest('/getScanStatus'),
    ]);
    const scanStatus = ScanStatusResponseSchema.parse(scanStatusBody);
    const serverVersion = scanStatus.serverVersion ?? null;

    const result: TestConnectionResult = {
      success: true,
      message: `Connected to Navidrome ${serverVersion ?? '(version not reported)'}. REST and Subsonic authentication both succeeded.`,
      navidrome: {
        serverVersion,
        subsonicApiVersion: scanStatus.version ?? null,
        openSubsonic: scanStatus.openSubsonic ?? false,
        scanning: scanStatus.scanStatus?.scanning ?? null,
        lastScan: nullIfGoZeroTime(scanStatus.scanStatus?.lastScan),
      },
      library,
    };

    if (params.includeServerInfo) {
      const hasLastFm = config.features.lastfm;
      const hasRadioBrowser = config.features.radioBrowser;
      const hasLyrics = config.features.lyrics;
      const hasPlayback = config.features.playback;

      result.serverInfo = {
        url: config.navidromeUrl,
        authenticated: true,
        timestamp: new Date().toISOString(),
        mcpServerVersion: getPackageVersion(),
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
    // A failed check is a tool error, so the agent sees the failure flagged instead of a
    // success-shaped result.
    throw new Error(ErrorFormatter.toolExecution('test_connection', error));
  }
}
