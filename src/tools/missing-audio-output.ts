/**
 * Navidrome MCP Server - Missing audio output reporting
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { AUTO_DEVICE_ID } from '../services/playback/audio-devices.js';
import type { MissingAudioOutput } from '../services/playback/playback-engine.js';

// A play result keeps `success: true` when the output is missing, since the queue still loaded.
export interface MissingOutputFields {
  paused?: true;
  message?: string;
}

export function missingAudioOutputMessage(missing: MissingAudioOutput): string {
  if (missing.id === AUTO_DEVICE_ID) return 'No audio output device is available. Connect one, then call resume.';
  return `The selected audio device '${missing.name ?? missing.id}' is not connected. Turn it on, then call resume, or call set_audio_device to pick another output.`;
}

export function missingOutputFields(missing: MissingAudioOutput | null): MissingOutputFields {
  if (missing === null) return {};
  return { paused: true, message: missingAudioOutputMessage(missing) };
}
