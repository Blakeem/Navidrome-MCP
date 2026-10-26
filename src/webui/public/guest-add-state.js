// The rules behind each Add button on the guest page. They read no DOM, so vitest checks them directly.

// A request the server answered moves the queue before the snapshot that shows it arrives, so the
// button keeps the answer for this long or until a snapshot agrees.
export const ANSWER_GRACE_MS = 3000;

/** The server marks each waiting song, so these sets follow its duplicate rule. */
export function queuedSongs(items) {
  const mine = new Map();
  const others = new Set();
  for (const item of items) {
    if (item.mine === true && typeof item.entryId === 'number') mine.set(item.songId, item.entryId);
    else if (item.waiting === true) others.add(item.songId);
  }
  return { mine, others };
}

/**
 * One of `add`, `pending`, `added`, `removing` or `queued`. A request in flight wins, then an answer the
 * snapshot has not caught up with, then the snapshot.
 */
export function buttonState(songId, { pending, removing, answers, mine, others }) {
  if (removing.has(songId)) return 'removing';
  if (pending.has(songId)) return 'pending';
  const answer = answers.get(songId);
  if (answer !== undefined) return answer.added ? 'added' : 'add';
  if (mine.has(songId)) return 'added';
  return others.has(songId) ? 'queued' : 'add';
}

/** An answer leaves once the snapshot shows the same state, or once its grace runs out. */
export function answerSettled(songId, answer, mine, now) {
  return answer.added === mine.has(songId) || now - answer.at >= ANSWER_GRACE_MS;
}

/** The add rate's refusal carries its wait, so the page sends the song again by itself. Every other refusal is final. */
export function retryDelayMs(status, data) {
  return status === 429 && typeof data?.retryAfterMs === 'number' ? data.retryAfterMs : null;
}

/**
 * Sends the songs in `pending` in tap order, since the add rate refuses a burst. A refusal for the add
 * rate waits and sends the song again. A 401, or `isLive` turning false, ends the session's adds.
 */
export async function sendAdds(pending, { post, wait, isLive, onAnswer }) {
  while (pending.size > 0 && isLive()) {
    const [songId, song] = pending.entries().next().value;
    const answer = await post(songId);
    if (!isLive() || answer.status === 401) return;
    const retryMs = retryDelayMs(answer.status, answer.data);
    if (retryMs !== null) {
      await wait(retryMs);
      continue;
    }
    pending.delete(songId);
    onAnswer(song, answer);
  }
}
