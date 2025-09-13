/**
 * Navidrome MCP Server - Radio Validation Public API
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

// Main validation function export
export { validateRadioStream } from './validation-core.js';

// Type exports for consumers who need them
export type { AudioDetectionResult } from './stream-detector.js';
export type { ValidationContext } from './network-validator.js';
export type { StreamValidationResult } from './recommendation-engine.js';

// Utility exports for advanced usage
export {
  isAudioContentType,
  extractStreamingHeaders,
  detectAudioFormat,
  VALID_AUDIO_MIMES,
  STREAMING_HEADERS,
} from './stream-detector.js';

export {
  validateWithHead,
  sampleAudioData,
} from './network-validator.js';

export {
  generateRecommendations,
} from './recommendation-engine.js';