// Navidrome MCP — Web UI client. Vanilla ES2020, no deps, no build step.
//
// Talks to the companion HTTP server hosted by the MCP process:
//   GET  /api/events           — Server-Sent Events stream of {nowPlaying, queue}
//   POST /api/controls/*       — pause/resume/next/previous/seek/volume
//   GET  /api/cover/:id        — proxied album art (signed server-side)
//   GET  /api/network-info     — bind/expose state + reachable URLs
//   GET  /api/lyrics/:songId   — resolved lyrics for one live-queue entry
//
// Reconnect interval is enforced by the server (retry: 10000). The browser's
// EventSource implementation handles the reconnect itself.

import {
  applyOffset,
  createSeekDetector,
  findActiveLine,
  isInterlude,
} from './lyrics-sync.js';

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
    plTabPlaylists: $('pl-tab-playlists'),
    plTabStarred: $('pl-tab-starred'),
    plTabAlbums: $('pl-tab-albums'),
    plPanePlaylists: $('pl-pane-playlists'),
    plPaneStarred: $('pl-pane-starred'),
    plPaneAlbums: $('pl-pane-albums'),
    starredStatus: $('starred-status'),
    starredPlayOrder: $('starred-play-order'),
    starredPlayShuffle: $('starred-play-shuffle'),
    albumsStatus: $('albums-status'),
    albumsPlayOrder: $('albums-play-order'),
    albumsPlayShuffleAlbums: $('albums-play-shuffle-albums'),
    albumsPlayShuffleSongs: $('albums-play-shuffle-songs'),
    clearQueue: $('clear-queue'),
    openSettings: $('open-settings'),
    setDialog: $('settings-dialog'),
    setPersist: $('set-persist'),
    setAutoOpen: $('set-autoopen'),
    setStatus: $('settings-status'),
    settingsSave: $('settings-save'),
    powerBtn: $('power-btn'),
    openLyrics: $('open-lyrics'),
    lyricsView: $('lyrics-view'),
    lyricsBack: $('lyrics-back'),
    lyricsTitle: $('lyrics-title'),
    lyricsArtist: $('lyrics-artist'),
    lyricsCover: $('lyrics-cover'),
    lyricsScroll: $('lyrics-scroll'),
    lyricsStatus: $('lyrics-status'),
    lyricsLines: $('lyrics-lines'),
    lyricsSeekLine: $('lyrics-seek-line'),
    lyricsPosition: $('lyrics-position'),
    lyricsDuration: $('lyrics-duration'),
    lyricsPrev: $('lyrics-prev'),
    lyricsPlay: $('lyrics-play-pause'),
    lyricsNext: $('lyrics-next'),
    lyricsIconPlay: $('lyrics-icon-play'),
    lyricsIconPause: $('lyrics-icon-pause'),
    lyricsSizeDown: $('lyrics-size-down'),
    lyricsSizeUp: $('lyrics-size-up'),
    lyricsSettings: $('lyrics-settings'),
    lyricsSettingsDialog: $('lyrics-settings-dialog'),
    lyricsOffsetDown: $('lyrics-offset-down'),
    lyricsOffsetUp: $('lyrics-offset-up'),
    lyricsOffsetValue: $('lyrics-offset-value'),
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
    lyricsOpen: false,
    // Starts undefined rather than null so the very first snapshot always
    // paints an initial lyrics state, even with nothing playing.
    lyricsSongId: undefined,
    // Bumped on every track change. A lyrics response carrying an older
    // generation is discarded instead of painted over the newer track.
    lyricsGeneration: 0,
    // Only shapes the empty-state message; assumed on until player-state answers.
    lyricsLrclibEnabled: true,
    // Lyrics clock. Additive to posBaseSeconds/posBaseTimestampMs above: the
    // highlight needs a clock that slews toward each snapshot and the progress
    // bar needs one that does not, so they cannot be the same clock.
    lyricsBaseMs: 0,
    lyricsBaseWallMs: 0,
    // Outstanding correction, drained toward zero so a snapshot that disagrees
    // with the interpolation does not twitch the highlight once per second.
    lyricsSlewMs: 0,
    // Set by a seek, an SSE reconnect or a return to visibility: the next
    // snapshot lands the clock instead of animating a scroll through the song.
    lyricsSnapNext: true,
    // Reading preferences, restored from localStorage. Both are per device, not
    // per song: a speaker's latency and a reader's eyesight belong to the device.
    lyricsOffsetMs: 0,
    // Index into LYRIC_SIZE_STEPS. Step 1 is the size the overlay ships at.
    lyricsSizeStep: 1,
    // False once the reader has scrolled the words themselves.
    lyricsFollowing: true,
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
    eventSource.onopen = () => {
      // A reconnect may have missed any amount of the song, so the first
      // snapshot after it lands the lyrics clock rather than animating to it.
      state.lyricsSnapNext = true;
      if (!sseStopped) setConnState('connected');
    };
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
    rebaseLyricsClock();
    renderCover();
    syncLyrics();
    syncWakeHold();
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
        // Metadata can arrive after the row is first painted: server-side
        // enrichment is best-effort per chunk, so a row may render with a
        // placeholder title/artist/album/duration and get real values on a
        // later poll while index/songId (and thus the signature) stay the
        // same. Refresh the visible text every poll so it never diverges from
        // the aria-label (which already updates above).
        const numEl = li.querySelector('.qnum');
        if (numEl) numEl.textContent = String(item.index + 1);
        const titleEl = li.querySelector('.qtitle');
        if (titleEl) titleEl.textContent = item.title ?? (item.songId ?? 'Track');
        const artistEl = li.querySelector('.qartist');
        if (artistEl) {
          const parts = [];
          if (item.artist) parts.push(item.artist);
          if (item.album) parts.push(item.album);
          artistEl.textContent = parts.join(' · ');
        }
        const durEl = li.querySelector('.qdur');
        if (durEl) durEl.textContent = item.duration ? fmtTime(item.duration) : '';
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

    // The lyrics overlay carries its own compact copy of the transport.
    setHidden(els.lyricsIconPlay, !state.paused);
    setHidden(els.lyricsIconPause, state.paused);
    els.lyricsPlay.setAttribute('aria-label', state.paused ? 'Play' : 'Pause');
    els.lyricsPlay.disabled = els.btnPlay.disabled;
    els.lyricsPrev.disabled = els.btnPrev.disabled;
    els.lyricsNext.disabled = els.btnNext.disabled;
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

  // The songId of one queue row. Both the cover art and the lyrics overlay key
  // off it, because the now-playing snapshot carries no songId of its own.
  function queueSongId(index) {
    const item = state.queue.items.find((it) => it.index === index);
    return item && item.songId ? item.songId : null;
  }

  // Swap the art inside one .cover box. `stillCurrent` is re-checked on load so
  // a slow image for an already-replaced track never paints over the new one.
  function mountCover(wrap, songId, stillCurrent) {
    // Clear any existing image; placeholder reappears via the .cover.has-art
    // class toggle.
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

  function renderCover() {
    // Cover art keys off the current queue item's songId. The Subsonic
    // getCoverArt endpoint accepts a song id and returns the album art, so
    // a single proxy lookup per current track is enough.
    const np = state.nowPlaying;
    let songId = null;
    if (np?.engineRunning && typeof np.queueIndex === 'number') {
      songId = queueSongId(np.queueIndex);
    }
    if (songId === state.coverSongId) return;
    state.coverSongId = songId;
    mountCover(els.coverWrap, songId, () => state.coverSongId === songId);
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
  // Optimistic-but-conservative: don't toggle local state until the SSE event
  // confirms. The next snapshot lands within ~50ms over LAN.
  function togglePlayPause() {
    if (state.paused) post('/api/controls/resume');
    else post('/api/controls/pause');
  }

  function bindControls() {
    els.btnPlay.addEventListener('click', togglePlayPause);
    els.btnPrev.addEventListener('click', () => post('/api/controls/previous'));
    els.btnNext.addEventListener('click', () => post('/api/controls/next'));

    // Seek: snap on release. Using 'input' would fire continuously while the
    // user drags and spam mpv with seek commands.
    els.seek.addEventListener('pointerdown', () => { state.seekDragging = true; });
    // If the drag is cancelled or the pointer is lifted outside the slider, the
    // 'change' event may never fire — reset the flag so tickProgress resumes.
    els.seek.addEventListener('pointercancel', () => { state.seekDragging = false; });
    els.seek.addEventListener('pointerup', () => { state.seekDragging = false; });
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
    els.volume.addEventListener('pointercancel', () => { state.volumeDragging = false; });
    els.volume.addEventListener('pointerup', () => { state.volumeDragging = false; });
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
        if (!res.ok) { console.warn('webui: network-info fetch failed', res.status); return; }
        const info = await res.json();
        renderNetworkInfo(info);
        if (typeof els.netDialog.showModal === 'function') {
          els.netDialog.showModal();
        }
      } catch (err) {
        console.warn('webui: network-info fetch failed', err);
      }
    });

    els.plTabPlaylists.addEventListener('click', () => switchTab('playlists'));
    els.plTabStarred.addEventListener('click', () => switchTab('starred'));
    els.plTabAlbums.addEventListener('click', () => switchTab('albums'));
    els.starredPlayOrder.addEventListener('click', () => void playStarred(false));
    els.starredPlayShuffle.addEventListener('click', () => void playStarred(true));
    els.albumsPlayOrder.addEventListener('click', () => void playStarredAlbums('none'));
    els.albumsPlayShuffleAlbums.addEventListener('click', () => void playStarredAlbums('albums'));
    els.albumsPlayShuffleSongs.addEventListener('click', () => void playStarredAlbums('songs'));

    els.openPlaylists.addEventListener('click', async () => {
      // Always reopen on the Playlists tab and reset the starred hints.
      switchTab('playlists');
      els.starredStatus.textContent = 'Play all of your hearted songs, least-recently-played first.';
      els.albumsStatus.textContent = 'Play all of your hearted albums, least-recently-played first.';
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

    bindLyricsControls();
  }

  function switchTab(name) {
    // Drive every tab/pane pair from one map so adding a tab is a single entry.
    const tabs = {
      playlists: { tab: els.plTabPlaylists, pane: els.plPanePlaylists },
      starred: { tab: els.plTabStarred, pane: els.plPaneStarred },
      albums: { tab: els.plTabAlbums, pane: els.plPaneAlbums },
    };
    for (const [key, { tab, pane }] of Object.entries(tabs)) {
      const active = key === name;
      tab.classList.toggle('is-active', active);
      pane.hidden = !active;
    }
  }

  function selectedMode() {
    const checked = els.plDialog.querySelector('input[name="pl-mode"]:checked');
    return checked ? checked.value : 'replace';
  }

  function starredMode() {
    const checked = els.plDialog.querySelector('input[name="starred-mode"]:checked');
    return checked ? checked.value : 'replace';
  }

  async function playStarred(shuffle) {
    els.starredStatus.textContent = shuffle ? 'Shuffling your starred songs…' : 'Starting your starred songs…';
    try {
      const res = await fetch('/api/starred/songs/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: starredMode(), shuffle }),
      });
      if (res.ok) {
        els.plDialog.close();
      } else {
        const text = await res.text().catch(() => '');
        console.warn('webui: play starred songs failed', res.status, text);
        els.starredStatus.textContent = text.includes('No starred songs')
          ? 'You have no starred songs yet. Heart some tracks first.'
          : 'Could not start your starred songs.';
      }
    } catch (err) {
      console.warn('webui: play starred songs failed', err);
      els.starredStatus.textContent = 'Could not start your starred songs.';
    }
  }

  function albumsMode() {
    const checked = els.plDialog.querySelector('input[name="albums-mode"]:checked');
    return checked ? checked.value : 'replace';
  }

  async function playStarredAlbums(shuffle) {
    els.albumsStatus.textContent = shuffle === 'none'
      ? 'Starting your starred albums…'
      : 'Shuffling your starred albums…';
    try {
      const res = await fetch('/api/starred/albums/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: albumsMode(), shuffle }),
      });
      if (res.ok) {
        els.plDialog.close();
      } else {
        const text = await res.text().catch(() => '');
        console.warn('webui: play starred albums failed', res.status, text);
        els.albumsStatus.textContent = text.includes('No starred albums')
          ? 'You have no starred albums yet. Heart some albums first.'
          : 'Could not start your starred albums.';
      }
    } catch (err) {
      console.warn('webui: play starred albums failed', err);
      els.albumsStatus.textContent = 'Could not start your starred albums.';
    }
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
      els.netHint.textContent = 'Tip: run navidrome-config and enable network exposure under Settings, then restart the server.';
    } else if ((info.interfaces ?? []).length === 0) {
      els.netHint.textContent = 'No LAN interfaces detected (only localhost is reachable).';
    } else {
      els.netHint.textContent = '';
    }
  }

  // ---------- lyrics overlay ----------
  // A track's lyrics never change, so an answered lookup is held for the life of
  // the page. Only answers are cached: a transient failure must stay retryable.
  const lyricsCache = new Map();
  const lyricsInFlight = new Map();

  async function requestLyrics(songId) {
    try {
      const res = await fetch(`/api/lyrics/${encodeURIComponent(songId)}`);
      if (!res.ok) {
        console.warn('webui: lyrics fetch failed', res.status);
        return null;
      }
      return await res.json();
    } catch (err) {
      console.warn('webui: lyrics fetch failed', err);
      return null;
    }
  }

  // One request per songId at a time: the prefetch of the next queue entry and
  // an open of that same entry would otherwise race two identical lookups.
  function lyricsGet(songId) {
    const cached = lyricsCache.get(songId);
    if (cached !== undefined) return Promise.resolve(cached);
    const pending = lyricsInFlight.get(songId);
    if (pending !== undefined) return pending;

    // requestLyrics never rejects, so the in-flight entry is always cleared.
    const request = requestLyrics(songId).then((dto) => {
      lyricsInFlight.delete(songId);
      if (dto !== null) lyricsCache.set(songId, dto);
      return dto;
    });
    lyricsInFlight.set(songId, request);
    return request;
  }

  // ---------- lyrics clock ----------
  /** How far the highlight's clock may run fast or slow while it absorbs a
   *  correction. A quarter of real time clears a sub-threshold drift in about
   *  two seconds, which the reader does not perceive as a change of pace. */
  const LYRICS_SLEW_RATE = 0.25;

  /** A gap this long reads as an instrumental break rather than a verse pause.
   *  LRC line gaps run 2 to 3 seconds, so this sits clear of them. */
  const LYRICS_INTERLUDE_MS = 4000;

  const lyricsSeekDetector = createSeekDetector();

  // Media position the highlight is drawn at. The slew term is what stops a
  // snapshot that disagrees with the interpolation from twitching the words.
  function lyricsShownMs(nowMs) {
    const elapsedMs = state.paused ? 0 : nowMs - state.lyricsBaseWallMs;
    return Math.max(0, state.lyricsBaseMs + elapsedMs + state.lyricsSlewMs);
  }

  function drainLyricsSlew(frameDeltaMs) {
    const step = frameDeltaMs * LYRICS_SLEW_RATE;
    if (state.lyricsSlewMs > step) state.lyricsSlewMs -= step;
    else if (state.lyricsSlewMs < -step) state.lyricsSlewMs += step;
    else state.lyricsSlewMs = 0;
  }

  // Every snapshot rebases this clock, overlay open or not, so the seek detector
  // keeps an unbroken view of the position and a reopen is already in step.
  function rebaseLyricsClock() {
    // INPUT
    const np = state.nowPlaying;
    const nowMs = Date.now();
    const running = np !== null && np.engineRunning === true;
    const mediaMs = (running && typeof np.position === 'number')
      ? Math.round(np.position * 1000)
      : 0;
    const shownMs = lyricsShownMs(nowMs);
    const seeked = lyricsSeekDetector.check(mediaMs, nowMs, !state.paused);

    // PROCESS
    state.lyricsBaseMs = mediaMs;
    state.lyricsBaseWallMs = nowMs;
    if (state.lyricsSnapNext || seeked || !running) state.lyricsSlewMs = 0;
    else state.lyricsSlewMs = shownMs - mediaMs;

    // OUTPUT
    state.lyricsSnapNext = false;
  }

  // ---------- lyrics follow ----------
  // Both nodes belong to the follow behaviour alone, so they are built here
  // rather than carried as empty markup in index.html.
  const lyricsInterludeEl = buildInterludeEl();
  const lyricsPill = buildFollowPill();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // The timed lines and the rows drawn from them, held together so the follow
  // loop never re-reads the document.
  let lyricsTimed = [];
  let lyricsRows = [];
  let lyricsCursor = null;
  let lyricsActiveIndex = -1;
  let lyricsInInterlude = false;
  let lyricsFrameWallMs = 0;

  function buildInterludeEl() {
    const li = document.createElement('li');
    li.className = 'lyric-interlude';
    li.setAttribute('aria-hidden', 'true');
    for (let dot = 0; dot < 3; dot += 1) li.appendChild(document.createElement('span'));
    return li;
  }

  function buildFollowPill() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lyrics-follow-pill';
    btn.textContent = 'Jump to current';
    btn.setAttribute('hidden', '');
    els.lyricsView.appendChild(btn);
    return btn;
  }

  function scrollBehavior(instant) {
    return (instant || reducedMotion.matches) ? 'auto' : 'smooth';
  }

  // Centre one row by computing the lyrics container's own scrollTop.
  // Element.scrollIntoView walks every scrollable ancestor and would move the
  // view behind the overlay with it.
  function centerRow(row, behavior) {
    // INPUT
    const boxRect = els.lyricsScroll.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const limit = els.lyricsScroll.scrollHeight - els.lyricsScroll.clientHeight;
    let target = 0;

    // PROCESS
    target = els.lyricsScroll.scrollTop
      + (rowRect.top - boxRect.top)
      - (boxRect.height - rowRect.height) / 2;
    target = Math.max(0, Math.min(limit, target));

    // OUTPUT
    els.lyricsScroll.scrollTo({ top: target, behavior });
  }

  // Drop every reference into the previous track's rows: the follow loop reads
  // these each frame and a stale row would keep a removed node alive.
  function resetLyricsFollow() {
    lyricsTimed = [];
    lyricsRows = [];
    lyricsCursor = null;
    lyricsActiveIndex = -1;
    lyricsInInterlude = false;
    lyricsInterludeEl.remove();
    els.lyricsLines.classList.remove('is-synced');
  }

  function setFollowing(following) {
    state.lyricsFollowing = following;
    setHidden(lyricsPill, following);
  }

  // A pointer or wheel gesture on the words is the only signal saying the reader
  // moved the view rather than the player. The scroll event cannot tell the two
  // apart, so it is never listened for.
  function suspendFollow() {
    // Plain lyrics carry no timed line to jump back to, so nothing to suspend.
    if (lyricsTimed.length === 0) return;
    setFollowing(false);
  }

  function resumeFollow() {
    const row = lyricsRows[lyricsActiveIndex];
    setFollowing(true);
    if (row !== undefined) centerRow(row, scrollBehavior(false));
  }

  // The only place following writes to the DOM. Reached when the active line or
  // the interlude changes, never on an ordinary frame.
  function paintActiveLine(previousIndex, instant) {
    // INPUT
    const previousRow = lyricsRows[previousIndex];
    const row = lyricsRows[lyricsActiveIndex];

    // PROCESS
    if (previousRow !== undefined && previousRow !== row) {
      previousRow.classList.remove('is-active', 'is-interlude');
    }
    lyricsInterludeEl.remove();
    if (row === undefined) return;
    row.classList.add('is-active');
    row.classList.toggle('is-interlude', lyricsInInterlude);
    if (lyricsInInterlude) row.insertAdjacentElement('afterend', lyricsInterludeEl);

    // OUTPUT
    if (state.lyricsFollowing) centerRow(row, scrollBehavior(instant));
  }

  // Runs every frame, writes only on a change. Anything but a step to the very
  // next line is a seek or a resync, which lands without a long animated scroll.
  function tickLyricsFollow(nowMs) {
    // INPUT
    const frameDeltaMs = lyricsFrameWallMs === 0 ? 0 : nowMs - lyricsFrameWallMs;
    const previousIndex = lyricsActiveIndex;
    let timeMs = 0;
    let active = null;
    let interlude = false;

    lyricsFrameWallMs = nowMs;
    if (lyricsTimed.length === 0) return;

    // PROCESS
    drainLyricsSlew(frameDeltaMs);
    timeMs = applyOffset(lyricsShownMs(nowMs), state.lyricsOffsetMs);
    active = findActiveLine(lyricsTimed, timeMs, lyricsCursor);
    lyricsCursor = active.cursor;
    interlude = isInterlude(lyricsTimed, active.index, timeMs, LYRICS_INTERLUDE_MS);
    if (active.index === previousIndex && interlude === lyricsInInterlude) return;

    // OUTPUT
    lyricsActiveIndex = active.index;
    lyricsInInterlude = interlude;
    paintActiveLine(previousIndex, active.index !== previousIndex + 1);
  }

  // Tap a line to seek there. Reuses the transport's own seek endpoint, and moves
  // the lyrics clock at once so the highlight does not wait for a snapshot.
  function seekToTappedLine(ev) {
    // INPUT
    const row = ev.target.closest('.lyric-line');
    const index = row === null ? -1 : Number(row.dataset.index);
    const line = lyricsTimed[index];

    // PROCESS
    if (line === undefined) return;
    // The container's own click toggles immersive mode, which a seek must not.
    ev.stopPropagation();
    post('/api/controls/seek', { seconds: line.timeMs / 1000, mode: 'absolute' });

    // OUTPUT
    state.lyricsBaseMs = line.timeMs;
    state.lyricsBaseWallMs = Date.now();
    state.lyricsSlewMs = 0;
    state.lyricsSnapNext = true;
    resumeFollow();
  }

  // ---------- lyrics reading controls ----------
  /** Five fixed sizes for the words. A stepper rather than a slider: the reader
   *  picks one of five legible sizes instead of hunting for a value. */
  const LYRIC_SIZE_STEPS = ['1.05rem', '1.25rem', '1.5rem', '1.85rem', '2.2rem'];
  const LYRIC_SIZE_KEY = 'navidrome-mcp.lyric-size';

  const LYRIC_OFFSET_KEY = 'navidrome-mcp.lyric-offset';
  const LYRIC_OFFSET_STEP_MS = 100;
  /** Past a few seconds the nudge stops correcting latency and starts guessing. */
  const LYRIC_OFFSET_LIMIT_MS = 5000;

  // localStorage throws outright where site data is blocked, so both accessors
  // are wrapped and a failure leaves the default in place.
  function prefRead(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function prefWrite(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // The choice still holds for the life of this page, so there is nothing
      // to recover and nothing worth telling the reader.
    }
  }

  function readStoredInt(key, min, max) {
    const parsed = Number.parseInt(prefRead(key) ?? '', 10);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
    return parsed;
  }

  function applyLyricSize() {
    els.lyricsView.style.setProperty('--lyric-size', LYRIC_SIZE_STEPS[state.lyricsSizeStep]);
    els.lyricsSizeDown.disabled = state.lyricsSizeStep === 0;
    els.lyricsSizeUp.disabled = state.lyricsSizeStep === LYRIC_SIZE_STEPS.length - 1;
  }

  // A resize moves every row below the active one, so the centred line is put
  // back under the reader's eyes instead of drifting off the screen with them.
  function recenterActiveLine() {
    const row = lyricsRows[lyricsActiveIndex];
    if (state.lyricsFollowing && row !== undefined) centerRow(row, 'auto');
  }

  function stepLyricSize(delta) {
    const next = Math.max(0, Math.min(LYRIC_SIZE_STEPS.length - 1, state.lyricsSizeStep + delta));
    if (next === state.lyricsSizeStep) return;
    state.lyricsSizeStep = next;
    prefWrite(LYRIC_SIZE_KEY, String(next));
    applyLyricSize();
    recenterActiveLine();
  }

  function fmtOffset(offsetMs) {
    const sign = offsetMs > 0 ? '+' : (offsetMs < 0 ? '-' : '');
    return `${sign}${(Math.abs(offsetMs) / 1000).toFixed(1)} s`;
  }

  function renderLyricOffset() {
    els.lyricsOffsetValue.textContent = fmtOffset(state.lyricsOffsetMs);
    els.lyricsOffsetDown.disabled = state.lyricsOffsetMs <= -LYRIC_OFFSET_LIMIT_MS;
    els.lyricsOffsetUp.disabled = state.lyricsOffsetMs >= LYRIC_OFFSET_LIMIT_MS;
  }

  function nudgeLyricOffset(deltaMs) {
    const raw = state.lyricsOffsetMs + deltaMs;
    const next = Math.max(-LYRIC_OFFSET_LIMIT_MS, Math.min(LYRIC_OFFSET_LIMIT_MS, raw));
    if (next === state.lyricsOffsetMs) return;
    state.lyricsOffsetMs = next;
    prefWrite(LYRIC_OFFSET_KEY, String(next));
    renderLyricOffset();
  }

  // Only timed lines carry a sync worth nudging, so anything else takes the
  // whole affordance away rather than offering a control that changes nothing.
  function setOffsetControlVisible(visible) {
    setHidden(els.lyricsSettings, !visible);
    if (!visible && els.lyricsSettingsDialog.open) els.lyricsSettingsDialog.close();
  }

  function loadLyricPrefs() {
    // INPUT
    const size = readStoredInt(LYRIC_SIZE_KEY, 0, LYRIC_SIZE_STEPS.length - 1);
    const offset = readStoredInt(LYRIC_OFFSET_KEY, -LYRIC_OFFSET_LIMIT_MS, LYRIC_OFFSET_LIMIT_MS);

    // PROCESS
    if (size !== null) state.lyricsSizeStep = size;
    // A stored value off the 100ms grid would hold every later nudge off it too.
    if (offset !== null) {
      state.lyricsOffsetMs = Math.round(offset / LYRIC_OFFSET_STEP_MS) * LYRIC_OFFSET_STEP_MS;
    }

    // OUTPUT
    applyLyricSize();
    renderLyricOffset();
  }

  // ---------- screen wake ----------
  /** The fallback video's source scheme. The CSP `media-src` directive has to
   *  permit exactly this, because a `default-src 'self'` fallback blocks it. */
  const WAKE_VIDEO_SCHEME = 'data:';

  /** Five seconds of 32x32 black H.264, five frames, looped. Playing video is the
   *  only lever a plain-http origin has, because `navigator.wakeLock` exists only
   *  in a secure context. Several frames, not one: a single-frame clip never
   *  leaves HAVE_METADATA in Chrome, so its clock never runs and nothing is held. */
  const WAKE_VIDEO_SRC = `${WAKE_VIDEO_SCHEME}video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMBbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAE4gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAlB0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAE4gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAACAAAAAgAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAABOIAAAAAAABAAAAAAHIbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAABQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABc21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAATNzdGJsAAAAu3N0c2QAAAAAAAAAAQAAAKthdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAACAAIABIAAAASAAAAAAAAAABDExhdmMgbGlieDI2NAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAMWF2Y0MBZBAK/+EAFGdkEAqsuS2AiAAAAwAIAAADABAgAQAGaO4BlLIs/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAARgAAAAAAAAABhzdHRzAAAAAAAAAAEAAAAFAABAAAAAABxzdHNjAAAAAAAAAAEAAAABAAAABQAAAAEAAAAoc3RzegAAAAAAAAAAAAAABQAAAmgAAAAVAAAAFQAAABUAAAAVAAAAFHN0Y28AAAAAAAAAAQAAAzEAAAA9dWR0YQAAADVtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAAhpbHN0AAAACGZyZWUAAALEbWRhdAAAAlEGBf//TdxF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjUgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MSBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTMzIG1lPXVtaCBzdWJtZT0xMCBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0wIG1lX3JhbmdlPTI0IGNocm9tYV9tZT0xIHRyZWxsaXM9MiA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0wIHdlaWdodHA9MCBrZXlpbnQ9MSBrZXlpbnRfbWluPTEgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjPWNyZiBtYnRyZWU9MCBjcmY9NTEuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAAA9liIQEv/yD3Ao1LjjJn8EAAAARZYiCAc/+2QfApf2pQjl6n8AAAAARZYiEBz/+2QfApf2pQjl6n8EAAAARZYiCAc/+2QfApf2pQjl6n8AAAAARZYiEBz/+2QfApf2pQjl6n8E=`;

  // Holds the device screen awake while the words are moving. One `held` flag
  // decides for both paths, so a repeat acquire and a stray release do nothing.
  const wakeHold = (() => {
    let held = false;
    let generation = 0;
    let sentinel = null;
    let video = null;

    function hasWakeLock() {
      return typeof navigator.wakeLock?.request === 'function';
    }

    async function lockScreen() {
      // A request in flight outlives the hold that started it, so the grant is
      // stamped with that hold and discarded when it comes back to a later one.
      // Without the stamp an orphaned lock keeps the screen awake forever.
      const mine = generation;
      let granted = null;
      try {
        granted = await navigator.wakeLock.request('screen');
      } catch {
        // Refused by policy, or the page hid while the request was in flight.
        // The reader has nothing to act on either way, so the hold is dropped.
        return;
      }
      if (!held || generation !== mine || sentinel !== null) {
        void granted.release().catch(() => { /* nothing left to hold */ });
        return;
      }
      // The platform drops the lock whenever the page hides, so the handle goes
      // with it and the visibilitychange listener below asks for a fresh one.
      granted.addEventListener('release', () => {
        if (sentinel === granted) sentinel = null;
      });
      sentinel = granted;
    }

    function stopVideo() {
      if (video === null) return;
      video.pause();
      video.removeAttribute('src');
      video.remove();
      video = null;
    }

    function startVideo() {
      const el = document.createElement('video');
      el.loop = true;
      el.muted = true;
      el.playsInline = true;
      // iOS reads the markup attributes, not the IDL properties, when it decides
      // whether an autoplay is permitted.
      el.setAttribute('muted', '');
      el.setAttribute('playsinline', '');
      el.setAttribute('aria-hidden', 'true');
      el.tabIndex = -1;
      // Laid out but imperceptible: a video the layout drops entirely stops
      // counting as playing video, which is the only reason this element exists.
      el.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none;';
      el.src = WAKE_VIDEO_SRC;
      video = el;
      document.body.appendChild(el);
      el.play().catch(() => {
        // An autoplay refusal degrades to no hold rather than leaving a paused
        // element in the page holding nothing.
        if (video === el) stopVideo();
      });
    }

    function acquire() {
      if (held) return;
      held = true;
      generation += 1;
      if (hasWakeLock()) {
        void lockScreen();
        return;
      }
      startVideo();
    }

    function release() {
      if (!held) return;
      const granted = sentinel;
      held = false;
      generation += 1;
      sentinel = null;
      if (granted !== null) void granted.release().catch(() => { /* already gone */ });
      stopVideo();
    }

    // A wake lock is dropped automatically whenever the page hides, and the same
    // transition pauses the fallback video, so coming back re-arms both.
    document.addEventListener('visibilitychange', () => {
      if (!held || document.visibilityState !== 'visible') return;
      if (hasWakeLock()) {
        if (sentinel === null) void lockScreen();
        return;
      }
      if (video !== null && video.paused) {
        void video.play().catch(() => { /* the hold is lost, and unreportable */ });
      }
    });

    // pagehide rather than beforeunload, which iOS never fires.
    window.addEventListener('pagehide', release);

    return { acquire, release };
  })();

  // The hold answers to one condition, so the open, close and play/pause paths
  // all route through here instead of each deciding for itself.
  function syncWakeHold() {
    const np = state.nowPlaying;
    // An idle mpv reports paused:false with queueIndex -1, so `paused` alone
    // would keep holding the screen after the last queue entry has played out.
    const playing = np?.engineRunning === true && (np.queueIndex ?? -1) >= 0 && !state.paused;
    if (state.lyricsOpen && playing) wakeHold.acquire();
    else wakeHold.release();
  }

  // ---------- lyrics content states ----------
  function clearLyricsBody() {
    resetLyricsFollow();
    els.lyricsLines.replaceChildren();
    els.lyricsStatus.replaceChildren();
    setOffsetControlVisible(false);
  }

  function setLyricsStatus(text) {
    clearLyricsBody();
    els.lyricsStatus.textContent = text;
  }

  // A placard is more than one run of text, so it is built as nodes rather than
  // pushed through setLyricsStatus. `link` is { text, href } or null.
  function renderPlacard(headline, note, link) {
    // INPUT
    const head = document.createElement('span');
    const detail = document.createElement('span');
    const anchor = link === null ? null : document.createElement('a');

    // PROCESS
    head.className = 'lyrics-placard-head';
    head.textContent = headline;
    detail.className = 'lyrics-placard-note';
    detail.textContent = note;
    if (anchor !== null) {
      anchor.className = 'lyrics-placard-link';
      anchor.href = link.href;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.textContent = link.text;
    }

    // OUTPUT
    clearLyricsBody();
    els.lyricsStatus.append(head, detail);
    if (anchor !== null) els.lyricsStatus.appendChild(anchor);
  }

  // The attribution url is server-supplied text, so only an http(s) origin is
  // allowed to reach an href.
  function lrclibPublishUrl(dto) {
    const base = typeof dto.attribution?.url === 'string' ? dto.attribution.url.trim() : '';
    if (!/^https?:\/\//i.test(base)) return null;
    return `${base.replace(/\/+$/, '')}/publish`;
  }

  // An unconfigured server has to read as unconfigured: with no second sentence
  // a disabled LRCLIB looks like a library that simply has no lyrics.
  function renderNoLyrics(dto) {
    // INPUT
    const enabled = state.lyricsLrclibEnabled;
    const publishUrl = enabled ? lrclibPublishUrl(dto) : null;
    const note = enabled
      ? 'The file carries none, and LRCLIB has no match for this track.'
      : 'The file carries none, and LRCLIB lookup is disabled.';

    // OUTPUT
    renderPlacard(
      'No lyrics found',
      note,
      publishUrl === null ? null : { text: 'Add them on LRCLIB', href: publishUrl },
    );
  }

  function lyricsLineEl(text, index) {
    const li = document.createElement('li');
    li.className = 'lyric-line';
    // Lyrics are untrusted third-party text: textContent only, never innerHTML.
    li.textContent = text;
    // Only a timed row can be tapped to seek, so only a timed row is indexed.
    if (index !== null) li.dataset.index = String(index);
    return li;
  }

  // Four content states share one entry point: instrumental, timed, plain, and
  // nothing found. Only the timed state follows the player.
  function renderLyricsLines(dto) {
    // INPUT
    const timed = dto.hasSynced === true && Array.isArray(dto.synced) ? dto.synced : [];
    const plain = typeof dto.unsynced === 'string' ? dto.unsynced : '';
    let rows = [];

    if (dto.isInstrumental === true) {
      renderPlacard('Instrumental', 'This track has no words.', null);
      return;
    }

    // PROCESS
    clearLyricsBody();
    if (timed.length > 0) {
      rows = timed.map((line, index) => lyricsLineEl(line.text, index));
    } else if (plain.trim() !== '') {
      rows = plain.split(/\r?\n/).map((text) => lyricsLineEl(text, null));
    }

    // OUTPUT
    if (rows.length === 0) {
      renderNoLyrics(dto);
      return;
    }
    lyricsTimed = timed;
    lyricsRows = timed.length > 0 ? rows : [];
    els.lyricsLines.classList.toggle('is-synced', timed.length > 0);
    els.lyricsLines.replaceChildren(...rows);
    setOffsetControlVisible(timed.length > 0);
    // A snapshot may have landed while the lookup was in flight, leaving a
    // correction that belongs to no row on screen.
    state.lyricsSnapNext = true;
  }

  async function loadLyrics(songId, generation) {
    const dto = await lyricsGet(songId);
    // A track change while this was in flight already claimed the view.
    if (generation !== state.lyricsGeneration) return;
    if (dto === null) {
      setLyricsStatus('Could not load lyrics.');
      return;
    }
    renderLyricsLines(dto);
  }

  function renderLyricsHeader() {
    const np = state.nowPlaying;
    const running = np?.engineRunning === true;
    els.lyricsTitle.textContent = running ? (np.title ?? 'Unknown title') : 'No track loaded';
    els.lyricsArtist.textContent = running ? (np.artist ?? '') : '';
  }

  // The overlay's own labels and seek line. This READS the existing progress
  // clock and never writes to it, so the main progress bar keeps its behavior.
  function renderLyricsTransport() {
    // INPUT
    const duration = state.duration;
    let displayed = state.posBaseSeconds;
    let percent = 0;

    // PROCESS
    if (!state.paused) {
      displayed = state.posBaseSeconds + (Date.now() - state.posBaseTimestampMs) / 1000;
      if (duration > 0 && displayed > duration) displayed = duration;
    }
    percent = duration > 0 ? (displayed / duration) * 100 : 0;

    // OUTPUT
    els.lyricsPosition.textContent = fmtTime(displayed);
    els.lyricsDuration.textContent = fmtTime(duration);
    setProgressVar(els.lyricsSeekLine, percent);
  }

  // A loop of its own, running only while the overlay is up, so the main
  // tickProgress loop stays untouched.
  let lyricsRaf = null;
  function tickLyrics() {
    const nowMs = Date.now();
    renderLyricsTransport();
    tickLyricsFollow(nowMs);
    lyricsRaf = requestAnimationFrame(tickLyrics);
  }

  function openLyrics() {
    if (state.lyricsOpen) return;
    state.lyricsOpen = true;
    setHidden(els.lyricsView, false);
    renderLyricsHeader();
    renderLyricsTransport();
    // The loop was not running while the overlay was down, so the frame clock
    // and any outstanding correction are stale.
    lyricsFrameWallMs = 0;
    state.lyricsSlewMs = 0;
    resumeFollow();
    if (lyricsRaf === null) lyricsRaf = requestAnimationFrame(tickLyrics);
    syncWakeHold();
    // preventScroll: focusing a control would otherwise scroll the main view
    // behind the overlay, which the reader would find moved on the way back.
    els.lyricsBack.focus({ preventScroll: true });
  }

  // Nothing here touches window scroll, so the main view comes back exactly
  // where the reader left it.
  function closeLyrics() {
    if (!state.lyricsOpen) return;
    state.lyricsOpen = false;
    els.lyricsView.classList.remove('is-immersive');
    setHidden(els.lyricsView, true);
    if (lyricsRaf !== null) {
      cancelAnimationFrame(lyricsRaf);
      lyricsRaf = null;
    }
    syncWakeHold();
    els.openLyrics.focus({ preventScroll: true });
  }

  // Track-change hook: repaint the overlay for the new song and warm the next
  // queue entry. A radio stream carries no Navidrome songId at all, so it has
  // no lyrics path and the button goes away.
  function syncLyrics() {
    // INPUT
    const np = state.nowPlaying;
    const isRadio = np?.isRadio === true;
    const index = (np?.engineRunning === true && typeof np.queueIndex === 'number')
      ? np.queueIndex
      : null;
    const inQueue = index !== null && !isRadio;
    const songId = inQueue ? queueSongId(index) : null;
    const nextSongId = inQueue ? queueSongId(index + 1) : null;
    let generation = 0;

    // PROCESS
    setHidden(els.openLyrics, isRadio);
    if (isRadio) closeLyrics();
    renderLyricsHeader();
    if (songId === state.lyricsSongId) return;

    state.lyricsSongId = songId;
    state.lyricsGeneration += 1;
    // A new track starts followed, and lands without animating through it.
    setFollowing(true);
    state.lyricsSnapNext = true;
    generation = state.lyricsGeneration;
    mountCover(els.lyricsCover, songId, () => state.lyricsSongId === songId);

    // OUTPUT
    // A null songId also covers the window before the queue snapshot lands:
    // the id is unknown, and /api/lyrics/:songId 404s on an id not in the queue.
    if (songId === null) {
      setLyricsStatus('Nothing is playing.');
      return;
    }
    setLyricsStatus('Loading lyrics…');
    void loadLyrics(songId, generation);
    if (nextSongId !== null) void lyricsGet(nextSongId);
  }

  function bindLyricsControls() {
    els.openLyrics.addEventListener('click', openLyrics);
    els.lyricsBack.addEventListener('click', closeLyrics);
    els.lyricsScroll.addEventListener('click', () => {
      els.lyricsView.classList.toggle('is-immersive');
      // A gesture that ends in a click was a tap, not a scroll, so the suspend
      // its pointerdown armed is taken back here.
      resumeFollow();
    });
    els.lyricsScroll.addEventListener('pointerdown', suspendFollow);
    els.lyricsScroll.addEventListener('touchstart', suspendFollow, { passive: true });
    els.lyricsScroll.addEventListener('wheel', suspendFollow, { passive: true });
    els.lyricsLines.addEventListener('click', seekToTappedLine);
    lyricsPill.addEventListener('click', resumeFollow);
    els.lyricsPrev.addEventListener('click', () => post('/api/controls/previous'));
    els.lyricsPlay.addEventListener('click', togglePlayPause);
    els.lyricsNext.addEventListener('click', () => post('/api/controls/next'));
    els.lyricsSizeDown.addEventListener('click', () => stepLyricSize(-1));
    els.lyricsSizeUp.addEventListener('click', () => stepLyricSize(1));
    els.lyricsSettings.addEventListener('click', () => {
      if (typeof els.lyricsSettingsDialog.showModal === 'function') {
        els.lyricsSettingsDialog.showModal();
      }
    });
    els.lyricsOffsetDown.addEventListener('click', () => nudgeLyricOffset(-LYRIC_OFFSET_STEP_MS));
    els.lyricsOffsetUp.addEventListener('click', () => nudgeLyricOffset(LYRIC_OFFSET_STEP_MS));
    // Back from a backgrounded tab the interpolation is arbitrarily stale.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') state.lyricsSnapNext = true;
    });
    // Immersive mode hides the back control, so Escape is the way out. The
    // settings dialog answers Escape itself, and its keydown reaches here too.
    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape' || els.lyricsSettingsDialog.open) return;
      if (state.lyricsOpen) closeLyrics();
    });
    loadLyricPrefs();
  }

  // ---------- bootstrap ----------
  async function fetchLocalFlag() {
    try {
      const res = await fetch('/api/player-state');
      if (res.ok) {
        const s = await res.json();
        state.isLocal = s.isLocal === true;
        // An absent flag means "assume enabled", so the empty state never
        // claims LRCLIB is off when the server's answer was unreadable.
        state.lyricsLrclibEnabled = s.lyrics?.lrclibEnabled !== false;
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
