/**
 * The visualizer plugin contract from src/webui/public/visualizers/_template.js, checked against a
 * recording 2D context. The recorder bounds what a mode paints through transforms, clips, layers, masks,
 * shadows and blur filters, at a device pixel scale of 2 so a mode that ignores the scale shows. It is a
 * conservative bound, not a rasterizer, so it can reject a paint the browser would keep inside the area.
 */

import { BAND_COUNT, createSmoother } from '../../../src/webui/public/visualizer-timeline.js';
import { PAD_RATIO, levelSummary } from '../../../src/webui/public/visualizer-kit.js';

const DEVICE_SCALE = 2;
// An 8-bit channel rounds an alpha under half a step to 0.
const VISIBLE_ALPHA = 0.002;
const TOLERANCE_PX = 1;
const MAX_PAINTS_PER_FRAME = 1500;
const MAX_LABEL_LENGTH = 24;
const BIG = 1e9;
const RELEASE_LIMIT_S = 3;

type Matrix = readonly [number, number, number, number, number, number];
interface Box { minX: number; minY: number; maxX: number; maxY: number }
type Region = Box | 'all' | null;
type Style = string | RecordedGradient;

const EVERYWHERE: Box = { minX: -BIG, minY: -BIG, maxX: BIG, maxY: BIG };
const NOWHERE: Box = { minX: 1, minY: 1, maxX: 0, maxY: 0 };

const UNION_OPS = new Set([
  'source-over', 'destination-over', 'lighter', 'xor', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation',
  'color', 'luminosity',
]);
const OTHER_OPS = new Set(['source-in', 'source-out', 'source-atop', 'destination-in', 'destination-out', 'destination-atop', 'copy']);

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function scaleOf(m: Matrix): number {
  return Math.max(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3]));
}

function isEmpty(box: Box): boolean {
  return box.minX > box.maxX || box.minY > box.maxY;
}

function clampBig(value: number): number {
  return Math.max(-BIG, Math.min(BIG, value));
}

function transformBox(box: Box, m: Matrix): Box {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of [[box.minX, box.minY], [box.maxX, box.minY], [box.minX, box.maxY], [box.maxX, box.maxY]]) {
    xs.push(clampBig(m[0] * x + m[2] * y + m[4]));
    ys.push(clampBig(m[1] * x + m[3] * y + m[5]));
  }
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function union(a: Box | null, b: Box | null): Box | null {
  if (a === null) return b;
  if (b === null) return a;
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}

function intersect(a: Box | null, b: Box | null): Box | null {
  if (a === null || b === null) return null;
  const box = { minX: Math.max(a.minX, b.minX), minY: Math.max(a.minY, b.minY), maxX: Math.min(a.maxX, b.maxX), maxY: Math.min(a.maxY, b.maxY) };
  return isEmpty(box) ? null : box;
}

function widen(box: Box | null, reach: number): Box | null {
  if (box === null || reach <= 0) return box;
  return { minX: box.minX - reach, minY: box.minY - reach, maxX: box.maxX + reach, maxY: box.maxY + reach };
}

function covers(outer: Box, inner: Box): boolean {
  return outer.minX <= inner.minX && outer.minY <= inner.minY && outer.maxX >= inner.maxX && outer.maxY >= inner.maxY;
}

function circleBox(x: number, y: number, radius: number): Box {
  return { minX: x - radius, minY: y - radius, maxX: x + radius, maxY: y + radius };
}

/** The alpha of a CSS color, or null when the browser would reject it. */
function colorAlpha(color: string): number | null {
  const text = color.trim().toLowerCase();
  if (/nan|infinity|undefined|null/.test(text)) return null;
  if (text === 'transparent') return 0;
  const hex = /^#([0-9a-f]+)$/.exec(text);
  if (hex !== null) {
    const digits = hex[1];
    if (digits.length === 3 || digits.length === 6) return 1;
    if (digits.length === 4) return Number.parseInt(digits[3] + digits[3], 16) / 255;
    if (digits.length === 8) return Number.parseInt(digits.slice(6), 16) / 255;
    return null;
  }
  const fn = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\((.*)\)$/.exec(text);
  if (fn !== null) {
    const bySlash = fn[1].split('/');
    const byComma = fn[1].split(',');
    const alphaText = bySlash.length === 2 ? bySlash[1] : byComma.length === 4 ? byComma[3] : undefined;
    if (alphaText === undefined) return 1;
    const trimmed = alphaText.trim();
    const value = trimmed.endsWith('%') ? Number.parseFloat(trimmed) / 100 : Number.parseFloat(trimmed);
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;
  }
  return /^[a-z]+$/.test(text) ? 1 : null;
}

