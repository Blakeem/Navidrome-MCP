/**
 * Navidrome MCP Server - Tags Data Transfer Objects
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/** Carries no tagName, since each row sits under the tagName of its response. */
export interface TagDTO {
  tagValue: string;
  albumCount: number;
  songCount: number;
}


export interface TagDistribution {
  tagName: string;
  /** Distinct values across the active libraries, not only the `distribution` slice. */
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

export interface TagDistributionResponse {
  distributions: TagDistribution[];
  /** Requested tag names with no values in the active libraries. Omitted when every name has
   *  values. */
  emptyTagNames?: string[];
}
