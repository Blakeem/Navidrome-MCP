/**
 * Coverage for the visualizer's pure browser modules: the level timeline and the drawing modes.
 *
 * Both live under src/webui/public/, which eslint ignores and tsc cannot see, so this file is their
 * only automated guard. They stay importable here only while they reference no browser global,
 * which the purity scan below enforces.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MODES, PAD_RATIO, levelSummary, resample } from '../../../src/webui/public/visualizer-modes.js';
import { BAND_COUNT, bandHeight, createSmoother, createTimeline } from '../../../src/webui/public/visualizer-timeline.js';

const PALETTE = { accent: { r: 124, g: 156, b: 255 }, strong: { r: 165, g: 190, b: 255 } };

describe('visualizer browser modules stay pure', () => {
  it.each(['visualizer-timeline.js', 'visualizer-modes.js'])('%s references no browser global', (file) => {
    const source = readFileSync(new URL(`../../../src/webui/public/${file}`, import.meta.url), 'utf8');
    expect(source).not.toMatch(/\b(window|document|navigator|localStorage|requestAnimationFrame|getComputedStyle)\b/);
  });
});

describe('bandHeight', () => {
  it('maps the floor to 0 and the ceiling to 1, clamping beyond them', () => {
    expect(bandHeight(-55, 0)).toBe(0);
    expect(bandHeight(-100, 0)).toBe(0);
    expect(bandHeight(-15, 0)).toBe(1);
    expect(bandHeight(-3, 0)).toBe(1);
  });

  it('lifts the upper bands, which carry less energy in most music', () => {
    expect(bandHeight(-40, 15)).toBeGreaterThan(bandHeight(-40, 0));
    expect(bandHeight(-40, 6)).toBe(bandHeight(-40, 0));
  });
});

function row(segment: number, ptsMs: number, db = -30): number[] {
  return [segment, ptsMs, ...Array.from({ length: BAND_COUNT }, () => db)];
}

describe('createTimeline', () => {
  it('returns the measurement at or before the playback position', () => {
    const timeline = createTimeline();
    timeline.ingest([row(1, 1000, -40), row(1, 1023, -20), row(1, 1046, -50)], 0);

    expect(timeline.heightsAt(1.03, 10)?.[0]).toBe(bandHeight(-20, 0));
  });

  it('falls back to the arrival lead when the clock does not reach the newest segment yet', () => {
    const timeline = createTimeline();
    // A new file started: its timestamps restart while the clock still reports the old track's end.
    timeline.ingest([row(1, 200_000), row(2, 0, -45), row(2, 100, -35), row(2, 400, -20)], 0);

    expect(timeline.heightsAt(200.1, 10)?.[0]).toBe(bandHeight(-35, 0));
  });

  it('replaces the old segment, since its timestamps restart', () => {
    const timeline = createTimeline();
    timeline.ingest([row(1, 5000, -20)], 0);
    timeline.ingest([row(2, 0, -50)], 0);

    expect(timeline.heightsAt(0.01, 10)?.[0]).toBe(bandHeight(-50, 0));
  });

  it('returns null when the feed stalls or nothing has arrived', () => {
    const timeline = createTimeline();
    expect(timeline.heightsAt(1, 0)).toBeNull();

    timeline.ingest([row(1, 1000)], 0);
    expect(timeline.heightsAt(1, 2000)).toBeNull();
  });

  it('drops measurements older than the buffer', () => {
    const timeline = createTimeline();
    timeline.ingest([row(1, 0, -20), row(1, 20_000, -40)], 0);

    expect(timeline.heightsAt(20, 10)?.[0]).toBe(bandHeight(-40, 0));
    expect(timeline.heightsAt(0.01, 10)).toBeNull();
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

interface Bounds { minX: number; maxX: number; minY: number; maxY: number }

function alphaOf(style: unknown): number {
  if (typeof style === 'string') return Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(style)?.[1] ?? 1);
  return (style as { maxAlpha: number }).maxAlpha;
}

/**
 * Records how far each painted path reaches: its points, widened by an arc's radius, and by half the
 * line width when stroked. Also counts paints that show anything, meaning a path with a non-transparent style.
 */
