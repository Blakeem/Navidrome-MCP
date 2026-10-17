// `stillCurrent` is checked on load, so a replaced track's late image never sets has-art
// for the track that replaced it.
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
