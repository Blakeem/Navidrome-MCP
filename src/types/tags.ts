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

/** One tag value with its usage counts. Rows sit under the tagName of the response that holds them. */
export interface TagDTO {
  /** Tag value */
  tagValue: string;
  /** Number of albums with this tag */
  albumCount: number;
  /** Number of songs with this tag */
  songCount: number;
}


/**
 * Tag distribution analysis for a specific tag name
 */
export interface TagDistribution {
  /** Tag name being analyzed */
  tagName: string;
  /** Library-wide count of distinct values for this tag name */
  uniqueValues: number;
  /** Total songs across the `distribution` slice */
  totalSongs: number;
  /** Total albums across the `distribution` slice */
  totalAlbums: number;
  /** Surfaced values sorted by song count, capped at distributionLimit. See `sampled`. */
  distribution: TagDTO[];
  /**
   * True when the slice is alphabetical rather than a top-N by count.
   * Set when a non-genre tag name has more values than the page.
   */
  sampled?: boolean;
  /** True when some counts failed to load and read as 0. */
  countsIncomplete?: boolean;
}

/**
 * Response format for tag distribution analysis
 */
export interface TagDistributionResponse {
  /** Array of tag distributions by name */
  distributions: TagDistribution[];
  /** Requested tag names with no values in the active libraries. Omitted when every name has values. */
  emptyTagNames?: string[];
}