function recordingContext(): { ctx: Record<string, unknown>; bounds: Bounds; visibleDraws: () => number } {
  const bounds: Bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  let path: Array<{ x: number; y: number; radius: number }> = [];
  let visible = 0;
  const point = (x: number, y: number, radius = 0): void => { path.push({ x, y, radius }); };
  const paint = (style: unknown, widen: number): void => {
    if (path.length === 0 || alphaOf(style) <= 0) return;
    visible += 1;
    for (const p of path) {
      const reach = p.radius + widen;
      bounds.minX = Math.min(bounds.minX, p.x - reach);
      bounds.maxX = Math.max(bounds.maxX, p.x + reach);
      bounds.minY = Math.min(bounds.minY, p.y - reach);
      bounds.maxY = Math.max(bounds.maxY, p.y + reach);
    }
  };
  const gradient = (): { maxAlpha: number; addColorStop: (offset: number, color: string) => void } => {
    const g = { maxAlpha: 0, addColorStop: (_offset: number, color: string) => { g.maxAlpha = Math.max(g.maxAlpha, alphaOf(color)); } };
    return g;
  };
  const ctx: Record<string, unknown> = {
    lineWidth: 1,
    globalAlpha: 1,
    beginPath: () => { path = []; },
    closePath: () => undefined,
    moveTo: (x: number, y: number) => { point(x, y); },
    lineTo: (x: number, y: number) => { point(x, y); },
    arc: (x: number, y: number, radius: number) => { point(x, y, radius); },
    fill: () => { paint(ctx.fillStyle, 0); },
    stroke: () => { paint(ctx.strokeStyle, (ctx.lineWidth as number) / 2); },
    createLinearGradient: gradient,
    createRadialGradient: gradient,
  };
  return { ctx, bounds, visibleDraws: () => visible };
}

function frameFor(width: number, height: number, level: number, state: Record<string, unknown>): Record<string, unknown> {
  const values = new Float32Array(BAND_COUNT).fill(level);
  return { width, height, values, peaks: values, ...levelSummary(values), palette: PALETTE, dtSeconds: 1 / 60, reducedMotion: false, state };
}

describe('visualizer modes', () => {
  const sizes: Array<[number, number]> = [[320, 160], [160, 320], [360, 72], [200, 200]];

  it.each(MODES.map((mode) => [mode.id, mode] as const))('%s stays inside the padded area at full level', (_id, mode) => {
    for (const [width, height] of sizes) {
      const { ctx, bounds } = recordingContext();
      const state: Record<string, unknown> = {};
      // Alternating loud and silent frames trigger the orb's beat rings, which expand toward the edge.
      for (let frame = 0; frame < 240; frame++) {
        mode.draw(ctx, frameFor(width, height, frame % 6 < 3 ? 1 : 0, state));
      }
      const pad = Math.min(width, height) * PAD_RATIO;
      expect(bounds.minX).toBeGreaterThanOrEqual(pad - 0.5);
      expect(bounds.minY).toBeGreaterThanOrEqual(pad - 0.5);
      expect(bounds.maxX).toBeLessThanOrEqual(width - pad + 0.5);
      expect(bounds.maxY).toBeLessThanOrEqual(height - pad + 0.5);
    }
  });

  it.each(MODES.map((mode) => [mode.id, mode] as const))('%s draws nothing visible in silence', (_id, mode) => {
    const { ctx, visibleDraws } = recordingContext();
    const state: Record<string, unknown> = {};
    for (let frame = 0; frame < 30; frame++) mode.draw(ctx, frameFor(320, 160, 0, state));

    expect(visibleDraws()).toBe(0);
  });

  it('resamples band heights to a smooth curve through the original points', () => {
    const values = new Float32Array([0, 1, 0, 1]);
    const out = resample(values, 7);

    expect(Array.from(out.filter((_, i) => i % 2 === 0))).toEqual([0, 1, 0, 1]);
    for (const value of out) expect(value).toBeGreaterThanOrEqual(0);
  });
});
