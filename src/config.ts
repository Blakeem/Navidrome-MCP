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

loadDotenv();

const ConfigSchema = z.object({
  navidromeUrl: z.string().url('NAVIDROME_URL must be a valid URL'),
  username: z.string().min(1, 'NAVIDROME_USERNAME is required'),
  password: z.string().min(1, 'NAVIDROME_PASSWORD is required'),
  debug: z.boolean().default(false),
  cacheTtl: z.number().positive().default(300),
  tokenExpiry: z.number().positive().default(86400), // Default 24 hours in seconds
});

export type Config = z.infer<typeof ConfigSchema>;

export async function loadConfig(): Promise<Config> {
  const rawConfig = {
    navidromeUrl: process.env['NAVIDROME_URL'],
    username: process.env['NAVIDROME_USERNAME'],
    password: process.env['NAVIDROME_PASSWORD'],
    debug: process.env['DEBUG'] === 'true',
    cacheTtl: process.env['CACHE_TTL'] ? parseInt(process.env['CACHE_TTL'], 10) : 300,
    tokenExpiry: process.env['TOKEN_EXPIRY'] ? parseInt(process.env['TOKEN_EXPIRY'], 10) : 86400,
  };

  try {
    return ConfigSchema.parse(rawConfig);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.issues.map((e) => `${e.path.join('.')}: ${e.message}`);
      throw new Error(`Configuration validation failed:\n${messages.join('\n')}`);
    }
    throw error;
  }
}
