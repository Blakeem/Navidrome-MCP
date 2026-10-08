import { resample, rgba } from '../visualizer-kit.js';

const POINTS = 64;
const STRANDS = 5;
const TWISTS = 1.5;
const LINE_WIDTH = 1.5;

/** Strands that twist along a ribbon, each as tall as the spectrum at its point, over a faint body. */
function draw(ctx, frame) {
  const { width, height, palette, state } = frame;
  // Each strand is centered on its path, so the ribbon keeps a line width clear of the pad.
  const inset = frame.pad + LINE_WIDTH;
  const middle = height / 2;
  const span = width - 2 * inset;
  const maxAmplitude = middle - inset;
  // Rounding puts the last angle a hair past pi, where sin is negative and its square root is NaN.
  const amplitudes = Array.from(
    resample(frame.values, POINTS),
    (value, i) => value * maxAmplitude * Math.max(0, Math.sin((Math.PI * i) / (POINTS - 1))) ** 0.5,
  );
  // Silence draws nothing, so a paused player shows an empty space.
  if (Math.max(...amplitudes) < 1) return;
  if (!frame.reducedMotion) state.phase = ((state.phase ?? 0) + frame.dtSeconds * (1.2 + 2 * frame.energy)) % (Math.PI * 2);
  const phase = state.phase ?? 0;
  const xAt = (i) => inset + (span * i) / (POINTS - 1);

  ctx.beginPath();
  amplitudes.forEach((amplitude, i) => { ctx.lineTo(xAt(i), middle - amplitude); });
  for (let i = POINTS - 1; i >= 0; i--) ctx.lineTo(xAt(i), middle + amplitudes[i]);
  ctx.closePath();
  ctx.fillStyle = rgba(palette.accent, 0.08);
  ctx.fill();

  ctx.lineWidth = LINE_WIDTH;
  for (let strand = 0; strand < STRANDS; strand++) {
    const offset = (strand / STRANDS) * Math.PI;
    ctx.strokeStyle = rgba(strand % 2 === 0 ? palette.accent : palette.strong, 0.35 + 0.6 * (strand / (STRANDS - 1)));
    ctx.beginPath();
    amplitudes.forEach((amplitude, i) => {
      const twist = Math.sin(phase + offset + (i / (POINTS - 1)) * TWISTS * Math.PI * 2);
      ctx.lineTo(xAt(i), middle + amplitude * twist);
    });
    ctx.stroke();
  }
}

export default { label: 'Wave ribbon', draw };
