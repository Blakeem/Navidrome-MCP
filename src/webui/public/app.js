// Navidrome MCP — Web UI client. Vanilla ES2020, no deps, no build step.
//
// Talks to the companion HTTP server hosted by the MCP process:
//   GET  /api/events           — Server-Sent Events stream of {nowPlaying, queue}
//   POST /api/controls/*       — pause/resume/next/previous/seek/volume
//   GET  /api/cover/:id        — proxied album art (signed server-side)
//   GET  /api/network-info     — bind/expose state + reachable URLs
//
// Reconnect interval is enforced by the server (retry: 10000). The browser's
// EventSource implementation handles the reconnect itself.

(() => {
  'use strict';

  // ---------- DOM handles ----------
  const $ = (id) => document.getElementById(id);
  const els = {
    conn: document.querySelector('.conn'),
    coverWrap: $('cover'),
    badge: $('state-badge'),
    title: $('track-title'),
    artist: $('track-artist'),
    album: $('track-album'),
    queuePos: $('queue-pos'),
    seek: $('seek-slider'),
    position: $('position-label'),
    duration: $('duration-label'),
    btnPlay: $('btn-play-pause'),
    btnPrev: $('btn-prev'),
    btnNext: $('btn-next'),
    iconPlay: $('icon-play'),
    iconPause: $('icon-pause'),
    btnMute: $('btn-mute'),
    iconVolHigh: $('icon-vol-high'),
    iconVolMid: $('icon-vol-mid'),
    iconVolLow: $('icon-vol-low'),
    iconVolMute: $('icon-vol-mute'),
    volume: $('volume-slider'),
    volumeLabel: $('volume-label'),
    queueList: $('queue-list'),
    queueCount: $('queue-count'),
    openNetwork: $('open-network-info'),
    netDialog: $('network-info-dialog'),
    netHelp: $('network-info-help'),
    netList: $('network-info-list'),
    netHint: $('network-info-hint'),
    openPlaylists: $('open-playlists'),
    plDialog: $('playlists-dialog'),
    plList: $('playlists-list'),
    plStatus: $('playlists-status'),
    plShuffle: $('pl-shuffle'),
    clearQueue: $('clear-queue'),
    openSettings: $('open-settings'),
    setDialog: $('settings-dialog'),
    setPersist: $('set-persist'),
    setAutoOpen: $('set-autoopen'),
    setStatus: $('settings-status'),
    settingsSave: $('settings-save'),
    powerBtn: $('power-btn'),
  };

  // ---------- state ----------
  const state = {
    nowPlaying: null,
    queue: { items: [], length: 0 },
    status: null,
    // Whether this browser is the local (loopback) machine — fetched once from
    // /api/player-state. Gates the local-only gear + power affordances.
    isLocal: false,
    // Latest process-global player flags from the SSE snapshot.
    player: { hasLiveParent: false, persist: false },
    // Position interpolation: last server-reported values + the wall-clock
    // when we received them. The animation loop derives the displayed
    // position from these so the progress bar moves smoothly between
    // server snapshots (which arrive once per second during playback).
    posBaseSeconds: 0,
    posBaseTimestampMs: 0,
    paused: true,
    duration: 0,
    seekDragging: false,
    volumeDragging: false,
    preMuteVolume: 80,
    coverSongId: null,
    // Identity of the queue currently materialized in the DOM. When the
    // next snapshot's queue has the same signature, we skip the full
    // replaceChildren rebuild and only sync the .current marker — full
    // rebuilds at SSE rate (~1Hz) race the user's mousedown/mouseup on
    // queue rows and the click event is lost when the row gets recreated
    // between press and release.
    queueSignature: null,
    // The queueIndex of the row last marked .current in the DOM. Used to
    // gate `ensureCurrentVisible` so the auto-scroll only fires on real
    // current-track transitions (track advance, prev/next, click-to-jump,
    // first paint) — NOT on every 1Hz time-pos snapshot, which would
    // otherwise yank the list whenever the user has manually scrolled.
    lastCurrentIndex: null,
  };

  // ---------- helpers ----------
  function fmtTime(totalSeconds) {
    if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
    const s = Math.floor(totalSeconds);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    if (m >= 60) {
      const h = Math.floor(m / 60);
      const mins = m % 60;
      return `${h}:${String(mins).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  function setProgressVar(el, percent) {
    const clamped = Math.max(0, Math.min(100, percent));
    el.style.setProperty('--progress', `${clamped}%`);
  }

  // SVG elements don't reflect the `hidden` IDL attribute to the HTML
  // attribute in every browser (Chrome 147/Win64 is one such — the JS
  // property gets set but the `svg[hidden] { display: none }` CSS rule
  // never matches, so the icon stays visible). Use direct attribute
  // manipulation so the swap works everywhere.
  function setHidden(el, hide) {
    if (hide) el.setAttribute('hidden', '');
    else el.removeAttribute('hidden');
  }

  async function post(path, body) {
    try {
      const opts = { method: 'POST' };
      if (body !== undefined) {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = JSON.stringify(body);
      }
      const res = await fetch(path, opts);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.warn(`webui: ${path} failed`, res.status, text);
      }
    } catch (err) {
      console.warn(`webui: ${path} failed`, err);
    }
  }

  // ---------- connection state indicator ----------
  function setConnState(state) {
    els.conn.dataset.state = state;
    const label = els.conn.querySelector('.conn-label');
    if (state === 'connecting') label.textContent = 'Connecting…';
    else if (state === 'connected') label.textContent = 'Live';
    else label.textContent = 'Offline';
  }

  // ---------- SSE ----------
  let eventSource = null;
  let sseStopped = false; // set when we deliberately close (e.g. power-off)
  function closeEventSource() {
    sseStopped = true;
    if (eventSource !== null) {
      try { eventSource.close(); } catch { /* noop */ }
      eventSource = null;
    }
  }
  function connect() {
    setConnState('connecting');
    if (eventSource !== null) {
      try { eventSource.close(); } catch { /* noop */ }
    }
    eventSource = new EventSource('/api/events');
    eventSource.onopen = () => { if (!sseStopped) setConnState('connected'); };
    eventSource.onerror = () => {
      if (sseStopped) return; // we shut down on purpose; keep the terminal state
      // EventSource flips to readyState=CONNECTING during the auto-reconnect
      // grace; treat that as "connecting" so the dot pulses yellow rather
      // than going red. Only show "offline" if the browser gave up entirely
      // (CLOSED), which shouldn't happen with retry directives in play.
      if (eventSource.readyState === EventSource.CLOSED) {
        setConnState('disconnected');
      } else {
        setConnState('connecting');
      }
    };
    eventSource.addEventListener('snapshot', (ev) => {
      try {
        const data = JSON.parse(ev.data);
        applySnapshot(data);
      } catch (err) {
        console.warn('webui: bad snapshot', err);
      }
    });
  }

  // ---------- snapshot application ----------
  function applySnapshot({ nowPlaying, queue, status, player }) {
    state.nowPlaying = nowPlaying ?? null;
    state.queue = queue ?? { items: [], length: 0 };
    state.status = status ?? null;
    if (player) state.player = player;
    renderTrackInfo();
    renderQueue();
    renderPlayState();
    renderVolume();
    rebaseProgress();
    renderCover();
    updateLocalControls();
    // Auto-scroll the queue so the currently-playing row is on-screen.
    // Called LAST so the DOM reflects the snapshot before we measure.
    ensureCurrentVisible();
  }

  // Show/hide the loopback-only affordances. Gear shows for any local client;
  // power shows for a local client only when the server won't be auto-closed by
  // an MCP (no live parent, or persistence on). Mirrors computePlayerFlags on
  // the server. Recomputed each snapshot so it flips live when MCP disconnects
  // or persist is toggled.
  function updateLocalControls() {
    const canEditSettings = state.isLocal;
    const canPowerOff = state.isLocal && (!state.player.hasLiveParent || state.player.persist);
    setHidden(els.openSettings, !canEditSettings);
    setHidden(els.powerBtn, !canPowerOff);
  }

  // Scroll the queue list so the .current row is visible, but ONLY when
  // the current row has actually changed since the last check — track
  // advance, prev/next, click-to-jump, or first paint. A snapshot whose
  // queueIndex matches the last one (e.g. a routine time-pos tick) is a
  // no-op so the user's manual scroll position is respected. If the
  // current row is already on screen, no scroll happens either.
  //
  // .queue-list has overflow-y:auto with max-height:50svh in styles.css,
  // so it IS the scrollable viewport — scrollIntoView({block:'start'})
  // scrolls only the list, not the page, leaving the now-playing card
  // and controls in place.
  function ensureCurrentVisible() {
    const np = state.nowPlaying;
    const idx = (np !== null && np.engineRunning && typeof np.queueIndex === 'number')
      ? np.queueIndex
      : null;
    if (idx === state.lastCurrentIndex) return;
    state.lastCurrentIndex = idx;
    if (idx === null) return;

    const current = els.queueList.querySelector('li.current');
    if (current === null) return;

    // Visibility test against the queue container's own box. Both rects
    // are in browser-viewport coords, so this is a pure geometric "is
    // this rect inside that rect" check — it works whether the queue
    // list itself is on-screen, half-scrolled-off, or completely below
    // the fold. A row inside the list's box counts as visible even if
    // the user is looking at the album art at the top of the page; the
    // auto-scroll won't yank them just because they scrolled away.
    const liRect = current.getBoundingClientRect();
    const listRect = els.queueList.getBoundingClientRect();
    if (liRect.top >= listRect.top && liRect.bottom <= listRect.bottom) return;

    // Scroll ONLY the queue list — NEVER the page. Element.scrollIntoView
    // walks every scrollable ancestor and would also scroll the browser
    // viewport, which is wrong on mobile where the page itself scrolls
    // (album art + controls + queue together exceed phone viewport
    // height). The album art and controls must stay put; the user reads
    // them while the queue auto-tracks current independently.
    //
    // Compute the absolute scroll offset within the list's internal scroll
    // space: (liRect.top - listRect.top) is the row's visual distance from
    // the list's top edge; adding the list's current scrollTop converts
    // that to an offset from the scroll content's origin. Setting
    // scrollTop to that puts the row flush against the list's top. Works
    // in both directions — negative delta when the row is above the
    // visible area, positive when below.
    const targetScrollTop = liRect.top - listRect.top + els.queueList.scrollTop;
    els.queueList.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
  }

  function renderTrackInfo() {
    const np = state.nowPlaying;
    if (np === null || !np.engineRunning) {
      els.title.textContent = 'No track loaded';
      els.artist.textContent = '';
      els.album.textContent = '';
      els.queuePos.textContent = '';
      els.badge.dataset.state = 'idle';
      els.badge.textContent = 'Idle';
      return;
    }
    els.title.textContent = np.title ?? 'Unknown title';
    els.artist.textContent = np.artist ?? '';
    els.album.textContent = np.album ?? '';

    if (typeof np.queueIndex === 'number' && typeof np.queueLength === 'number') {
      els.queuePos.textContent = `${np.queueIndex + 1} / ${np.queueLength}`;
    } else {
      els.queuePos.textContent = '';
    }

    if (np.isRadio === true) {
      els.badge.dataset.state = 'radio';
      els.badge.textContent = np.radioStation?.name
        ? `Radio · ${np.radioStation.name}`
        : 'Radio';
    } else if (np.paused === true) {
      els.badge.dataset.state = 'paused';
      els.badge.textContent = 'Paused';
    } else if (np.paused === false) {
      els.badge.dataset.state = 'playing';
      els.badge.textContent = 'Playing';
    } else {
      els.badge.dataset.state = 'idle';
      els.badge.textContent = 'Idle';
    }
  }

  function queueAriaLabel(item) {
    const titleLabel = item.title ?? (item.songId ?? 'Track');
    return item.isCurrent
      ? `Currently playing: ${titleLabel}`
      : `Play track ${item.index + 1}: ${titleLabel}`;
  }

  function renderQueue() {
    const items = state.queue.items ?? [];
    els.queueCount.textContent = String(state.queue.length ?? items.length);
    if (items.length === 0) {
      if (state.queueSignature !== '') {
        els.queueList.innerHTML = '<li class="empty">Queue is empty</li>';
        state.queueSignature = '';
      }
      return;
    }

    // Queue identity, not playback position. Time-pos snapshots arrive at
    // ~1Hz and would otherwise trigger a full replaceChildren rebuild,
    // recreating every <li> under the user's cursor — that races their
    // mousedown→mouseup and drops clicks, and restarts hover transitions
    // (visible as flicker on the hovered row).
    const signature = items.map((it) => `${it.index}:${it.songId ?? ''}`).join('|');
    if (signature === state.queueSignature) {
      const existing = els.queueList.children;
      for (let i = 0; i < existing.length && i < items.length; i++) {
        const li = existing[i];
        const item = items[i];
        if (item.isCurrent) li.classList.add('current');
        else li.classList.remove('current');
        li.setAttribute('aria-label', queueAriaLabel(item));
      }
      return;
    }

    // Build rows imperatively. Using innerHTML for the whole list is simpler
    // than diffing — queues are short and this branch only fires when the
    // queue actually mutates (add/remove/reorder), not on every time-pos
    // update.
    const rows = items.map((item) => {
      const li = document.createElement('li');
      if (item.isCurrent) li.classList.add('current');

      // Keyboard + screenreader parity with the click affordance. Native
      // <button> would conflict with the existing flex layout (and adds
      // unwanted default styling), so we promote the li to a button role.
      const titleLabel = item.title ?? (item.songId ?? 'Track');
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.setAttribute('aria-label', queueAriaLabel(item));

      const icon = document.createElement('span');
      icon.className = 'qicon';
      icon.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';

      const num = document.createElement('span');
      num.className = 'qnum';
      num.textContent = String(item.index + 1);

      const main = document.createElement('div');
      main.className = 'qmain';
      const title = document.createElement('span');
      title.className = 'qtitle';
      title.textContent = titleLabel;
      const artist = document.createElement('span');
      artist.className = 'qartist';
      const parts = [];
      if (item.artist) parts.push(item.artist);
      if (item.album) parts.push(item.album);
      artist.textContent = parts.join(' · ');
      main.appendChild(title);
      main.appendChild(artist);

      const dur = document.createElement('span');
      dur.className = 'qdur';
      dur.textContent = item.duration ? fmtTime(item.duration) : '';

      li.appendChild(icon);
      li.appendChild(num);
      li.appendChild(main);
      li.appendChild(dur);

      // Click → jump playback to that index. The currently-playing row is
      // a no-op so users don't accidentally restart the track they're
      // listening to. We read the live `.current` class rather than the
      // captured `item.isCurrent` because identity-preserving snapshots
      // re-use this <li> and only flip the class — the closure value can
      // be stale by the time the user clicks.
      const onActivate = () => {
        if (li.classList.contains('current')) return;
        post('/api/controls/play-index', { index: item.index });
      };
      li.addEventListener('click', onActivate);
      li.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          onActivate();
        }
      });

      return li;
    });
    els.queueList.replaceChildren(...rows);
    state.queueSignature = signature;
  }

  function renderPlayState() {
    const np = state.nowPlaying;
    state.paused = np?.paused !== false;
    if (state.paused) {
      setHidden(els.iconPlay, false);
      setHidden(els.iconPause, true);
      els.btnPlay.setAttribute('aria-label', 'Play');
    } else {
      setHidden(els.iconPlay, true);
      setHidden(els.iconPause, false);
      els.btnPlay.setAttribute('aria-label', 'Pause');
    }

    const hasTrack = np?.engineRunning && (np.queueLength ?? 0) > 0;
    els.btnPlay.disabled = !np?.engineRunning;
    els.btnPrev.disabled = !hasTrack;
    els.btnNext.disabled = !hasTrack;
    els.seek.disabled = !hasTrack || np?.isRadio === true;
  }

  function renderVolume() {
    const status = state.status;
    const vol = (status && typeof status.volume === 'number') ? status.volume : null;
    if (vol === null) {
      els.volumeLabel.textContent = '--';
      return;
    }
    if (!state.volumeDragging) {
      els.volume.value = String(Math.round(vol));
      setProgressVar(els.volume, vol);
    }
    els.volumeLabel.textContent = String(Math.round(vol));
    updateVolumeIcon(vol);
  }

  function updateVolumeIcon(vol) {
    const v = Number(vol);
    // Four-state ramp across the slider's 0–100 range so the transitions
    // feel evenly paced rather than jumping speaker → two-waves at 50%.
    // Thresholds split 1–100 into rough thirds: low (1–33), mid (34–66),
    // high (67+). Mute occupies the single 0 value.
    setHidden(els.iconVolMute, v !== 0);
    setHidden(els.iconVolLow, !(v > 0 && v <= 33));
    setHidden(els.iconVolMid, !(v >= 34 && v <= 66));
    setHidden(els.iconVolHigh, !(v >= 67));
  }

  function rebaseProgress() {
    const np = state.nowPlaying;
    if (np === null || !np.engineRunning) {
      state.posBaseSeconds = 0;
      state.posBaseTimestampMs = Date.now();
      state.duration = 0;
      els.position.textContent = '0:00';
      els.duration.textContent = '0:00';
      setProgressVar(els.seek, 0);
      els.seek.value = '0';
      return;
    }
    state.posBaseSeconds = typeof np.position === 'number' ? np.position : 0;
    state.posBaseTimestampMs = Date.now();
    state.duration = typeof np.duration === 'number' ? np.duration : 0;
    els.duration.textContent = fmtTime(state.duration);
  }

  function renderCover() {
    // Cover art keys off the current queue item's songId. The Subsonic
    // getCoverArt endpoint accepts a song id and returns the album art, so
    // a single proxy lookup per current track is enough.
    const np = state.nowPlaying;
    let songId = null;
    if (np?.engineRunning && typeof np.queueIndex === 'number') {
      const current = state.queue.items.find((it) => it.index === np.queueIndex);
      if (current && current.songId) songId = current.songId;
    }
    if (songId === state.coverSongId) return;
    state.coverSongId = songId;

    // Clear any existing image; placeholder reappears via the .cover.has-art
    // class toggle.
    const existing = els.coverWrap.querySelector('img');
    if (existing !== null) existing.remove();
    els.coverWrap.classList.remove('has-art');

    if (songId === null) return;

    const img = new Image();
    img.alt = '';
    img.src = `/api/cover/${encodeURIComponent(songId)}`;
    img.addEventListener('load', () => {
      if (state.coverSongId === songId) {
        els.coverWrap.classList.add('has-art');
      }
    });
    img.addEventListener('error', () => {
      img.remove();
    });
    els.coverWrap.appendChild(img);
  }

  // ---------- progress interpolation loop ----------
  function tickProgress() {
    if (!state.seekDragging) {
      let displayed = state.posBaseSeconds;
      if (!state.paused) {
        const elapsedMs = Date.now() - state.posBaseTimestampMs;
        displayed = state.posBaseSeconds + elapsedMs / 1000;
        if (state.duration > 0 && displayed > state.duration) {
          displayed = state.duration;
        }
      }
      els.position.textContent = fmtTime(displayed);
      const pct = state.duration > 0 ? (displayed / state.duration) * 100 : 0;
      els.seek.value = String(Math.round(pct));
      setProgressVar(els.seek, pct);
    }
    requestAnimationFrame(tickProgress);
  }

  // ---------- input handlers ----------
  function bindControls() {
    els.btnPlay.addEventListener('click', () => {
      // Optimistic-but-conservative: don't toggle local state until the SSE
      // event confirms. The next snapshot lands within ~50ms over LAN.
      if (state.paused) post('/api/controls/resume');
      else post('/api/controls/pause');
    });
    els.btnPrev.addEventListener('click', () => post('/api/controls/previous'));
    els.btnNext.addEventListener('click', () => post('/api/controls/next'));

    // Seek: snap on release. Using 'input' would fire continuously while the
    // user drags and spam mpv with seek commands.
    els.seek.addEventListener('pointerdown', () => { state.seekDragging = true; });
    els.seek.addEventListener('input', (ev) => {
      // While dragging, show the would-be position locally so the time label
      // tracks the thumb without hitting the server.
      if (state.duration > 0) {
        const pct = Number(ev.target.value);
        const seconds = (pct / 100) * state.duration;
        els.position.textContent = fmtTime(seconds);
        setProgressVar(els.seek, pct);
      }
    });
    els.seek.addEventListener('change', (ev) => {
      state.seekDragging = false;
      if (state.duration <= 0) return;
      const pct = Number(ev.target.value);
      const seconds = (pct / 100) * state.duration;
      post('/api/controls/seek', { seconds, mode: 'absolute' });
      state.posBaseSeconds = seconds;
      state.posBaseTimestampMs = Date.now();
    });

    // Volume: debounce input to avoid hammering the server while dragging.
    // 'change' alone would feel laggy on touch; debounced 'input' gives the
    // feeling of immediate response without 60 RPS.
    let volTimer = null;
    els.volume.addEventListener('pointerdown', () => { state.volumeDragging = true; });
    els.volume.addEventListener('input', (ev) => {
      const v = Number(ev.target.value);
      setProgressVar(els.volume, v);
      els.volumeLabel.textContent = String(v);
      updateVolumeIcon(v);
      if (volTimer !== null) clearTimeout(volTimer);
      volTimer = setTimeout(() => {
        volTimer = null;
        post('/api/controls/volume', { level: v });
      }, 120);
    });
    els.volume.addEventListener('change', (ev) => {
      state.volumeDragging = false;
      const v = Number(ev.target.value);
      if (volTimer !== null) { clearTimeout(volTimer); volTimer = null; }
      post('/api/controls/volume', { level: v });
    });

    els.btnMute.addEventListener('click', () => {
      const current = Number(els.volume.value);
      if (current > 0) {
        state.preMuteVolume = current;
        els.volume.value = '0';
        setProgressVar(els.volume, 0);
        els.volumeLabel.textContent = '0';
        updateVolumeIcon(0);
        post('/api/controls/volume', { level: 0 });
      } else {
        const restore = state.preMuteVolume > 0 ? state.preMuteVolume : 60;
        els.volume.value = String(restore);
        setProgressVar(els.volume, restore);
        els.volumeLabel.textContent = String(restore);
        updateVolumeIcon(restore);
        post('/api/controls/volume', { level: restore });
      }
    });

    els.openNetwork.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/network-info');
        const info = await res.json();
        renderNetworkInfo(info);
        if (typeof els.netDialog.showModal === 'function') {
          els.netDialog.showModal();
        }
      } catch (err) {
        console.warn('webui: network-info fetch failed', err);
      }
    });

    els.openPlaylists.addEventListener('click', async () => {
      els.plStatus.textContent = 'Loading playlists…';
      els.plList.replaceChildren();
      if (typeof els.plDialog.showModal === 'function') els.plDialog.showModal();
      try {
        const res = await fetch('/api/playlists');
        if (!res.ok) {
          // Non-2xx (e.g. 500 from runAction) — show an error, not the
          // misleading "No playlists found" an empty-array fallback would give.
          console.warn('webui: /api/playlists failed', res.status);
          els.plStatus.textContent = 'Could not load playlists.';
          return;
        }
        const data = await res.json();
        renderPlaylists(data.playlists ?? []);
      } catch (err) {
        console.warn('webui: playlists fetch failed', err);
        els.plStatus.textContent = 'Could not load playlists.';
      }
    });

    els.clearQueue.addEventListener('click', () => {
      const count = state.queue?.length ?? (state.queue?.items?.length ?? 0);
      if (count > 0 && !window.confirm('Clear the queue and stop playback?')) return;
      post('/api/controls/clear');
    });

    els.openSettings.addEventListener('click', async () => {
      els.setStatus.textContent = '';
      try {
        const res = await fetch('/api/player/settings');
        if (res.ok) {
          const s = await res.json();
          els.setPersist.checked = s.persistAfterMcpExit === true;
          els.setAutoOpen.checked = s.autoOpenBrowser === true;
        }
      } catch (err) {
        console.warn('webui: player settings fetch failed', err);
      }
      if (typeof els.setDialog.showModal === 'function') els.setDialog.showModal();
    });

    els.settingsSave.addEventListener('click', async () => {
      els.setStatus.textContent = 'Saving…';
      try {
        const res = await fetch('/api/player/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            persistAfterMcpExit: els.setPersist.checked,
            autoOpenBrowser: els.setAutoOpen.checked,
          }),
        });
        if (res.ok) {
          const s = await res.json();
          // Reflect the live persist value immediately so the power button
          // appears/disappears without waiting for the next snapshot.
          state.player = { ...state.player, persist: s.persistAfterMcpExit === true };
          updateLocalControls();
          els.setStatus.textContent = 'Saved.';
        } else {
          els.setStatus.textContent = 'Could not save settings.';
        }
      } catch (err) {
        console.warn('webui: save player settings failed', err);
        els.setStatus.textContent = 'Could not save settings.';
      }
    });

    els.powerBtn.addEventListener('click', async () => {
      if (!window.confirm('Stop playback and shut down the player? You will need to reopen or restart it to use it again.')) return;
      // Close the SSE stream first so its auto-reconnect doesn't flip the UI back
      // to "Connecting…" (and clobber the terminal state) once the server exits.
      closeEventSource();
      try {
        await fetch('/api/shutdown', { method: 'POST' });
      } catch {
        /* the server tears down mid-request; an error here is expected */
      }
      setConnState('disconnected');
      document.body.classList.add('player-stopped');
    });
  }

  function selectedMode() {
    const checked = els.plDialog.querySelector('input[name="pl-mode"]:checked');
    return checked ? checked.value : 'replace';
  }

  async function playPlaylist(id, name) {
    els.plStatus.textContent = `Starting “${name}”…`;
    try {
      const res = await fetch('/api/playlists/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlistId: id, mode: selectedMode(), shuffle: els.plShuffle.checked }),
      });
      if (res.ok) {
        els.plDialog.close();
      } else {
        const text = await res.text().catch(() => '');
        console.warn('webui: play playlist failed', res.status, text);
        els.plStatus.textContent = 'Could not start that playlist.';
      }
    } catch (err) {
      console.warn('webui: play playlist failed', err);
      els.plStatus.textContent = 'Could not start that playlist.';
    }
  }

  function renderPlaylists(playlists) {
    if (!playlists.length) {
      els.plStatus.textContent = 'No playlists found.';
      els.plList.replaceChildren();
      return;
    }
    els.plStatus.textContent = '';
    els.plList.replaceChildren(...playlists.map((pl) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'playlist-item';
      const head = document.createElement('span');
      head.className = 'pl-name';
      head.textContent = pl.name;
      const meta = document.createElement('span');
      meta.className = 'pl-meta';
      const count = typeof pl.songCount === 'number' ? `${pl.songCount} track${pl.songCount === 1 ? '' : 's'}` : '';
      meta.textContent = pl.durationFormatted ? `${count} · ${pl.durationFormatted}` : count;
      btn.appendChild(head);
      btn.appendChild(meta);
      btn.addEventListener('click', () => void playPlaylist(pl.playlistId, pl.name));
      li.appendChild(btn);
      return li;
    }));
  }

  function renderNetworkInfo(info) {
    els.netHelp.textContent = info.expose || info.host === '0.0.0.0'
      ? 'The panel is reachable from devices on the same network.'
      : 'Currently only reachable from this device.';

    const entries = [];
    entries.push({ iface: 'Localhost', address: '127.0.0.1', url: info.localhostUrl });
    for (const iface of info.interfaces ?? []) entries.push(iface);

    els.netList.replaceChildren(...entries.map((it) => {
      const li = document.createElement('li');
      const head = document.createElement('span');
      head.className = 'iface';
      head.textContent = `${it.iface} · ${it.address}`;
      const link = document.createElement('a');
      link.href = it.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = it.url;
      li.appendChild(head);
      li.appendChild(link);
      return li;
    }));

    if (!info.expose && info.host !== '0.0.0.0') {
      els.netHint.textContent = 'Tip: set WEBUI_EXPOSE=true and restart the MCP server to allow LAN access.';
    } else if ((info.interfaces ?? []).length === 0) {
      els.netHint.textContent = 'No LAN interfaces detected (only localhost is reachable).';
    } else {
      els.netHint.textContent = '';
    }
  }

  // ---------- bootstrap ----------
  async function fetchLocalFlag() {
    try {
      const res = await fetch('/api/player-state');
      if (res.ok) {
        const s = await res.json();
        state.isLocal = s.isLocal === true;
        updateLocalControls();
      }
    } catch (err) {
      console.warn('webui: player-state fetch failed', err);
    }
  }

  function bootstrap() {
    bindControls();
    void fetchLocalFlag();
    connect();
    requestAnimationFrame(tickProgress);
  }

  bootstrap();
})();