class RecordedGradient {
  readonly stops: Array<[number, number]> = [];

  constructor(readonly kind: 'linear' | 'radial' | 'conic', readonly args: number[]) {}

  addColorStop(offset: number, color: string): void {
    if (!(offset >= 0 && offset <= 1)) throw new RangeError(`addColorStop offset ${offset} is outside 0 to 1, which the browser rejects`);
    const alpha = colorAlpha(String(color));
    if (alpha === null) throw new SyntaxError(`addColorStop color "${color}" does not parse, which the browser rejects`);
    this.stops.push([offset, alpha]);
  }

  maxAlpha(): number {
    return Math.max(0, ...this.stops.map((stop) => stop[1]));
  }

  /** Where the gradient is not transparent, in the user space it was made in. */
  region(): Region {
    const sorted = [...this.stops].sort((a, b) => a[0] - b[0]);
    const visible = sorted.map((stop) => stop[1] > VISIBLE_ALPHA);
    const first = visible.indexOf(true);
    const last = visible.lastIndexOf(true);
    if (first === -1) return null;
    if (this.kind === 'radial') return this.radialRegion(sorted, last);
    if (this.kind === 'linear') return this.linearRegion(sorted, first, last);
    return 'all';
  }

  // A canvas gradient pads with its end colors, so only a transparent last stop bounds a radial one.
  private radialRegion(sorted: Array<[number, number]>, last: number): Region {
    if (last === sorted.length - 1) return 'all';
    const [x0, y0, r0, x1, y1, r1] = this.args;
    const reach = sorted[last + 1][0];
    const end = circleBox(x0 + (x1 - x0) * reach, y0 + (y1 - y0) * reach, r0 + (r1 - r0) * reach);
    return union(circleBox(x0, y0, r0), end);
  }

  // Only an axis-aligned linear gradient is bounded here. Any other angle counts as covering everything.
  private linearRegion(sorted: Array<[number, number]>, first: number, last: number): Region {
    const [x0, y0, x1, y1] = this.args;
    if (x0 === x1 && y0 === y1) return null;
    if (first === 0 && last === sorted.length - 1) return 'all';
    const start = first === 0 ? -Infinity : sorted[first - 1][0];
    const end = last === sorted.length - 1 ? Infinity : sorted[last + 1][0];
    if (y0 === y1) {
      const a = clampBig(x0 + (x1 - x0) * start);
      const b = clampBig(x0 + (x1 - x0) * end);
      return { minX: Math.min(a, b), maxX: Math.max(a, b), minY: -BIG, maxY: BIG };
    }
    if (x0 === x1) {
      const a = clampBig(y0 + (y1 - y0) * start);
      const b = clampBig(y0 + (y1 - y0) * end);
      return { minX: -BIG, maxX: BIG, minY: Math.min(a, b), maxY: Math.max(a, b) };
    }
    return 'all';
  }
}

interface DrawState {
  matrix: Matrix;
  clip: Box;
  globalAlpha: number;
  globalCompositeOperation: string;
  lineWidth: number;
  fillStyle: Style;
  strokeStyle: Style;
  shadowBlur: number;
  shadowColor: string;
  shadowOffsetX: number;
  shadowOffsetY: number;
  filter: string;
}

/** Shared by a surface and every layer made from it, so issues and paint counts gather in one place. */
interface RecorderLog {
  issues: Set<string>;
  paints: number;
  layers: RecordingContext[];
}

interface ImageDataLike { width: number; height: number; data: Uint8ClampedArray }

class RecordedCanvas {
  readonly context: RecordingContext;

  constructor(readonly width: number, readonly height: number, log: RecorderLog) {
    this.context = new RecordingContext(this, log);
  }
}

/** A 2D context that records the bounds of what it paints, in device pixels, instead of drawing. */
class RecordingContext {
  /** The bounds of everything this canvas shows, or null while it is empty. */
  content: Box | null = null;
  lineCap = 'butt';
  lineJoin = 'miter';
  miterLimit = 10;
  lineDashOffset = 0;
  imageSmoothingEnabled = true;
  imageSmoothingQuality = 'low';
  private state: DrawState = {
    matrix: [DEVICE_SCALE, 0, 0, DEVICE_SCALE, 0, 0],
    clip: EVERYWHERE,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    lineWidth: 1,
    fillStyle: '#000',
    strokeStyle: '#000',
    shadowBlur: 0,
    shadowColor: 'rgba(0, 0, 0, 0)',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    filter: 'none',
  };
  private readonly stack: DrawState[] = [];
  private path: Box | null = null;

