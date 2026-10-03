// The latest SSE snapshot. app.js stores each one, and modules read it on demand.

const EMPTY_QUEUE = { items: [], length: 0 };

let current = { nowPlaying: null, queue: EMPTY_QUEUE, status: null, player: null };

export function storeSnapshot({ nowPlaying, queue, status, player }) {
  current = {
    nowPlaying: nowPlaying ?? null,
    queue: queue ?? EMPTY_QUEUE,
    status: status ?? null,
    player: player ?? current.player,
  };
  return current;
}

export function currentNowPlaying() {
  return current.nowPlaying;
}

// An idle or stopped engine has no current row, whatever queueIndex it last reported.
// mpv idles at queueIndex -1 after a clear or the end of the queue.
export function playingIndex(np) {
  return np !== null && np.engineRunning && typeof np.queueIndex === 'number' && np.queueIndex >= 0
    ? np.queueIndex
    : null;
}

// The now-playing snapshot carries no songId, so the cover art and the lyrics read it from the queue row.
export function queueSongId(index) {
  const item = (current.queue.items ?? []).find((it) => it.index === index);
  return item && item.songId ? item.songId : null;
}
