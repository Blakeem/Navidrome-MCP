const SVG_NS = 'http://www.w3.org/2000/svg';

export const ICON_PLAY = 'M8 5v14l11-7z';

export function byId(id) {
  return document.getElementById(id);
}

// An SVG element has no `hidden` property, so assigning one would not set the attribute.
// The attribute is written directly, and `svg[hidden]` in styles.css hides it.
export function setHidden(el, hide) {
  if (hide) el.setAttribute('hidden', '');
  else el.removeAttribute('hidden');
}

// The button holds an eye icon for each state, and the icon shown is the action the next click takes.
export function bindPasswordReveal(input, button) {
  const iconShow = button.querySelector('.icon-show');
  const iconHide = button.querySelector('.icon-hide');
  button.addEventListener('click', () => {
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    button.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
    setHidden(iconShow, reveal);
    setHidden(iconHide, !reveal);
  });
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
