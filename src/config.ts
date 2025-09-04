/**
 * Navidrome MCP Server - Configuration Management
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
import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ErrorFormatter } from './utils/error-formatter.js';
import { logger } from './utils/logger.js';

// Safely load dotenv - it's optional since environment variables
// can be provided directly (e.g., by Claude MCP configuration)
try {
  // Try to load from the project root directory
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const projectRoot = join(__dirname, '..');
  
  loadDotenv({ 
    path: join(projectRoot, '.env'),
    // Don't override existing environment variables
    override: false 
  });
} catch (error) {
  // Silently ignore dotenv errors - environment variables may be
  // provided by the MCP host (Claude) directly
  if (process.env['DEBUG'] === 'true') {
    logger.warn('Could not load .env file (this is normal when running as MCP server):', error);
  }
}

const ConfigSchema = z.object({
  navidromeUrl: z.string().url('NAVIDROME_URL must be a valid URL'),
  navidromeUsername: z.string().min(1, 'NAVIDROME_USERNAME is required'),
  navidromePassword: z.string().min(1, 'NAVIDROME_PASSWORD is required'),
  debug: z.boolean().default(false),
  cacheTtl: z.number().positive().default(300),
  tokenExpiry: z.number().positive().default(86400), // Default 24 hours in seconds
  
  // Feature Configuration
  features: z.object({
    lastfm: z.boolean().default(false),
    radioBrowser: z.boolean().default(false),
    lyrics: z.boolean().default(false),
  }),

  // API Keys and External Service Configuration
  lastFmApiKey: z.string().optional(),
  radioBrowserUserAgent: z.string().optional(),
  radioBrowserBase: z.string().url().default('https://de1.api.radio-browser.info'),
  
  // Lyrics Configuration
  lyricsProvider: z.string().optional(),
  lrclibUserAgent: z.string().optional(),
  lrclibBase: z.string().url().default('https://lrclib.net'),
});

export type Config = z.infer<typeof ConfigSchema>;

export async function loadConfig(): Promise<Config> {
  // Try to safely load .env file only in development mode
  // MCP servers get their environment from the host application
  if (!process.env['NAVIDROME_URL']) {
    // Only attempt to load .env if we're missing required environment variables
    // This suggests we're in development mode
    try {
      // Use import.meta.url to get absolute path, avoiding process.cwd() entirely
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const projectRoot = join(__dirname, '..');
      const envPath = join(projectRoot, '.env');
      
      // Check if we can actually access the file system
      // This will fail gracefully if we can't
      loadDotenv({ 
        path: envPath,
        // Don't override existing environment variables
        override: false 
      });
    } catch {
      // Silently ignore dotenv errors - environment variables should be
      // provided by the MCP host (Claude Desktop) directly
      if (process.env['DEBUG'] === 'true') {
        logger.warn('Could not load .env file (this is expected when running as MCP server)');
      }
    }
  }

  // Centralized environment variable access
  const lastFmApiKey = process.env['LASTFM_API_KEY'] || undefined;
  const radioBrowserUserAgent = process.env['RADIO_BROWSER_USER_AGENT'] || undefined;
  const lyricsProvider = process.env['LYRICS_PROVIDER'] || undefined;
  const lrclibUserAgent = process.env['LRCLIB_USER_AGENT'] || undefined;

  const rawConfig = {
    navidromeUrl: process.env['NAVIDROME_URL'],
    navidromeUsername: process.env['NAVIDROME_USERNAME'],
    navidromePassword: process.env['NAVIDROME_PASSWORD'],
    debug: process.env['DEBUG'] === 'true',
    cacheTtl: process.env['CACHE_TTL'] ? parseInt(process.env['CACHE_TTL'], 10) : 300,
    tokenExpiry: process.env['TOKEN_EXPIRY'] ? parseInt(process.env['TOKEN_EXPIRY'], 10) : 86400,
    
    // Feature detection based on available configuration
    features: {
      lastfm: !!(lastFmApiKey && lastFmApiKey.trim()),
      radioBrowser: !!(radioBrowserUserAgent && radioBrowserUserAgent.trim()),
      lyrics: !!(lyricsProvider && lyricsProvider.trim() && lrclibUserAgent && lrclibUserAgent.trim()),
    },

    // API Keys and External Service Configuration
    lastFmApiKey,
    radioBrowserUserAgent,
    radioBrowserBase: process.env['RADIO_BROWSER_BASE'] || 'https://de1.api.radio-browser.info',
    
    // Lyrics Configuration
    lyricsProvider,
    lrclibUserAgent,
    lrclibBase: process.env['LRCLIB_BASE'] || 'https://lrclib.net',
  };

  try {
    return ConfigSchema.parse(rawConfig);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.issues.map((e) => `${e.path.join('.')}: ${e.message}`);
      throw new Error(ErrorFormatter.configValidation(messages));
    }
    throw error;
  }
}