  constructor(readonly canvas: RecordedCanvas, private readonly log: RecorderLog) {}

  get depth(): number { return this.stack.length; }

  get globalAlpha(): number { return this.state.globalAlpha; }
  set globalAlpha(value: number) {
    if (!(value >= 0 && value <= 1)) {
      this.issue(`sets globalAlpha to ${value}, which the browser ignores`);
      return;
    }
    this.state.globalAlpha = value;
  }

  get globalCompositeOperation(): string { return this.state.globalCompositeOperation; }
  set globalCompositeOperation(value: string) {
    if (!UNION_OPS.has(value) && !OTHER_OPS.has(value)) {
      this.issue(`sets globalCompositeOperation to "${value}", which the browser ignores`);
      return;
    }
    this.state.globalCompositeOperation = value;
  }

  get lineWidth(): number { return this.state.lineWidth; }
  set lineWidth(value: number) {
    if (!(value > 0 && Number.isFinite(value))) {
      this.issue(`sets lineWidth to ${value}, which the browser ignores`);
      return;
    }
    this.state.lineWidth = value;
  }

  get fillStyle(): Style { return this.state.fillStyle; }
  set fillStyle(value: Style) { this.setStyle('fillStyle', value); }

  get strokeStyle(): Style { return this.state.strokeStyle; }
  set strokeStyle(value: Style) { this.setStyle('strokeStyle', value); }

  get shadowBlur(): number { return this.state.shadowBlur; }
  set shadowBlur(value: number) {
    if (!(value >= 0 && Number.isFinite(value))) {
      this.issue(`sets shadowBlur to ${value}, which the browser ignores`);
      return;
    }
    this.state.shadowBlur = value;
  }

  get shadowColor(): string { return this.state.shadowColor; }
  set shadowColor(value: string) {
    if (colorAlpha(String(value)) === null) {
      this.issue(`sets an invalid shadowColor "${value}", which the browser ignores`);
      return;
    }
    this.state.shadowColor = String(value);
  }

  get shadowOffsetX(): number { return this.state.shadowOffsetX; }
  set shadowOffsetX(value: number) { this.setFinite('shadowOffsetX', value); }

  get shadowOffsetY(): number { return this.state.shadowOffsetY; }
  set shadowOffsetY(value: number) { this.setFinite('shadowOffsetY', value); }

  get filter(): string { return this.state.filter; }
  set filter(value: string) { this.state.filter = String(value); }

  save(): void { this.stack.push({ ...this.state }); }

  restore(): void {
    const top = this.stack.pop();
    if (top !== undefined) this.state = top;
  }

