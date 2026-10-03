// Lyrics lookups. A track's lyrics never change, so an answer is held for the life of the page.
// Only answers are cached, so a transient failure stays retryable.

import { getJson } from './api.js';

const cache = new Map();
const inFlight = new Map();

// Mirrors isAnswered in src/webui/routes/lyrics.ts, so a change to what counts as an answer edits both.
// The server holds a miss for 60 s only, since the track may become searchable, so the browser must ask again.
function isAnswered(dto) {
  return dto.hasSynced === true || typeof dto.unsynced === 'string' || dto.isInstrumental === true;
}

// One request per songId at a time, since a prefetch and an open of the same entry would race.
export function lyricsFor(songId) {
  const cached = cache.get(songId);
  if (cached !== undefined) return Promise.resolve(cached);
  const pending = inFlight.get(songId);
  if (pending !== undefined) return pending;

  // getJson never rejects, so the in-flight entry is always cleared.
  const request = getJson(`/api/lyrics/${encodeURIComponent(songId)}`).then((dto) => {
    inFlight.delete(songId);
    if (dto !== null && isAnswered(dto)) cache.set(songId, dto);
    return dto;
  });
  inFlight.set(songId, request);
  return request;
}
