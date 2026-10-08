/**
 * Coverage for the visualizer's pure browser modules: the level timeline and the kit the modes share.
 * The modes themselves run the plugin contract in visualizer-plugins.test.ts.
 *
 * Both live under src/webui/public/, which eslint ignores and tsc cannot see, so this file is their
 * only automated guard. They stay importable here only while they reference no browser global,
 * which the purity scan below enforces.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectBeat, hslOf, resample } from '../../../src/webui/public/visualizer-kit.js';
import { BAND_COUNT, createLevelGain, createSmoother, createTimeline } from '../../../src/webui/public/visualizer-timeline.js';

describe('visualizer browser modules stay pure', () => {
  it.each(['visualizer-timeline.js', 'visualizer-kit.js'])('%s references no browser global', (file) => {
    const source = readFileSync(new URL(`../../../src/webui/public/${file}`, import.meta.url), 'utf8');
    expect(source).not.toMatch(/\b(window|document|navigator|localStorage|requestAnimationFrame|getComputedStyle)\b/);
  });
});

describe('createLevelGain', () => {
  // A spectrum shape that falls off toward the treble, as most music does.
  const SHAPE = Array.from({ length: BAND_COUNT }, (_, band) => -20 - band * 1.5);
  const shifted = (db: number): number[] => SHAPE.map((level) => level + db);
  const run = (gain: ReturnType<typeof createLevelGain>, levels: number[], seconds: number, segment = 1): number[] => {
    let heights: number[] = [];
    for (let t = 0; t < seconds; t += 1 / 60) heights = gain.heights({ segment, levels }, 1 / 60);
    return heights;
  };

  it('gives a loud master and a quiet recording of the same shape the same heights', () => {
    const loud = run(createLevelGain(), shifted(0), 1);
    const quiet = run(createLevelGain(), shifted(-30), 1);

    loud.forEach((height, band) => { expect(quiet[band]).toBeCloseTo(height, 6); });
  });

  it('keeps the loudest band under the top, so steady music never pins', () => {
    const heights = run(createLevelGain(), shifted(0), 3);

    expect(Math.max(...heights)).toBeGreaterThan(0.85);
    expect(Math.max(...heights)).toBeLessThan(1);
  });

  it('shows a quieter passage lower, then lets it rise back over several seconds', () => {
    const gain = createLevelGain();
    const loud = run(gain, shifted(0), 3);
    const justAfter = run(gain, shifted(-10), 0.1);
    const later = run(gain, shifted(-10), 6);

    expect(Math.max(...justAfter)).toBeLessThan(Math.max(...loud) - 0.3);
    expect(Math.max(...later)).toBeCloseTo(Math.max(...loud), 2);
  });

  it('follows a louder passage within a second', () => {
    const gain = createLevelGain();
    run(gain, shifted(-15), 3);
    const louder = run(gain, shifted(0), 1);

    expect(Math.max(...louder)).toBeLessThan(1);
  });

  it('starts each new file from its own level', () => {
    const gain = createLevelGain();
    const loud = run(gain, shifted(0), 3, 1);
    const quietNextFile = run(gain, shifted(-30), 1 / 60, 2);

    expect(Math.max(...quietNextFile)).toBeCloseTo(Math.max(...loud), 2);
  });

  it('lifts the upper bands a little and clamps to the range', () => {
    const flat = run(createLevelGain(), Array.from({ length: BAND_COUNT }, () => -30), 1);
    expect(flat[15]).toBeGreaterThan(flat[0] ?? 1);

    const silentBand = run(createLevelGain(), [-100, ...shifted(0).slice(1)], 1);
    expect(silentBand[0]).toBe(0);
  });
});

function row(segment: number, ptsMs: number, db = -30): number[] {
  return [segment, ptsMs, ...Array.from({ length: BAND_COUNT }, () => db)];
}

describe('createTimeline', () => {
  it('returns the measurement at or before the playback position', () => {
    const timeline = createTimeline();
    timeline.ingest([row(1, 1000, -40), row(1, 1023, -20), row(1, 1046, -50)], 0);

    expect(timeline.levelsAt(1.03, 10)?.levels[0]).toBe(-20);
  });

  it('falls back to the arrival lead when the clock does not reach the newest segment yet', () => {
    const timeline = createTimeline();
    // A new file started: its timestamps restart while the clock still reports the old track's end.
    timeline.ingest([row(1, 200_000), row(2, 0, -45), row(2, 100, -35), row(2, 400, -20)], 0);

    expect(timeline.levelsAt(200.1, 10)).toEqual({ segment: 2, levels: row(2, 100, -35).slice(2) });
  });

  it('replaces the old segment, since its timestamps restart', () => {
    const timeline = createTimeline();
    timeline.ingest([row(1, 5000, -20)], 0);
    timeline.ingest([row(2, 0, -50)], 0);

    expect(timeline.levelsAt(0.01, 10)?.levels[0]).toBe(-50);
  });

  it('returns null when the feed stalls or nothing has arrived', () => {
    const timeline = createTimeline();
    expect(timeline.levelsAt(1, 0)).toBeNull();

    timeline.ingest([row(1, 1000)], 0);
    expect(timeline.levelsAt(1, 2000)).toBeNull();
  });

  it('drops measurements older than the buffer', () => {
    const timeline = createTimeline();
    timeline.ingest([row(1, 0, -20), row(1, 20_000, -40)], 0);

    expect(timeline.levelsAt(20, 10)?.levels[0]).toBe(-40);
    expect(timeline.levelsAt(0.01, 10)).toBeNull();
  });
});

describe('createSmoother', () => {
  function run(steps: number, totalSeconds: number, target: number): number {
    const smoother = createSmoother(1);
    for (let i = 0; i < steps; i++) smoother.step([target], totalSeconds / steps);
    return smoother.values[0] ?? 0;
  }

  it('moves the same distance in the same time at any frame rate', () => {
    expect(run(3, 0.1, 1)).toBeCloseTo(run(15, 0.1, 1), 6);
  });

  it('rises faster than it falls', () => {
    const smoother = createSmoother(1);
    smoother.step([1], 0.05);
    const risen = smoother.values[0] ?? 0;
    smoother.step([1], 1);
    smoother.step([0], 0.05);
    const fallen = 1 - (smoother.values[0] ?? 0);

    expect(risen).toBeGreaterThan(fallen);
  });

  it('holds a peak, then lets it fall, and reports rest once everything is down', () => {
    const smoother = createSmoother(1);
    smoother.step([1], 1);
    smoother.step(null, 0.3);
    expect(smoother.peaks[0]).toBeCloseTo(1, 5);

    let atRest = false;
    for (let i = 0; i < 200 && !atRest; i++) atRest = smoother.step(null, 0.05);
    expect(atRest).toBe(true);
  });
});

describe('visualizer kit', () => {
  it('resamples band heights to a smooth curve through the original points', () => {
    const values = new Float32Array([0, 1, 0, 1]);
    const out = resample(values, 7);

    expect(Array.from(out.filter((_, i) => i % 2 === 0))).toEqual([0, 1, 0, 1]);
    for (const value of out) expect(value).toBeGreaterThanOrEqual(0);
  });

  it('fires a beat on a rise across the bands, then waits out the gap', () => {
    const state: Record<string, unknown> = {};
    const quiet = { values: new Float32Array(BAND_COUNT), dtSeconds: 0.05 };
    const loud = { values: new Float32Array(BAND_COUNT).fill(0.5), dtSeconds: 0.05 };

    expect(detectBeat(state, quiet)).toBe(false);
    expect(detectBeat(state, loud)).toBe(true);
    expect(detectBeat(state, quiet)).toBe(false);
    expect(detectBeat(state, loud)).toBe(false);
    expect(Object.keys(state)).toEqual(['beat']);
  });

  it('reads hue, saturation and lightness from a palette color', () => {
    const { hue, saturation, lightness } = hslOf({ r: 255, g: 0, b: 0 });

    expect([hue, saturation, lightness]).toEqual([0, 100, 50]);
  });
});
