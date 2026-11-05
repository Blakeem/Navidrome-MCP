/**
 * Navidrome MCP Server - Radio Data Transfer Objects
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/** A station saved in Navidrome. */
export interface RadioStationDTO {
  id: string;
  streamUrl: string;
  name: string;
  homePageUrl?: string;
  /** ISO 8601. Null for a Go zero-time, or for a created station whose id lookup failed. */
  createdAt: string | null;
  /** ISO 8601. Null for a Go zero-time, or for a created station whose id lookup failed. */
  updatedAt: string | null;
}

export interface CreateRadioStationResponse {
  success: boolean;
  station?: RadioStationDTO;
  error?: string;
  /** Warning on a successful create, such as a shared stream URL or an unresolved station id. */
  note?: string;
}

/** The deleted id is not echoed, since the caller sent it. */
export interface DeleteRadioStationResponse {
  success: boolean;
  message: string;
}

export interface ListRadioStationsResponse {
  stations: RadioStationDTO[];
  total: number;
  /** Present on the first listing per server process only. */
  tip?: string;
}

/** A station from the Radio Browser directory. */
export interface ExternalRadioStationDTO {
  stationUuid: string;
  name: string;
  /** Radio Browser's `url_resolved`, or its `url` when that is empty. */
  streamUrl: string;
  homePageUrl?: string;
  tags: string[];
  /** ISO 3166-1 alpha-2. */
  countryCode?: string;
  /** Language names, the values discover_radio_stations' language filter matches. */
  languages: string[];
  codec?: string;
  /** kbps. */
  bitrate?: number;
  hls: boolean;
  votes: number;
  clickCount: number;
  validation?: {
    isValid: boolean;
    status: 'OK' | 'FAIL';
    durationMs?: number;
  };
}

export interface DiscoverRadioStationsResponse {
  stations: ExternalRadioStationDTO[];
  /** Counted in upstream rows, since dropped and deduped rows never reach `stations`. */
  nextOffset: number;
  /** True when Radio Browser filled the page. Dedupe can shorten `stations`, so its length is
   *  no end signal. */
  hasMore: boolean;
  source: 'radio-browser';
  mirrorUsed: string;
  validationSummary?: {
    totalStations: number;
    validatedStations: number;
    workingStations: number;
    message: string;
  };
}

export interface RadioFiltersResponse {
  tags?: Array<{
    name: string;
    stationCount: number;
  }>;
  countries?: Array<{
    code: string;
    name: string;
    stationCount: number;
  }>;
  languages?: Array<{
    name: string;
    stationCount: number;
  }>;
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

export interface ClickRadioStationResponse {
  /** A rejected click throws, so a returned click always succeeded. */
  success: true;
  streamUrl: string;
  message: string;
}

export interface VoteRadioStationResponse {
  /** A rejected vote throws, so a returned vote always succeeded. */
  success: true;
  message: string;
}

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