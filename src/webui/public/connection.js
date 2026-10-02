// The SSE stream and its status indicator. The server sets the retry interval,
// and EventSource reconnects on its own.

const conn = document.querySelector('.conn');
const connLabel = conn.querySelector('.conn-label');
const CONN_LABELS = { connecting: 'Connecting…', connected: 'Live', disconnected: 'Offline' };

let eventSource = null;
// Set when the remote closes the stream on purpose, so a late error keeps the terminal state.
let stopped = false;

export function setConnState(state) {
  conn.dataset.state = state;
  connLabel.textContent = CONN_LABELS[state];
}

export function connect({ onOpen, onSnapshot }) {
  setConnState('connecting');
  eventSource = new EventSource('/api/events');
  eventSource.onopen = () => {
    onOpen();
    if (!stopped) setConnState('connected');
  };
  eventSource.onerror = () => {
    if (stopped) return;
    // EventSource sits in CONNECTING while it retries, so only CLOSED means it gave up.
    setConnState(eventSource.readyState === EventSource.CLOSED ? 'disconnected' : 'connecting');
  };
  eventSource.addEventListener('snapshot', (ev) => {
    let data = null;
    try {
      data = JSON.parse(ev.data);
    } catch (err) {
      console.warn('webui: bad snapshot', err);
      return;
    }
    onSnapshot(data);
  });
}

export function stopConnection() {
  stopped = true;
  if (eventSource === null) return;
  eventSource.close();
  eventSource = null;
}
