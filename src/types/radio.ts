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
  /** ISO 8601 timestamp when created */
  createdAt: string;
  /** ISO 8601 timestamp when last updated */
  updatedAt: string;
}

/** Request to create a new radio station */
export interface CreateRadioStationRequest {
  /** Station name (required) */
  name: string;
  /** Stream URL (required) */
  streamUrl: string;
  /** Optional homepage URL */
  homePageUrl?: string;
}

/** Response from creating a radio station */
export interface CreateRadioStationResponse {
  /** Success status */
  success: boolean;
  /** Created radio station */
  station?: RadioStationDTO;
  /** Error message if failed */
  error?: string;
  /** One-time validation reminder message */
  validation_reminder?: string;
}

/** Response from deleting a radio station */
export interface DeleteRadioStationResponse {
  /** Success status */
  success: boolean;
  /** ID of deleted station */
  id?: string;
  /** Error message if failed */
  error?: string;
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

/** Radio playback status information */
export interface RadioPlaybackInfo {
  /** Whether radio is currently playing */
  playing: boolean;
  /** Current radio station info if playing */
  currentStation?: RadioStationDTO;
  /** Current stream metadata if available */
  metadata?: {
    /** Current track/show title */
    title?: string;
    /** Current artist/host */
    artist?: string;
    /** Station description */
    description?: string;
  };
}

/**
 * External radio station from Radio Browser API
 */
export interface ExternalRadioStationDTO {
  /** Unique station UUID */
  stationUuid: string;
  /** Station name */
  name: string;
  /** Resolved play URL (preferred over raw URL) */
  playUrl: string;
  /** Station homepage URL */
  homepage?: string;
  /** Tags/genres for the station */
  tags: string[];
  /** Country code (ISO 3166) */
  countryCode?: string;
  /** Language codes */
  languageCodes: string[];
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
    /** Whether validation was performed */
    validated: boolean;
    /** Whether stream passed validation */
    isValid: boolean;
    /** Brief validation status */
    status: string;
    /** Validation duration in ms */
    duration?: number;
  };
}

/**
 * Response from radio station discovery
 */
export interface DiscoverRadioStationsResponse {
  /** Array of discovered stations */
  stations: ExternalRadioStationDTO[];
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
    code: string;
    name: string;
    stationCount: number;
  }>;
  /** Available codecs */
  codecs?: Array<{
    name: string;
    stationCount: number;
  }>;
}

/**
 * Response from clicking/playing a radio station
 */
export interface ClickRadioStationResponse {
  /** Success status */
  ok: boolean;
  /** Canonical play URL */
  playUrl: string;
  /** Response message */
  message: string;
}

/**
 * Response from voting for a radio station
 */
export interface VoteRadioStationResponse {
  /** Success status */
  ok: boolean;
  /** Response message */
  message: string;
}