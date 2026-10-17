/**
 * Navidrome MCP Server - Radio Recommendation Engine Module
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { StreamValidationResult } from '../../types/index.js';
import { NON_STANDARD_HTTP_RESPONSE, PRIVATE_ADDRESS_REFUSAL } from '../../utils/network-safety.js';

export function generateRecommendations(result: StreamValidationResult): string[] {
  const recommendations: string[] = [];

  if (result.status === 'valid') {
    recommendations.push('Stream validated successfully');

    const icyName = result.streamingHeaders['icy-name'];
    if (icyName !== undefined && icyName !== '') {
      recommendations.push(`Station: ${icyName}`);
    }

    const icyBr = result.streamingHeaders['icy-br'];
    if (icyBr !== undefined && icyBr !== '') {
      recommendations.push(`Bitrate: ${icyBr}kbps`);
    }

    const audioFormatName = result.audioFormat?.format;
    if (audioFormatName !== undefined && audioFormatName !== '') {
      recommendations.push(`Format: ${audioFormatName.toUpperCase()}`);
    }

    recommendations.push('Ready to add as radio station');
  } else if (result.status === 'invalid') {
    recommendations.push('Stream validation failed');

    // An error page is text/html, so a non-2xx status is advised on before the content type.
    if (result.httpStatus !== undefined && !result.validation.httpAccessible) {
      recommendations.push(...httpErrorAdvice(result.httpStatus));
    } else if (!result.validation.hasAudioContentType) {
      recommendations.push('URL does not serve audio content');
      recommendations.push('Ensure you\'re using the stream URL, not the website URL');
    } else if (!result.validation.audioDataDetected) {
      recommendations.push('Could not detect valid audio data');
      recommendations.push('The stream may be geo-restricted or require authentication');
    }

    recommendations.push('Try finding alternative streams at radio-browser.info');
  } else {
    recommendations.push('Stream validation encountered an error');

    // A private/local refusal and an unparseable response fail the same way on retry, so "try
    // again later" would mislead.
    const allMessages = [...result.errors, ...result.warnings];
    const refusedPrivateAddress = allMessages.some((m) => m.includes(PRIVATE_ADDRESS_REFUSAL));
    const nonStandardResponse = allMessages.some((m) => m.includes(NON_STANDARD_HTTP_RESPONSE));
    if (refusedPrivateAddress) {
      recommendations.push('The URL points to a private/internal network address, which this validator refuses to probe (SSRF protection). Only publicly reachable streams can be validated.');
    } else if (nonStandardResponse) {
      recommendations.push('The server speaks legacy ICY or non-standard HTTP that this probe cannot parse. This is not a network outage, and the stream may still play through mpv.');
    } else {
      recommendations.push('Try again later or check your network connection');
    }
  }

  return recommendations;
}

function httpErrorAdvice(httpStatus: number): string[] {
  if (httpStatus === 404 || httpStatus === 410) {
    return ['Stream URL appears to be offline or moved', 'Check the station\'s official website for updated URLs'];
  }
  if (httpStatus === 401 || httpStatus === 403 || httpStatus === 451) {
    return ['The stream may be geo-restricted or require authentication'];
  }
  return ['The server returned an error. Try again later'];
}
