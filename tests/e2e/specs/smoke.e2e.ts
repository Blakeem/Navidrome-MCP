/**
 * Navidrome MCP Server - e2e harness smoke tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Proves each harness part works, so a later spec's failure points at the product.
 */

import { getDefaultIpcPath } from '../../../src/services/playback/mpv-process.js';
import { ALLOWED_ALBUMS, songsOf } from '../content.js';
import { expect, test, TEST_VOLUME } from '../fixtures.js';
import { ScrobbleGuard } from '../harness/scrobble-guard.js';
import { GUEST_PATH } from '../pages/guest-page.js';

// A trip point far below any scrobble point, so the real guard path runs within seconds.
const EARLY_TRIP_SECONDS = 1;

test('the host page connects and shows the jukebox controls', async ({ hostPage }) => {
  await expect(hostPage.liveIndicator).toBeVisible();
  await expect(hostPage.jukeboxButton).toBeVisible();
  await expect(hostPage.guestsButton).toBeVisible();
});

test('the instance mpv listens on a private pipe', async ({ instance, mpv }) => {
  expect(instance.ipcPath).not.toBe(getDefaultIpcPath());
  // The reset fixture starts mpv through the instance, so the probe finds it on the private pipe.
  await expect.poll(() => mpv.isRunning()).toBe(true);
});

test('mpv plays a song from an allowed album on a real audio output at the test volume', async ({ hostPage, jukebox, mpv }) => {
  const [song] = await songsOf(jukebox, ALLOWED_ALBUMS.theSlip);

  await jukebox.playSong(song.id);

  await mpv.waitUntilPlaying();
  expect(await mpv.read('volume')).toBe(TEST_VOLUME);
  await expect(hostPage.trackTitle).toHaveText(song.title);
});

test('the scrobble guard pauses a track that reaches its trip point', async ({ jukebox, mpv }) => {
  const [song] = await songsOf(jukebox, ALLOWED_ALBUMS.ghosts);
  const guard = new ScrobbleGuard(mpv, () => EARLY_TRIP_SECONDS);
  guard.start();

  // A guard left sampling after a failure would pause every later test's playback at 1 s.
  try {
    await jukebox.playSong(song.id);

    await expect.poll(() => guard.trip, { timeout: 30_000 }).toContain('The scrobble guard paused');
    expect(await mpv.read('pause')).toBe(true);
  } finally {
    await guard.stop();
  }
});

test('a guest joins through a join link and lands on the guest page', async ({ jukebox, openGuest }) => {
  const joinLink = await jukebox.openJukebox();

  const guest = await openGuest(joinLink);

  expect(new URL(guest.page.url()).pathname).toBe(GUEST_PATH);
  await expect(guest.liveIndicator).toBeVisible();
  await expect(guest.searchBox).toBeVisible();
  await expect.poll(async () => (await jukebox.guests()).length).toBe(1);
});
