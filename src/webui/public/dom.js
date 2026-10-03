// DOM helpers shared by the web remote modules.

const SVG_NS = 'http://www.w3.org/2000/svg';

export const ICON_PLAY = 'M8 5v14l11-7z';

export function byId(id) {
  return document.getElementById(id);
}

// Some browsers set the `hidden` property on an SVG element without its attribute,
// so the attribute is written directly and `svg[hidden]` in styles.css matches.
export function setHidden(el, hide) {
  if (hide) el.setAttribute('hidden', '');
  else el.removeAttribute('hidden');
}

export function setProgressVar(el, percent) {
  const clamped = Math.max(0, Math.min(100, percent));
  el.style.setProperty('--progress', `${clamped}%`);
}

export function buildIcon(className, pathData) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const path = document.createElementNS(SVG_NS, 'path');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('d', pathData);
  svg.appendChild(path);
  return svg;
}
