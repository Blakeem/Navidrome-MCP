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

export function queueSongId(index) {
  const item = (current.queue.items ?? []).find((it) => it.index === index);
  return item && item.songId ? item.songId : null;
}
