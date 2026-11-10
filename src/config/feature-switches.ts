/**
 * Navidrome MCP Server - Radio and lyrics switches, with the rule for files that predate them
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { logger } from '../utils/logger.js';
import { nonEmpty } from './non-empty.js';
import type { SettingsFile } from './store.js';

type StoredFeatures = NonNullable<SettingsFile['features']>;
export type FeatureSwitches = Pick<StoredFeatures, 'radio' | 'lyrics'>;

const LYRICS_PROVIDER_LRCLIB = 'lrclib';

// The store is reread at each mpv start and each settings page request, so each warning logs once per process.
const loggedProviderWarnings = new Set<string>();

/** A file that names neither switch reads as off. */
export function resolveFeatureSwitches(features: StoredFeatures): { radio: boolean; lyrics: boolean } {
  const named = readNamedFeatureSwitches(features);
  return { radio: named.radio ?? false, lyrics: named.lyrics ?? false };
}

/**
 * Only the switches the file names, by its boolean or by a legacy key. The legacy keys give the
 * result the earlier settings page gave for each value it wrote, and a hand-edited lyricsProvider
 * other than lrclib now reads as off.
 */
export function readNamedFeatureSwitches(features: StoredFeatures): FeatureSwitches {
  const switches: FeatureSwitches = {};
  if (features.radio !== undefined || features.radioBrowserUserAgent !== undefined) {
    switches.radio = features.radio ?? (nonEmpty(features.radioBrowserUserAgent) !== undefined);
  }
  if (features.lyrics !== undefined || features.lyricsProvider !== undefined || features.lrclibUserAgent !== undefined) {
    switches.lyrics = features.lyrics ?? (
      isLrclibProvider(features.lyricsProvider, 'features.lyricsProvider') && nonEmpty(features.lrclibUserAgent) !== undefined
    );
  }
  return switches;
}

/** LRCLIB is the only provider, so a hand edit such as "none" or "off" turns lookups off instead of on. */
export function isLrclibProvider(value: string | null | undefined, key: string): boolean {
  const provider = value?.trim() ?? '';
  if (provider === '') return false;
  if (provider.toLowerCase() === LYRICS_PROVIDER_LRCLIB) return true;
  warnOnce(`${key} "${provider}" is not supported (use ${LYRICS_PROVIDER_LRCLIB}), so LRCLIB lyrics are off.`);
  return false;
}

function warnOnce(message: string): void {
  if (loggedProviderWarnings.has(message)) return;
  loggedProviderWarnings.add(message);
  logger.warn(message);
}
