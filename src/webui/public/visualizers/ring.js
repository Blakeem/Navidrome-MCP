import { resample, rgba } from '../visualizer-kit.js';

const SPOKES_PER_SIDE = 24;

/** Spokes around a circle that swells with the bass, low bands at the top, mirrored left and right. */
function draw(ctx, frame) {
  const { width, height, pad, palette, state } = frame;
  const size = Math.min(width, height);
  const centerX = width / 2;
  const centerY = height / 2;
  const lineWidth = Math.max(1.5, size * 0.012);
  const outerLimit = size / 2 - pad - lineWidth / 2;
  const baseRadius = size * (0.2 + 0.03 * frame.bass);
  const maxLength = outerLimit - size * 0.23;
  const spokes = resample(frame.values, SPOKES_PER_SIDE);
  if (!frame.reducedMotion) state.angle = ((state.angle ?? 0) + frame.dtSeconds * 0.15) % (Math.PI * 2);
  const rotation = state.angle ?? 0;

  const glow = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, baseRadius);
  glow.addColorStop(0, rgba(palette.accent, 0.35 * frame.energy));
  glow.addColorStop(1, rgba(palette.accent, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(centerX, centerY, baseRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineCap = 'round';
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = rgba(palette.accent, 0.95);
  ctx.beginPath();
  for (let k = 0; k < SPOKES_PER_SIDE; k++) {
    const length = spokes[k] * maxLength;
    if (length < 1) continue;
    const sweep = ((k + 0.5) / SPOKES_PER_SIDE) * Math.PI;
    for (const angle of [-Math.PI / 2 + sweep + rotation, -Math.PI / 2 - sweep + rotation]) {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      ctx.moveTo(centerX + cos * baseRadius, centerY + sin * baseRadius);
      ctx.lineTo(centerX + cos * (baseRadius + length), centerY + sin * (baseRadius + length));
    }
  }
  ctx.stroke();
}

export default { label: 'Radial ring', draw };
