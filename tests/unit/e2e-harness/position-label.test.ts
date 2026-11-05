/**
 * Navidrome MCP Server - e2e position label unit tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';

import { positionTextSeconds } from '../../e2e/pages/position-label.js';

describe('positionTextSeconds', () => {
  it.each([
    ['0:00', 0],
    ['0:07', 7],
    ['12:34', 754],
    ['1:02:03', 3723],
  ])('reads %s as %d seconds', (text, seconds) => {
    expect(positionTextSeconds(text)).toBe(seconds);
  });

  it.each(['', '-', '1:5', '1:2:3', 'abc', '1:00:00:00'])('throws on "%s" with the text named', (text) => {
    expect(() => positionTextSeconds(text)).toThrow(`the position label reads "${text}"`);
  });
});
