// Navidrome MCP web remote entry point. Production serves the copy pnpm build places in dist/webui/public, so an edit here needs a build and a server restart.

import { getJson } from './api.js';
import { connect } from './connection.js';
import { bindPowerButton, setLocalPeer } from './local-controls.js';
import { snapLyricsClock } from './lyrics-clock.js';
import { setLrclibEnabled } from './lyrics-content.js';
import { bindLyricsView, syncLyricsToSnapshot } from './lyrics-view.js';
import { bindNetworkInfo } from './network-info.js';
import { renderNowPlaying } from './now-playing.js';
import { bindPlayDialog } from './play-dialog.js';
import { rebaseClock } from './playback-clock.js';
import { bindQueue, renderQueue, revealCurrentRow } from './queue.js';
import { bindSettings } from './settings.js';
import { playingIndex, storeSnapshot } from './snapshot.js';
import { applyTheme, applyThemeHint } from './theme.js';
import { bindTransport, renderTransport } from './transport.js';
import { bindVolume, renderVolume } from './volume.js';

// The clock rebases first, since the transport and the lyrics read its paused state.
function applySnapshot(raw) {
  const { nowPlaying, queue, status, player } = storeSnapshot(raw);
  rebaseClock(nowPlaying);
  renderNowPlaying(nowPlaying);
  renderTransport(nowPlaying);
  renderVolume(status);
  renderQueue(queue, playingIndex(nowPlaying));
  syncLyricsToSnapshot(nowPlaying);
  if (player !== null) applyTheme(player.theme);
  // Last, so the rows reflect this snapshot before the reveal measures them.
  revealCurrentRow(nowPlaying);
}

async function loadPlayerState() {
  const state = await getJson('/api/player-state');
  if (state === null) return;
  setLocalPeer(state.isLocal === true);
  // An absent flag means enabled, so an unreadable answer never claims LRCLIB is off.
  setLrclibEnabled(state.lyrics?.lrclibEnabled !== false);
  applyTheme(state.theme);
}

function bootstrap() {
  // First, so a forced theme replaces the system one before anything else renders.
  applyThemeHint();
  bindTransport();
  bindVolume();
  bindQueue();
  bindPlayDialog();
  bindNetworkInfo();
  bindSettings();
  bindPowerButton();
  bindLyricsView();
  void loadPlayerState();
  // A reconnect may have missed any amount of the song, so the next snapshot lands the lyrics clock.
  connect({ onOpen: snapLyricsClock, onSnapshot: applySnapshot });
}

bootstrap();