  translate(x: number, y: number): void { this.transform(1, 0, 0, 1, x, y); }
  scale(x: number, y: number): void { this.transform(x, 0, 0, y, 0, 0); }
  rotate(angle: number): void { this.transform(Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0); }

  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    if (![a, b, c, d, e, f].every(Number.isFinite)) {
      this.issue('passes a non-finite value to a transform, which the browser ignores');
      return;
    }
    this.state.matrix = multiply(this.state.matrix, [a, b, c, d, e, f]);
  }

  setTransform(...args: number[]): void {
    this.issue('calls setTransform, which drops the device pixel scale');
    this.state.matrix = args.length === 6 ? [args[0], args[1], args[2], args[3], args[4], args[5]] : [1, 0, 0, 1, 0, 0];
  }

  resetTransform(): void {
    this.issue('calls resetTransform, which drops the device pixel scale');
    this.state.matrix = [1, 0, 0, 1, 0, 0];
  }

  getTransform(): { a: number; b: number; c: number; d: number; e: number; f: number } {
    const [a, b, c, d, e, f] = this.state.matrix;
    return { a, b, c, d, e, f };
  }

  setLineDash(): void { /* A dash only removes parts of a stroke. */ }
  getLineDash(): number[] { return []; }

  beginPath(): void { this.path = null; }
  closePath(): void { /* Closing joins points already in the path. */ }
  moveTo(x: number, y: number): void { this.addPoint('moveTo', x, y); }
  lineTo(x: number, y: number): void { this.addPoint('lineTo', x, y); }

  arc(x: number, y: number, radius: number): void {
    if (radius < 0) throw new RangeError(`arc radius ${radius} is negative, which the browser rejects`);
    this.addPoint('arc', x, y, radius);
  }

  ellipse(x: number, y: number, radiusX: number, radiusY: number): void {
    if (radiusX < 0 || radiusY < 0) throw new RangeError(`ellipse radius ${radiusX}, ${radiusY} is negative, which the browser rejects`);
    this.addPoint('ellipse', x, y, Math.max(radiusX, radiusY));
  }

  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void {
    if (radius < 0) throw new RangeError(`arcTo radius ${radius} is negative, which the browser rejects`);
    this.addPoint('arcTo', x1, y1);
    this.addPoint('arcTo', x2, y2);
  }

  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    this.addPoint('quadraticCurveTo', cx, cy);
    this.addPoint('quadraticCurveTo', x, y);
  }

  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    this.addPoint('bezierCurveTo', c1x, c1y);
    this.addPoint('bezierCurveTo', c2x, c2y);
    this.addPoint('bezierCurveTo', x, y);
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.addPoint('rect', x, y);
    this.addPoint('rect', x + w, y + h);
    this.addPoint('rect', x + w, y);
    this.addPoint('rect', x, y + h);
  }

  roundRect(x: number, y: number, w: number, h: number): void { this.rect(x, y, w, h); }

  fill(): void { this.paint(this.path, this.state.fillStyle, 0); }
  stroke(): void { this.paint(this.path, this.state.strokeStyle, (this.state.lineWidth / 2) * scaleOf(this.state.matrix)); }

  clip(): void {
    this.state.clip = intersect(this.state.clip, this.path) ?? NOWHERE;
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.paint(this.rectBox('fillRect', x, y, w, h), this.state.fillStyle, 0);
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    this.paint(this.rectBox('strokeRect', x, y, w, h), this.state.strokeStyle, (this.state.lineWidth / 2) * scaleOf(this.state.matrix));
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    const cleared = this.rectBox('clearRect', x, y, w, h);
    if (this.content !== null && cleared !== null && covers(cleared, this.content)) this.content = null;
  }

  createLinearGradient(x0: number, y0: number, x1: number, y1: number): RecordedGradient {
    this.requireFinite('createLinearGradient', [x0, y0, x1, y1]);
    return new RecordedGradient('linear', [x0, y0, x1, y1]);
  }

  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): RecordedGradient {
    this.requireFinite('createRadialGradient', [x0, y0, r0, x1, y1, r1]);
    if (r0 < 0 || r1 < 0) throw new RangeError(`createRadialGradient radius ${r0}, ${r1} is negative, which the browser rejects`);
    return new RecordedGradient('radial', [x0, y0, r0, x1, y1, r1]);
  }

  createConicGradient(angle: number, x: number, y: number): RecordedGradient {
    this.requireFinite('createConicGradient', [angle, x, y]);
    return new RecordedGradient('conic', [angle, x, y]);
  }

  drawImage(image: unknown, ...numbers: number[]): void {
    this.log.paints += 1;
    if (!(image instanceof RecordedCanvas)) throw new TypeError('drawImage takes only a canvas made by frame.createLayer');
    if (!numbers.every(Number.isFinite)) {
      this.issue('passes a non-finite value to drawImage, which the browser ignores');
      return;
    }
    let source: [number, number, number, number] = [0, 0, image.width, image.height];
    let target: [number, number, number, number];
    if (numbers.length === 2) target = [numbers[0], numbers[1], image.width, image.height];
    else if (numbers.length === 4) target = [numbers[0], numbers[1], numbers[2], numbers[3]];
    else if (numbers.length === 8) {
      source = [numbers[0], numbers[1], numbers[2], numbers[3]];
      target = [numbers[4], numbers[5], numbers[6], numbers[7]];
    } else throw new TypeError('drawImage takes 3, 5 or 9 arguments');
    const [sx, sy, sw, sh] = source;
    const [dx, dy, dw, dh] = target;
    const shown = intersect(image.context.content, { minX: sx, minY: sy, maxX: sx + sw, maxY: sy + sh });
    if (shown === null || sw === 0 || sh === 0) return;
    const xs = [dx + ((shown.minX - sx) * dw) / sw, dx + ((shown.maxX - sx) * dw) / sw];
    const ys = [dy + ((shown.minY - sy) * dh) / sh, dy + ((shown.maxY - sy) * dh) / sh];
    const placed = transformBox({ minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }, this.state.matrix);
    this.composite(intersect(this.spread(placed), this.state.clip), this.state.globalAlpha > VISIBLE_ALPHA);
  }

  createImageData(width: number | ImageDataLike, height?: number): ImageDataLike {
    const w = typeof width === 'number' ? width : width.width;
    const h = typeof width === 'number' ? (height ?? 0) : width.height;
    if (!(w >= 1 && h >= 1 && Number.isFinite(w * h))) throw new RangeError(`createImageData size ${w} by ${h} is not a positive size, which the browser rejects`);
    return { width: Math.round(w), height: Math.round(h), data: new Uint8ClampedArray(Math.round(w) * Math.round(h) * 4) };
  }

  // putImageData writes device pixels and ignores the transform, the clip and compositing.
  putImageData(image: ImageDataLike, dx: number, dy: number): void {
    this.log.paints += 1;
    let shown: Box | null = null;
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        if (image.data[(y * image.width + x) * 4 + 3] === 0) continue;
        shown = union(shown, { minX: dx + x, minY: dy + y, maxX: dx + x + 1, maxY: dy + y + 1 });
      }
    }
    this.content = union(this.content, shown);
  }

  getImageData(): never { throw new Error('reads pixels with getImageData, which stalls the GPU every frame'); }
  fillText(): never { throw new Error('draws text, which the contract rules out'); }
  strokeText(): never { throw new Error('draws text, which the contract rules out'); }
  measureText(): never { throw new Error('measures text, which the contract rules out'); }
  createPattern(): never { throw new Error('makes a pattern, which needs an image the contract rules out'); }

  private issue(message: string): void { this.log.issues.add(message); }

  private setStyle(key: 'fillStyle' | 'strokeStyle', value: Style): void {
    if (typeof value === 'string' ? colorAlpha(value) === null : !(value instanceof RecordedGradient)) {
      this.issue(`sets an invalid ${key} "${typeof value === 'string' ? value : typeof value}", which the browser ignores`);
      return;
    }
    this.state[key] = value;
  }

  private setFinite(key: 'shadowOffsetX' | 'shadowOffsetY', value: number): void {
    if (!Number.isFinite(value)) {
      this.issue(`sets ${key} to ${value}, which the browser ignores`);
      return;
    }
    this.state[key] = value;
  }

  private requireFinite(name: string, values: number[]): void {
    if (!values.every(Number.isFinite)) throw new TypeError(`${name} got a non-finite value, which the browser rejects`);
  }

  private addPoint(name: string, x: number, y: number, radius = 0): void {
    if (![x, y, radius].every(Number.isFinite)) {
      this.issue(`passes a non-finite value to ${name}, which the browser ignores`);
      return;
    }
    const m = this.state.matrix;
    const reach = radius * scaleOf(m);
    const px = m[0] * x + m[2] * y + m[4];
    const py = m[1] * x + m[3] * y + m[5];
    this.path = union(this.path, circleBox(px, py, reach));
  }

  private rectBox(name: string, x: number, y: number, w: number, h: number): Box | null {
    if (![x, y, w, h].every(Number.isFinite)) {
      this.issue(`passes a non-finite value to ${name}, which the browser ignores`);
      return null;
    }
    return transformBox({ minX: Math.min(x, x + w), minY: Math.min(y, y + h), maxX: Math.max(x, x + w), maxY: Math.max(y, y + h) }, this.state.matrix);
  }

  private paint(shape: Box | null, style: Style, strokeReach: number): void {
    this.log.paints += 1;
    if (shape === null) return;
    const styleAlpha = typeof style === 'string' ? (colorAlpha(style) ?? 0) : style.maxAlpha();
    const visible = this.state.globalAlpha * styleAlpha > VISIBLE_ALPHA;
    const styleRegion = typeof style === 'string' ? (visible ? 'all' : null) : style.region();
    let region = widen(shape, strokeReach);
    if (styleRegion === null) region = null;
    else if (styleRegion !== 'all') region = intersect(region, transformBox(styleRegion, this.state.matrix));
    this.composite(intersect(this.spread(region), this.state.clip), visible);
  }

  // Shadow and blur lengths are taken as CSS pixels, the larger reading, so the bound holds at any device scale.
  private spread(region: Box | null): Box | null {
    let reach = 0;
    const { shadowBlur, shadowOffsetX, shadowOffsetY, filter } = this.state;
    if ((colorAlpha(this.state.shadowColor) ?? 0) > VISIBLE_ALPHA && (shadowBlur > 0 || shadowOffsetX !== 0 || shadowOffsetY !== 0)) {
      reach += (1.25 * shadowBlur + Math.max(Math.abs(shadowOffsetX), Math.abs(shadowOffsetY))) * DEVICE_SCALE;
    }
    for (const match of filter.matchAll(/blur\(\s*([\d.]+)px\s*\)/g)) reach += 2.5 * Number(match[1]) * DEVICE_SCALE;
    for (const match of filter.matchAll(/drop-shadow\(([^)]*)\)/g)) {
      const lengths = [...match[1].matchAll(/(-?[\d.]+)px/g)].map((length) => Math.abs(Number(length[1])));
      reach += (Math.max(0, lengths[0] ?? 0, lengths[1] ?? 0) + 2.5 * (lengths[2] ?? 0)) * DEVICE_SCALE;
    }
    return widen(region, reach);
  }

  // The bound of what shows after a paint, by how its compositing mode combines it with what is there.
  private composite(region: Box | null, visible: boolean): void {
    const op = this.state.globalCompositeOperation;
    const clipped = this.state.clip !== EVERYWHERE;
    if (UNION_OPS.has(op)) {
      if (visible) this.content = union(this.content, region);
      return;
    }
    if (op === 'destination-out' || op === 'source-atop') return;
    if (clipped) {
      this.content = union(this.content, visible ? region : null);
      return;
    }
    if (op === 'destination-in' || op === 'source-in') {
      this.content = visible ? intersect(this.content, region) : null;
      return;
    }
    this.content = visible ? region : null;
  }
}

