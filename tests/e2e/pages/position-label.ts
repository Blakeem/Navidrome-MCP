/**
 * Navidrome MCP Server - e2e playback position label reading
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Locator } from '@playwright/test';

const POSITION_TEXT = /^\d+(?::\d{2}){1,2}$/;

/** Turns a position label's m:ss or h:mm:ss text into seconds, and throws on any other text. */
export function positionTextSeconds(text: string): number {
  if (!POSITION_TEXT.test(text)) throw new Error(`e2e: the position label reads "${text}", which is not m:ss or h:mm:ss.`);
  return text.split(':').reduce((total, part) => total * 60 + Number(part), 0);
}

export async function readPositionSeconds(label: Locator): Promise<number> {
  return positionTextSeconds((await label.textContent())?.trim() ?? '');
}
