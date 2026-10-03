/**
 * Navidrome MCP Server - Radio Data Transfer Objects
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

/** Radio station from Navidrome API */
export interface RadioStationDTO {
  /** Unique radio station ID */
  id: string;
  /** Stream URL for the radio station */
  streamUrl: string;
  /** Station name/title */
  name: string;
  /** Optional homepage URL */
  homePageUrl?: string;
  /** ISO 8601 creation time. Null when the server sent the Go zero-time. */
  createdAt: string | null;
  /** ISO 8601 last-update time. Null when the server sent the Go zero-time. */
  updatedAt: string | null;
}

/** Response from creating a radio station */
export interface CreateRadioStationResponse {
  /** Success status */
  success: boolean;
  /** Created radio station */
  station?: RadioStationDTO;
  /** Error message if failed */
  error?: string;
  /** Warning on a successful create whose station id could not be resolved. */
  note?: string;
}

/** The deleted id is not echoed, since the caller sent it. */
export interface DeleteRadioStationResponse {
  /** Success status */
  success: boolean;
  /** Human-readable confirmation, e.g. "Successfully deleted radio station" */
  message: string;
}

/** Response from listing radio stations */
export interface ListRadioStationsResponse {
  /** Array of radio stations */
  stations: RadioStationDTO[];
  /** Total count */
  total: number;
  /** One-time tip message */
  tip?: string;
}

/**
 * External radio station from Radio Browser API
 */
export interface ExternalRadioStationDTO {
  /** Unique station UUID */
  stationUuid: string;
  /** Station name */
  name: string;
  /** Resolved stream URL (preferred over raw URL) */
  streamUrl: string;
  /** Station homepage URL */
  homePageUrl?: string;
  /** Tags/genres for the station */
  tags: string[];
  /** Country code (ISO 3166) */
  countryCode?: string;
  /** Language names, the values discover_radio_stations' language filter matches */
  languages: string[];
  /** Audio codec (MP3, AAC, OGG, etc.) */
  codec?: string;
  /** Bitrate in kbps */
  bitrate?: number;
  /** Whether station uses HLS streaming */
  hls: boolean;
  /** Number of votes */
  votes: number;
  /** Total click count */
  clickCount: number;
  /** Stream validation results (if validated) */
  validation?: {
    /** Whether stream passed validation */
    isValid: boolean;
    /** Brief validation status */
    status: 'OK' | 'FAIL';
    /** Validation duration */
    durationMs?: number;
  };
}

/**
 * Response from radio station discovery
 */
export interface DiscoverRadioStationsResponse {
  /** Array of discovered stations */
  stations: ExternalRadioStationDTO[];
  /** The offset of the next page, counted in upstream rows, since dropped and deduped rows never reach `stations`. */
  nextOffset: number;
  /** True when Radio Browser filled the page. Dedupe can shorten `stations`, so its length is no end signal. */
  hasMore: boolean;
  /** Data source */
  source: 'radio-browser';
  /** Mirror server used */
  mirrorUsed: string;
  /** Validation summary (if validation was performed) */
  validationSummary?: {
    totalStations: number;
    validatedStations: number;
    workingStations: number;
    message: string;
  };
}

/**
 * Radio filter options for UI pickers
 */
export interface RadioFiltersResponse {
  /** Available tags/genres */
  tags?: Array<{
    name: string;
    stationCount: number;
  }>;
  /** Available countries */
  countries?: Array<{
    code: string;
    name: string;
    stationCount: number;
  }>;
  /** Available languages */
  languages?: Array<{
    name: string;
    stationCount: number;
  }>;
  /** Available codecs */
  codecs?: Array<{
    name: string;
    stationCount: number;
  }>;
  /**
   * Requested kinds whose fetch failed while another kind succeeded.
   * Separates a failed fetch from an empty result.
   */
  partialFailures?: string[];
}

/**
 * Response from clicking/playing a radio station
 */
export interface ClickRadioStationResponse {
  /** Success status */
  success: boolean;
  /** Canonical stream URL */
  streamUrl: string;
  /** Response message */
  message: string;
}

/**
 * Response from voting for a radio station
 */
export interface VoteRadioStationResponse {
  /** Success status */
  success: boolean;
  /** Response message */
  message: string;
}

/**
 * Result of validate_radio_stream
 */
export interface StreamValidationResult {
  success: boolean;
  url: string;
  finalUrl?: string;
  status: 'valid' | 'invalid' | 'error';
  httpStatus?: number;
  contentType?: string;
  streamingHeaders: Record<string, string>;
  audioFormat?: {
    readonly detected: boolean;
    readonly format?: string;
    readonly mime?: string;
  };
  validation: {
    httpAccessible: boolean;
    hasAudioContentType: boolean;
    hasStreamingHeaders: boolean;
    audioDataDetected: boolean;
  };
  errors: string[];
  warnings: string[];
  recommendations: string[];
  testDurationMs: number;
}