function createSurface(width: number, height: number, log: RecorderLog = { issues: new Set(), paints: 0, layers: [] }): {
  ctx: RecordingContext;
  log: RecorderLog;
  createLayer: (layerWidth: number, layerHeight: number) => { canvas: RecordedCanvas; ctx: RecordingContext };
} {
  const canvas = new RecordedCanvas(Math.round(width * DEVICE_SCALE), Math.round(height * DEVICE_SCALE), log);
  const createLayer = (layerWidth: number, layerHeight: number): { canvas: RecordedCanvas; ctx: RecordingContext } => {
    if (!(layerWidth > 0 && layerHeight > 0 && Number.isFinite(layerWidth * layerHeight))) {
      throw new RangeError(`createLayer size ${layerWidth} by ${layerHeight} is not a positive size`);
    }
    const layer = new RecordedCanvas(Math.max(1, Math.round(layerWidth * DEVICE_SCALE)), Math.max(1, Math.round(layerHeight * DEVICE_SCALE)), log);
    log.layers.push(layer.context);
    return { canvas: layer, ctx: layer.context };
  };
  return { ctx: canvas.context, log, createLayer };
}

const PALETTES = {
  dark: {
    accent: { r: 124, g: 156, b: 255 },
    strong: { r: 165, g: 190, b: 255 },
    surface: { r: 19, g: 25, b: 39 },
    text: { r: 230, g: 236, b: 246 },
  },
  light: {
    accent: { r: 57, g: 85, b: 200 },
    strong: { r: 42, g: 63, b: 161 },
    surface: { r: 255, g: 255, b: 255 },
    text: { r: 21, g: 32, b: 58 },
  },
} as const;
type Theme = keyof typeof PALETTES;

