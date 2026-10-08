/**
 * Every file in src/webui/public/visualizers/ runs the plugin contract, so a dropped-in mode is checked
 * with no other change. The fake modes below confirm the checker catches each kind of fault.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkVisualizer, checkVisualizerSource } from './visualizer-contract.js';

const PLUGIN_DIR = new URL('../../../src/webui/public/visualizers/', import.meta.url);
const PLUGIN_FILES = readdirSync(PLUGIN_DIR).filter((name) => name.endsWith('.js')).sort();

interface FakeFrame {
  width: number;
  height: number;
  pad: number;
  energy: number;
  state: Record<string, any>;
  createLayer: (width: number, height: number) => { canvas: unknown; ctx: any };
}

type FakeDraw = (ctx: any, frame: FakeFrame) => unknown;

const fake = (draw: FakeDraw): { label: string; draw: FakeDraw } => ({ label: 'Fake', draw });

// Fills the padded area while music plays, the largest paint the contract allows.
const fillArea: FakeDraw = (ctx, frame) => {
  if (frame.energy < 0.01) return;
  ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
  ctx.fillRect(frame.pad, frame.pad, frame.width - 2 * frame.pad, frame.height - 2 * frame.pad);
};

describe('visualizer plugins', () => {
  it('include the default mode and the template', () => {
    expect(PLUGIN_FILES).toEqual(expect.arrayContaining(['bars.js', '_template.js']));
  });

  it.each(PLUGIN_FILES)('%s meets the plugin contract', async (file) => {
    const url = new URL(file, PLUGIN_DIR);
    const source = readFileSync(url, 'utf8');
    const plugin: unknown = (await import(url.href) as { default: unknown }).default;

    expect([...checkVisualizerSource(source), ...checkVisualizer(plugin)]).toEqual([]);
  });
});

describe('the plugin contract checker', () => {
  const failuresOf = (draw: FakeDraw): string[] => checkVisualizer(fake(draw));

  it('passes a mode that fills the padded area', () => {
    expect(failuresOf(fillArea)).toEqual([]);
  });

  it('rejects a paint past the pad', () => {
    const failures = failuresOf((ctx, frame) => {
      if (frame.energy < 0.01) return;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, frame.width, frame.height);
    });

    expect(failures.some((failure) => failure.startsWith('music') && failure.includes('outside'))).toBe(true);
  });

  it('counts a stroke width and a shadow toward the pad', () => {
    const stroke = failuresOf((ctx, frame) => {
      if (frame.energy < 0.01) return;
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(frame.pad, frame.height / 2);
      ctx.lineTo(frame.width - frame.pad, frame.height / 2);
      ctx.stroke();
    });
    const glow = failuresOf((ctx, frame) => {
      ctx.shadowBlur = 12;
      ctx.shadowColor = '#fff';
      fillArea(ctx, frame);
    });

    expect(stroke.some((failure) => failure.includes('outside'))).toBe(true);
    expect(glow.some((failure) => failure.includes('outside'))).toBe(true);
  });

  it('passes content on a layer masked to fade out inside the pad', () => {
    expect(failuresOf((ctx, frame) => {
      if (frame.energy < 0.01) return;
      const layer = frame.createLayer(frame.width, frame.height);
      const radiusX = frame.width / 2 - frame.pad;
      const radiusY = frame.height / 2 - frame.pad;
      layer.ctx.fillStyle = '#fff';
      layer.ctx.fillRect(0, 0, frame.width, frame.height);
      layer.ctx.globalCompositeOperation = 'destination-in';
      layer.ctx.translate(frame.width / 2, frame.height / 2);
      layer.ctx.scale(radiusX, radiusY);
      const fade = layer.ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      fade.addColorStop(0, 'rgba(0, 0, 0, 1)');
      fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
      layer.ctx.fillStyle = fade;
      layer.ctx.fillRect(-2, -2, 4, 4);
      ctx.drawImage(layer.canvas, 0, 0, frame.width, frame.height);
    })).toEqual([]);
  });

  it('rejects a layer drawn at its pixel size, which ignores the device scale', () => {
    const failures = failuresOf((ctx, frame) => {
      if (frame.energy < 0.01) return;
      const layer = frame.createLayer(frame.width, frame.height);
      fillArea(layer.ctx, frame);
      ctx.drawImage(layer.canvas, 0, 0);
    });

    expect(failures.some((failure) => failure.includes('outside'))).toBe(true);
  });

  it('rejects a mode that shows something in silence', () => {
    const failures = failuresOf((ctx, frame) => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(frame.width / 2, frame.height / 2, 1, 1);
    });

    expect(failures).toContain('silence: shows something before any music plays');
  });

  it('rejects trails that outlast the music without returning true', () => {
    const failures = failuresOf((ctx, frame) => {
      frame.state.glow = Math.max((frame.state.glow ?? 0) * 0.995, frame.energy);
      if (frame.state.glow < 0.01) return;
      ctx.fillStyle = `rgba(255, 255, 255, ${frame.state.glow.toFixed(3)})`;
      ctx.fillRect(frame.pad, frame.pad, 10, 10);
    });

    expect(failures.some((failure) => failure.startsWith('release') && failure.includes('freeze'))).toBe(true);
  });

  it('rejects an unbalanced save, a dropped device scale and a throw', () => {
    expect(failuresOf((ctx, frame) => { ctx.save(); fillArea(ctx, frame); })).toContain('music: calls save() without a matching restore()');
    expect(failuresOf((ctx, frame) => { ctx.setTransform(1, 0, 0, 1, 0, 0); fillArea(ctx, frame); })).toContain('music: calls setTransform, which drops the device pixel scale');
    expect(failuresOf((ctx) => { ctx.arc(0, 0, -1, 0, 1); })).toContain('music: draw threw RangeError: arc radius -1 is negative, which the browser rejects');
  });

  it('rejects browser globals and imports other than the kit, ignoring comments', () => {
    const failures = checkVisualizerSource([
      '// window and document in a comment are fine',
      "import { helper } from './other.js';",
      'const wide = window.innerWidth;',
      'export default { label: "x", draw() {} };',
    ].join('\n'));

    expect(failures).toEqual(['source: uses the browser global window', 'source: imports ./other.js, but only ../visualizer-kit.js is allowed']);
  });
});
