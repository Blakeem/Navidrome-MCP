/**
 * Navidrome MCP Server - Radio Recommendation Engine Module
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

// Stream validation result interface (partial for recommendations)
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
  testDuration: number;
}

/**
 * Generate recommendations based on validation results
 */
export function generateRecommendations(
  result: Partial<StreamValidationResult>
): string[] {
  const recommendations: string[] = [];

  if (result.status === 'valid') {
    recommendations.push('Stream validated successfully');

    if (result.streamingHeaders?.['icy-name'] !== null && result.streamingHeaders?.['icy-name'] !== undefined && result.streamingHeaders?.['icy-name'] !== '') {
      recommendations.push(`Station: ${result.streamingHeaders['icy-name']}`);
    }

    if (result.streamingHeaders?.['icy-br'] !== null && result.streamingHeaders?.['icy-br'] !== undefined && result.streamingHeaders?.['icy-br'] !== '') {
      recommendations.push(`Bitrate: ${result.streamingHeaders['icy-br']}kbps`);
    }

    if (result.audioFormat?.format !== null && result.audioFormat?.format !== undefined && result.audioFormat?.format !== '') {
      recommendations.push(`Format: ${result.audioFormat.format.toUpperCase()}`);
    }

    recommendations.push('Ready to add as radio station');
  } else if (result.status === 'invalid') {
    recommendations.push('Stream validation failed');

    if (result.httpStatus === 404) {
      recommendations.push('Stream URL appears to be offline or moved');
      recommendations.push('Check the station\'s official website for updated URLs');
    } else if (result.validation?.hasAudioContentType === false) {
      recommendations.push('URL does not serve audio content');
      recommendations.push('Ensure you\'re using the stream URL, not the website URL');
    } else if (result.validation?.audioDataDetected === false) {
      recommendations.push('Could not detect valid audio data');
      recommendations.push('The stream may be geo-restricted or require authentication');
    }

    recommendations.push('Try finding alternative streams at radio-browser.info');
  } else {
    recommendations.push('Stream validation encountered an error');
    recommendations.push('Try again later or check your network connection');
  }

  return recommendations;
}