// The desktop box, the phone strip, and shapes on either side of them.
const SIZES: Array<[number, number]> = [[417, 196], [358, 72], [320, 160], [160, 320], [200, 200], [1100, 260]];
// Frame gaps from a fast screen to a slow device, starting at the 0 a resumed animation draws first.
const DT_CYCLE = [0, 1 / 60, 1 / 60, 1 / 30, 1 / 144, 1 / 60, 0.1, 1 / 60, 1 / 120];

/** A kick every half second, a melody that wanders across the middle bands, and hats between kicks. */
function musicLevels(t: number): Float32Array {
  const values = new Float32Array(BAND_COUNT);
  const kick = Math.exp(-(t % 0.5) * 9);
  const hat = Math.exp(-((t + 0.125) % 0.25) * 24);
  const center = 7 + 3 * Math.sin(t * 0.9);
  for (let band = 0; band < BAND_COUNT; band++) {
    const bass = band < 4 ? kick * (1 - band * 0.12) : 0;
    const melody = 0.75 * Math.exp(-(((band - center) / 2) ** 2));
    const treble = band >= 11 ? hat * 0.7 : 0;
    const floor = 0.22 + 0.08 * Math.sin(t * 3.1 + band);
    values[band] = Math.min(1, Math.max(0, floor + bass + melody + treble));
  }
  return values;
}

