// The server sets the retry interval and EventSource reconnects on its own,
// so this module holds no reconnect logic.

const conn = document.querySelector('.conn');
const connLabel = conn.querySelector('.conn-label');
const CONN_LABELS = { connecting: 'Connecting…', connected: 'Live', disconnected: 'Offline', evicted: 'Closed: stream limit' };

let eventSource = null;
// Set when the remote closes the stream on purpose, so a late error keeps the terminal state.
let stopped = false;

export function setConnState(state) {
  conn.dataset.state = state;
  connLabel.textContent = CONN_LABELS[state];
}

// EventSource gives up on a non-200 answer, such as the 401 after a session ends, so `onClosed`
// lets the page check why. The guest page reads its own stream through `url`, and `onEnded` receives
// the reason the server sends as the last event of an ended guest session.
export function connect({ url = '/api/events', onOpen, onSnapshot, onClosed, onEnded = null }) {
  // A new link opened in a live guest tab joins again, and its stream replaces the open one.
  eventSource?.close();
  stopped = false;
  setConnState('connecting');
  eventSource = new EventSource(url);
  eventSource.onopen = () => {
    onOpen();
    if (!stopped) setConnState('connected');
  };
  eventSource.onerror = () => {
    if (stopped) return;
    // EventSource sits in CONNECTING while it retries, so only CLOSED means it gave up.
    const closed = eventSource.readyState === EventSource.CLOSED;
    setConnState(closed ? 'disconnected' : 'connecting');
    if (closed) onClosed();
  };
  // The server closes the oldest stream of a session at its cap, or of a peer address in mode none, where
  // an `/api/visualizer` stream of another tab or device can close this one. A reconnect would evict the next
  // oldest stream, so this tab stays closed until the user reloads it.
  eventSource.addEventListener('evicted', () => {
    stopConnection();
    setConnState('evicted');
  });
  eventSource.addEventListener('snapshot', (ev) => {
    const data = parseEventData(ev, 'snapshot');
    if (data !== null) onSnapshot(data);
  });
  if (onEnded !== null) {
    // The stream closes right after this event, so the page stops it before the error that follows.
    eventSource.addEventListener('ended', (ev) => {
      stopConnection();
      onEnded(parseEventData(ev, 'ended')?.reason);
    });
  }
}

function parseEventData(ev, name) {
  try {
    return JSON.parse(ev.data);
  } catch (err) {
    console.warn(`webui: bad ${name} event`, err);
    return null;
  }
}

export function stopConnection() {
  stopped = true;
  if (eventSource === null) return;
  eventSource.close();
  eventSource = null;
}
