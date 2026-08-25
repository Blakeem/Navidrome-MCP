/**
 * Coverage for the pure timing module behind the lyrics overlay.
 *
 * That module lives under src/webui/public/, which eslint ignores and tsc cannot
 * see, so this file is its only automated guard. It stays importable here only
 * while it references no browser global, which the purity scan below enforces.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  SEEK_THRESHOLD_MS,
  applyOffset,
  createSeekDetector,
  findActiveLine,
  isInterlude,
} from '../../../src/webui/public/lyrics-sync.js';

interface FixtureLine {
  timeMs: number;
  endMs: number;
  text: string;
}

// Gaps of a real LRC: mostly 2-to-3 seconds, median 2.5s, plus one instrumental
// break the length of the one in Get Lucky.
const GAP_PATTERN_MS = [2200, 2500, 2500, 2800, 3000, 2400];
const FIXTURE_LINE_COUNT = 50;
const FIRST_LINE_MS = 12_000;
const LONG_GAP_INDEX = 24;
const LONG_GAP_MS = 53_000;
const LONG_GAP_HOLD_MS = 3000;
const INTERLUDE_THRESHOLD_MS = 5000;

function buildFixture(): FixtureLine[] {
  const lines: FixtureLine[] = [];
  let startMs = FIRST_LINE_MS;

  for (let index = 0; index < FIXTURE_LINE_COUNT; index += 1) {
    const gapMs =
      index === LONG_GAP_INDEX ? LONG_GAP_MS : GAP_PATTERN_MS[index % GAP_PATTERN_MS.length]!;
    // Only the break carries an early end, the way an empty LRC marker closes a line.
    const holdMs = index === LONG_GAP_INDEX ? LONG_GAP_HOLD_MS : gapMs;

    lines.push({ timeMs: startMs, endMs: startMs + holdMs, text: `line ${index}` });
    startMs += gapMs;
  }

  return lines;
}

function linearScan(lines: FixtureLine[], timeMs: number): number {
  let found = -1;

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]!.timeMs <= timeMs) found = index;
  }

  return found;
}

const fixture = buildFixture();
const lastLine = fixture[fixture.length - 1]!;
const SCAN_END_MS = lastLine.endMs + 5000;
const SCAN_STEP_MS = 100;

describe('SEEK_THRESHOLD_MS', () => {
  it('is the exported half-second drift budget', () => {
    expect(SEEK_THRESHOLD_MS).toBe(500);
  });
});

describe('createSeekDetector', () => {
  it('treats the very first snapshot as a seek', () => {
    const detector = createSeekDetector();

    expect(detector.check(30_000, 1000, true)).toBe(true);
  });

  it('does not flag a normal 1 Hz advance', () => {
    const detector = createSeekDetector();

    detector.check(30_000, 1000, true);

    expect(detector.check(31_000, 2000, true)).toBe(false);
  });

  it('tolerates drift under the threshold', () => {
    const detector = createSeekDetector();

    detector.check(30_000, 1000, true);

    expect(detector.check(31_400, 2000, true)).toBe(false);
  });

  it('flags a three-second jump', () => {
    const detector = createSeekDetector();

    detector.check(30_000, 1000, true);

    expect(detector.check(33_000, 2000, true)).toBe(true);
  });

  it('flags backwards movement', () => {
    const detector = createSeekDetector();

    detector.check(30_000, 1000, true);

    expect(detector.check(20_000, 2000, true)).toBe(true);
  });

  it('flags any movement while paused', () => {
    const detector = createSeekDetector();

    detector.check(30_000, 1000, false);

    expect(detector.check(30_400, 2000, false)).toBe(true);
  });

  it('stays quiet while paused and still', () => {
    const detector = createSeekDetector();

    detector.check(30_000, 1000, false);

    expect(detector.check(30_000, 5000, false)).toBe(false);
  });
});

describe('findActiveLine', () => {
  it('reports -1 before the first line starts', () => {
    expect(findActiveLine(fixture, 0, null)).toEqual({ index: -1, cursor: null });
    expect(findActiveLine(fixture, FIRST_LINE_MS - 1, null)).toEqual({ index: -1, cursor: null });
  });

  it('activates a line at its own start', () => {
    expect(findActiveLine(fixture, FIRST_LINE_MS, null).index).toBe(0);
  });

  it('matches a linear scan at every position when the cursor is null', () => {
    for (let timeMs = 0; timeMs <= SCAN_END_MS; timeMs += SCAN_STEP_MS) {
      expect(findActiveLine(fixture, timeMs, null).index).toBe(linearScan(fixture, timeMs));
    }
  });

  it('matches a linear scan while a threaded cursor advances across every line', () => {
    let cursor: number | null = null;
    let seen = -1;

    for (let timeMs = 0; timeMs <= SCAN_END_MS; timeMs += SCAN_STEP_MS) {
      const result = findActiveLine(fixture, timeMs, cursor);
      cursor = result.cursor;
      seen = Math.max(seen, result.index);

      expect(result.index).toBe(linearScan(fixture, timeMs));
    }

    expect(seen).toBe(FIXTURE_LINE_COUNT - 1);
  });

  it('discards a cursor that sits ahead of the requested time', () => {
    expect(findActiveLine(fixture, FIRST_LINE_MS, 40).index).toBe(0);
    expect(findActiveLine(fixture, FIRST_LINE_MS - 1, 40)).toEqual({ index: -1, cursor: null });
  });

  it('holds the last line past its end', () => {
    const result = findActiveLine(fixture, lastLine.endMs + 20_000, null);

    expect(result.index).toBe(FIXTURE_LINE_COUNT - 1);
    expect(result.cursor).toBe(FIXTURE_LINE_COUNT - 1);
  });

  it('reports -1 for an empty line list', () => {
    expect(findActiveLine([], 5000, null)).toEqual({ index: -1, cursor: null });
  });
});

describe('isInterlude', () => {
  const shortGap: FixtureLine[] = [
    { timeMs: 0, endMs: 1000, text: 'a' },
    { timeMs: 3000, endMs: 4000, text: 'b' },
  ];

  it('is true inside the 53-second break', () => {
    const gapLine = fixture[LONG_GAP_INDEX]!;

    expect(isInterlude(fixture, LONG_GAP_INDEX, gapLine.endMs + 1000, INTERLUDE_THRESHOLD_MS)).toBe(
      true
    );
  });

  it('is false in a two-second gap', () => {
    expect(isInterlude(shortGap, 0, 1500, INTERLUDE_THRESHOLD_MS)).toBe(false);
  });

  it('is false while the active line is still running', () => {
    const gapLine = fixture[LONG_GAP_INDEX]!;

    expect(isInterlude(fixture, LONG_GAP_INDEX, gapLine.endMs - 1, INTERLUDE_THRESHOLD_MS)).toBe(
      false
    );
  });

  it('clears as the next line approaches', () => {
    const nextLine = fixture[LONG_GAP_INDEX + 1]!;

    expect(
      isInterlude(fixture, LONG_GAP_INDEX, nextLine.timeMs - 1000, INTERLUDE_THRESHOLD_MS)
    ).toBe(false);
  });

  it('is false with no next line and with no active line', () => {
    expect(
      isInterlude(fixture, FIXTURE_LINE_COUNT - 1, lastLine.endMs + 30_000, INTERLUDE_THRESHOLD_MS)
    ).toBe(false);
    expect(isInterlude(fixture, -1, 0, INTERLUDE_THRESHOLD_MS)).toBe(false);
  });
});

describe('applyOffset', () => {
  it('shifts forward and backward', () => {
    expect(applyOffset(10_000, 250)).toBe(10_250);
    expect(applyOffset(10_000, -250)).toBe(9750);
  });

  it('clamps at zero', () => {
    expect(applyOffset(100, -500)).toBe(0);
    expect(applyOffset(0, -1)).toBe(0);
  });
});

describe('module purity', () => {
  it('references no browser global', () => {
    const source = readFileSync(
      new URL('../../../src/webui/public/lyrics-sync.js', import.meta.url),
      'utf8'
    );

    expect(source).not.toMatch(/\b(window|document|performance|Date)\b/);
  });
});
