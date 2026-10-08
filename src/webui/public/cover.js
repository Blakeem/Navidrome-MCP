// Swap the art inside one .cover box. `stillCurrent` is checked again on load,
// so a slow image for an already replaced track never paints over the new one.
export function mountCover(wrap, songId, stillCurrent) {
  const existing = wrap.querySelector('img');
  if (existing !== null) existing.remove();
  wrap.classList.remove('has-art');

  if (songId === null) return;

  const img = new Image();
  img.alt = '';
  img.src = `/api/cover/${encodeURIComponent(songId)}`;
  img.addEventListener('load', () => {
    if (stillCurrent()) wrap.classList.add('has-art');
  });
  img.addEventListener('error', () => {
    img.remove();
  });
  wrap.appendChild(img);
}
