import { resample, rgba } from '../visualizer-kit.js';

const BAR_COUNT = 28;

/** Mirrored bars around the center line, with held peaks. */
function draw(ctx, frame) {
  const { width, height, pad, palette } = frame;
  const step = (width - 2 * pad) / BAR_COUNT;
  const barWidth = step * 0.55;
  const middle = height / 2;
  // A round cap reaches half the bar width past the line's end, so the line stops short by that much.
  const maxHalf = middle - pad - barWidth / 2;
  const heights = resample(frame.values, BAR_COUNT);
  const peaks = resample(frame.peaks, BAR_COUNT);

  const gradient = ctx.createLinearGradient(0, pad, 0, height - pad);
  gradient.addColorStop(0, rgba(palette.strong, 0.85));
  gradient.addColorStop(0.5, rgba(palette.accent, 1));
  gradient.addColorStop(1, rgba(palette.strong, 0.85));
  ctx.lineCap = 'round';
  ctx.lineWidth = barWidth;
  ctx.strokeStyle = gradient;
  ctx.beginPath();
  for (let i = 0; i < BAR_COUNT; i++) {
    const half = heights[i] * maxHalf;
    if (half < 1) continue;
    const x = pad + step * (i + 0.5);
    ctx.moveTo(x, middle - half);
    ctx.lineTo(x, middle + half);
  }
  ctx.stroke();

  ctx.fillStyle = rgba(palette.strong, 0.55);
  ctx.beginPath();
  for (let i = 0; i < BAR_COUNT; i++) {
    const half = peaks[i] * maxHalf;
    if (half < 2) continue;
    const x = pad + step * (i + 0.5);
    for (const y of [middle - half, middle + half]) {
      ctx.moveTo(x + barWidth * 0.3, y);
      ctx.arc(x, y, barWidth * 0.3, 0, Math.PI * 2);
    }
  }
  ctx.fill();
}

export default { label: 'Spectrum bars', draw };
