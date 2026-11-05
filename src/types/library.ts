/**
 * Navidrome MCP Server - Library Data Transfer Objects
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export interface LibraryDTO {
  id: number;
  name: string;
  path: string;
  isActive: boolean;
  /** Null when Navidrome supplied no stats for this library, as for a non-admin account. */
  stats: {
    totalSongs: number;
    totalAlbums: number;
    totalArtists: number;
    totalSize: number;
    totalDuration: number;
  } | null;
  /** Null under the same condition as stats. */
  scanInfo: {
    lastScanAt: string | null;
    lastScanStartedAt: string | null;
    fullScanInProgress: boolean;
  } | null;
  /** ISO 8601 creation time. Null when the server sent the Go zero-time. */
  createdAt: string | null;
  /** ISO 8601 last-update time. Null when the server sent the Go zero-time. */
  updatedAt: string | null;
}

export interface UserDetailsDTO {
  user: {
    id: string;
    userName: string;
    name: string;
    email: string;
    isAdmin: boolean;
    lastLoginAt: string | null;
    lastAccessAt: string | null;
  };
  libraries: {
    available: LibraryDTO[];
    activeCount: number;
    totalCount: number;
  };
  summary: {
    totalSongs: number;
    totalAlbums: number;
    totalArtists: number;
    activeLibraryNames: string[];
  };
}

export interface LibraryManagementResponse {
  success: boolean;
  message: string;
  activeLibraries: Array<{
    id: number;
    name: string;
  }>;
  totalCount: number;
}

