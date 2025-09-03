/**
 * Navidrome MCP Server - Tags Data Transfer Objects
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

/**
 * Clean DTO for tags, representing metadata key-value pairs
 */
export interface TagDTO {
  /** Unique tag ID */
  id: string;
  /** Tag name (e.g., "genre", "composer", "label") */
  tagName: string;
  /** Tag value */
  tagValue: string;
  /** Number of albums with this tag */
  albumCount: number;
  /** Number of songs with this tag */
  songCount: number;
}

/**
 * Response format for listing tags with pagination
 */
export interface ListTagsResponse {
  /** Array of tags */
  tags: TagDTO[];
  /** Total number of tags available */
  total: number;
  /** Pagination offset used */
  offset: number;
  /** Pagination limit used */
  limit: number;
}

/**
 * Tag distribution analysis for a specific tag name
 */
export interface TagDistribution {
  /** Tag name being analyzed */
  tagName: string;
  /** Number of unique values for this tag name */
  uniqueValues: number;
  /** Total songs across all values */
  totalSongs: number;
  /** Total albums across all values */
  totalAlbums: number;
  /** Most common tag value */
  mostCommon: TagDTO;
  /** Distribution of values (sorted by usage) */
  distribution: TagDTO[];
}

/**
 * Response format for tag distribution analysis
 */
export interface TagDistributionResponse {
  /** Array of tag distributions by name */
  distributions: TagDistribution[];
  /** Total unique tag names */
  totalTagNames: number;
}