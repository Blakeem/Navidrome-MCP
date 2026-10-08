// The template for a visualizer mode. Copy it to visualizers/<id>.js, where the id holds lowercase letters,
// digits and dashes. The server lists every such file, and a name that starts with _ stays out of the cycle.
//
// Contract
// - Export default { label, draw }. The label is the style's short title.
// - draw(ctx, frame) runs once per animation frame. ctx belongs to this mode alone. It arrives cleared and
//   transparent in CSS pixel units, and the host undoes every state change after the call.
// - Draw only inside the padded area, x from pad to width - pad and y from pad to height - pad. Line widths,
//   glow from shadowBlur or a blur filter, and everything a layer carries count toward that limit.
// - Paint no background, since the card shows through the canvas and a filled box breaks the illusion.
// - Silence shows nothing. Values at rest sit under 0.002 rather than at 0, so tie what shows to the levels.
//   Return true while anything still shows after the levels fall, such as fading trails, so the host keeps
//   drawing until it is gone. Return nothing otherwise.
// - Keep everything that persists in frame.state, which belongs to this mode for the life of the page.
// - Advance motion by frame.dtSeconds, so it runs at the same speed at any frame rate. Under
//   frame.reducedMotion, stop every motion that does not come from the levels.
// - Import only from '../visualizer-kit.js', use no browser global and draw no text. Make offscreen canvases
//   with frame.createLayer. Never call setTransform or resetTransform, since ctx carries the device pixel scale.
//
// frame
//   width, height   the area in CSS pixels
//   pad             the inset kept empty on every side
//   values, peaks   16 band heights from 0 to 1, bass first, and their held peaks
//   energy, bass    the average of all bands and of the lowest four
//   palette         { accent, strong, surface, text } as { r, g, b }, from the page theme
//   theme           'dark' or 'light'
//   dtSeconds       seconds since the last draw, from 0 to 0.1
//   reducedMotion   true when the viewer asked for reduced motion
//   state           this mode's own object
//   createLayer     (width, height) => { canvas, ctx }, an offscreen canvas at device density in CSS pixel units

import { resample, rgba } from '../visualizer-kit.js';

const DOTS = 24;

/** A row of dots that grow with the spectrum and bob slowly. */
function draw(ctx, frame) {
  const { width, height, pad, palette, state } = frame;
  const levels = resample(frame.values, DOTS);
  const step = (width - 2 * pad) / DOTS;
  const maxRadius = Math.min(step / 2, height / 2 - pad);
  if (!frame.reducedMotion) state.phase = ((state.phase ?? 0) + frame.dtSeconds * 2) % (Math.PI * 2);
  const phase = state.phase ?? 0;

  ctx.fillStyle = rgba(palette.accent, 0.9);
  ctx.beginPath();
  for (let i = 0; i < DOTS; i++) {
    const radius = levels[i] * maxRadius;
    if (radius < 0.5) continue;
    const x = pad + step * (i + 0.5);
    // Half the room left above and below the dot, so the bob never carries it past the pad.
    const bob = (height / 2 - pad - radius) / 2;
    const y = height / 2 + Math.sin(phase + i * 0.5) * bob;
    ctx.moveTo(x + radius, y);
    ctx.arc(x, y, radius, 0, Math.PI * 2);
  }
  ctx.fill();
}

export default { label: 'Template dots', draw };