interface Step { size: [number, number]; values: Float32Array; dt: number; theme: Theme; reducedMotion: boolean }

interface FrameResult { busy: boolean; atRest: boolean; content: Box | null; area: Box }

interface Run {
  plugin: { draw: (ctx: unknown, frame: unknown) => unknown };
  state: Record<string, unknown>;
  smoother: ReturnType<typeof createSmoother>;
  log: RecorderLog;
  failures: string[];
}

// The levels pass through the host's own smoother, so values, held peaks and rest match what a mode meets.
function drawFrame(run: Run, size: [number, number], targets: Float32Array, dt: number, theme: Theme, reducedMotion: boolean): FrameResult {
  const [width, height] = size;
  const pad = Math.min(width, height) * PAD_RATIO;
  const atRest = run.smoother.step(targets, dt);
  const { values, peaks } = run.smoother;
  const { ctx, createLayer } = createSurface(width, height, run.log);
  const depths = run.log.layers.map((layer) => layer.depth);
  run.log.paints = 0;
  const frame = {
    width,
    height,
    pad,
    values,
    peaks,
    ...levelSummary(values),
    palette: PALETTES[theme],
    theme,
    dtSeconds: dt,
    reducedMotion,
    state: run.state,
    createLayer,
  };
  const returned = run.plugin.draw(ctx, frame);
  if (ctx.depth !== 0) run.log.issues.add('calls save() without a matching restore()');
  if (run.log.layers.some((layer, i) => layer.depth !== (depths[i] ?? 0))) run.log.issues.add('leaves save() open on a layer');
  if (run.log.paints > MAX_PAINTS_PER_FRAME) run.log.issues.add(`makes ${run.log.paints} paint calls in one frame, over the ${MAX_PAINTS_PER_FRAME} limit`);
  const area = {
    minX: pad * DEVICE_SCALE - TOLERANCE_PX,
    minY: pad * DEVICE_SCALE - TOLERANCE_PX,
    maxX: (width - pad) * DEVICE_SCALE + TOLERANCE_PX,
    maxY: (height - pad) * DEVICE_SCALE + TOLERANCE_PX,
  };
  return { busy: returned === true, atRest, content: ctx.content, area };
}

function describeOverflow(content: Box, size: [number, number], pad: number): string {
  const css = (value: number): string => (value / DEVICE_SCALE).toFixed(1);
  return `painted x ${css(content.minX)} to ${css(content.maxX)}, y ${css(content.minY)} to ${css(content.maxY)}, ` +
    `outside x ${pad.toFixed(1)} to ${(size[0] - pad).toFixed(1)}, y ${pad.toFixed(1)} to ${(size[1] - pad).toFixed(1)}`;
}

function newRun(plugin: Run['plugin'], failures: string[]): Run {
  return { plugin, state: {}, smoother: createSmoother(BAND_COUNT), log: { issues: new Set(), paints: 0, layers: [] }, failures };
}

/** Runs frames until the first failure, so one fault reports once with the frame that showed it. */
function runBounded(run: Run, name: string, frames: Step[]): void {
  for (const [index, step] of frames.entries()) {
    const result = drawFrame(run, step.size, step.values, step.dt, step.theme, step.reducedMotion);
    if (result.content !== null && !covers(result.area, result.content)) {
      const pad = Math.min(...step.size) * PAD_RATIO;
      run.failures.push(`${name}, ${step.size[0]}x${step.size[1]} frame ${index}: ${describeOverflow(result.content, step.size, pad)}`);
      return;
    }
  }
}

function musicFrames(sizes: Array<[number, number]>, framesPerSize: number, reducedMotion: boolean): Step[] {
  const frames: Step[] = [];
  let t = 0;
  for (const [sizeIndex, size] of sizes.entries()) {
    for (let i = 0; i < framesPerSize; i++) {
      const dt = reducedMotion ? 1 / 15 : DT_CYCLE[(sizeIndex * framesPerSize + i) % DT_CYCLE.length];
      t += dt;
      frames.push({ size, values: musicLevels(t), dt, theme: sizeIndex % 2 === 0 ? 'dark' : 'light', reducedMotion });
    }
  }
  return frames;
}

function checkSilence(run: Run): void {
  for (let i = 0; i < 30; i++) {
    const result = drawFrame(run, [417, 196], new Float32Array(BAND_COUNT), DT_CYCLE[i % DT_CYCLE.length], 'dark', false);
    if (result.content !== null) {
      run.failures.push('silence: shows something before any music plays');
      return;
    }
    if (result.busy) {
      run.failures.push('silence: returns true before any music plays, so the animation never sleeps');
      return;
    }
  }
}

// The host stops drawing once the levels rest and draw returns nothing, so the last frame stays on screen.
function checkRelease(run: Run): void {
  const size: [number, number] = [417, 196];
  let t = 0;
  for (let i = 0; i < 180; i++) {
    t += 1 / 60;
    drawFrame(run, size, musicLevels(t), 1 / 60, 'dark', false);
  }
  for (let i = 1; i <= 300; i++) {
    const quietFor = i / 60;
    const result = drawFrame(run, size, new Float32Array(BAND_COUNT), 1 / 60, 'dark', false);
    if (result.atRest && result.content !== null && !result.busy) {
      run.failures.push(`release: shows something ${quietFor.toFixed(2)} s after the music stops without returning true, so it would freeze on screen`);
      return;
    }
    if (quietFor > RELEASE_LIMIT_S && (result.content !== null || result.busy)) {
      run.failures.push(`release: still shows something or returns true ${RELEASE_LIMIT_S} s after the music stops`);
      return;
    }
  }
}

/** Every way a plugin module's default export breaks the contract, or an empty list. */
export function checkVisualizer(plugin: unknown): string[] {
  const failures: string[] = [];
  const candidate = plugin as { label?: unknown; draw?: unknown } | null | undefined;
  if (typeof candidate?.label !== 'string' || candidate.label.trim() === '' || candidate.label.length > MAX_LABEL_LENGTH) {
    failures.push(`default export: label must be a title of 1 to ${MAX_LABEL_LENGTH} characters`);
  }
  if (typeof candidate?.draw !== 'function') {
    failures.push('default export: draw must be a function');
    return failures;
  }
  const subject = candidate as Run['plugin'];
  const scenarios: Array<[string, (run: Run) => void]> = [
    ['music', (run) => { runBounded(run, 'music', musicFrames(SIZES, 150, false)); }],
    ['reduced motion', (run) => { runBounded(run, 'reduced motion', musicFrames([[417, 196], [358, 72]], 60, true)); }],
    ['full level', (run) => {
      const full = new Float32Array(BAND_COUNT).fill(1);
      runBounded(run, 'full level', SIZES.flatMap((size) => Array.from({ length: 60 }, () => ({ size, values: full, dt: 1 / 60, theme: 'dark' as Theme, reducedMotion: false }))));
    }],
    // Alternating loud and silent frames fire beats as often as the detector allows.
    ['beats', (run) => {
      const loud = new Float32Array(BAND_COUNT).fill(1);
      const quiet = new Float32Array(BAND_COUNT);
      runBounded(run, 'beats', Array.from({ length: 240 }, (_, i) => ({ size: [320, 160] as [number, number], values: i % 6 < 3 ? loud : quiet, dt: 1 / 60, theme: 'dark' as Theme, reducedMotion: false })));
    }],
    ['silence', checkSilence],
    ['release', checkRelease],
  ];
  for (const [name, scenario] of scenarios) {
    const run = newRun(subject, failures);
    try {
      scenario(run);
    } catch (err) {
      failures.push(`${name}: draw threw ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
    }
    for (const issue of run.log.issues) failures.push(`${name}: ${issue}`);
  }
  return [...new Set(failures)];
}

/** Rules a plugin's source text must follow, with its comments removed first. */
export function checkVisualizerSource(source: string): string[] {
  const failures: string[] = [];
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const globals = /\b(window|document|navigator|localStorage|sessionStorage|requestAnimationFrame|getComputedStyle|matchMedia|fetch|performance|Date|setTimeout|setInterval|console)\b/.exec(code);
  if (globals !== null) failures.push(`source: uses the browser global ${globals[1]}`);
  const constructors = /\bnew\s+(ImageData|Image|OffscreenCanvas|Path2D|Worker)\b/.exec(code);
  if (constructors !== null) failures.push(`source: constructs ${constructors[1]}, which the contract rules out`);
  for (const match of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm)) {
    if (match[1] !== '../visualizer-kit.js') failures.push(`source: imports ${match[1]}, but only ../visualizer-kit.js is allowed`);
  }
  if (!/\bexport\s+default\b/.test(code)) failures.push('source: has no default export');
  return failures;
}
