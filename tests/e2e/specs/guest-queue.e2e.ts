/**
 * Navidrome MCP Server - e2e guest queueing, host handling of guest songs and playback
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Host songs come from The Slip and guest songs from Ghosts I–IV unless a test says otherwise, so a
 * guest add never meets the duplicate rule by accident.
 */

import { DEFAULT_GUEST_QUEUE_LIMIT } from '../../../src/constants/defaults.js';
import { HOST_JUKEBOX_LABEL } from '../../../src/webui/jukebox/jukebox-names.js';
import { ALLOWED_ALBUMS, type AllowedAlbum, songsOf } from '../content.js';
import { expect, joinGuest, test, TEST_VOLUME } from '../fixtures.js';
import type { AdminApi, LibrarySong } from '../harness/admin-api.js';
import { GuestPage } from '../pages/guest-page.js';

const NO_MATCH_QUERY = 'zzqqxxnomatch';
const RAISED_LIMIT = 5;
const ALREADY_WAITING = 'That song is already waiting in the queue.';
const LIMIT_OF_ONE =
  'A guest can have at most 1 song waiting at a time. Add another once one of yours starts playing or you remove one.';
// The page waits out the add rate's retryAfterMs, then the retried add and the next snapshot land.
const RETRY_SETTLE_MS = 10_000;

function songsLeft(remaining: number, limit = DEFAULT_GUEST_QUEUE_LIMIT): string {
  return `${String(remaining)} of ${String(limit)} songs left`;
}

/**
 * Searches the album's name on the guest page and returns the album's songs the results list, in album
 * order. A large album lists only the songs that fit the result limit, so a test names how many it needs.
 * The tests find a song's row by its title, so a listed title on two rows fails here with the title named.
 */
async function searchAlbum(guest: GuestPage, api: AdminApi, album: AllowedAlbum, needed = 1): Promise<LibrarySong[]> {
  const songs = await songsOf(api, album);
  await guest.search(album);
  // Each artist and album line holds the album name, so the old results never satisfy the wait.
  await expect(guest.results).toContainText(album);
  const results = await guest.listedSongs();
  const ids = new Set(results.map((result) => result.id));
  const listed = songs.filter((song) => ids.has(song.id));
  const shared = listed.find((song) => results.filter((result) => result.title === song.title).length > 1);
  if (shared !== undefined) {
    throw new Error(`e2e: a guest search for "${album}" lists the title "${shared.title}" on more than one row, so its row is ambiguous.`);
  }
  if (listed.length < needed) {
    throw new Error(`e2e: a guest search for "${album}" lists ${String(listed.length)} of its songs, and the test needs ${String(needed)}.`);
  }
  return listed;
}

test('a guest search for each allowed album lists its songs with Add buttons, and a search with no match says so', async ({ jukebox, openGuest }) => {
  const { guest } = await joinGuest(openGuest, jukebox, await jukebox.openJukebox());

  for (const album of Object.values(ALLOWED_ALBUMS)) {
    const listed = await searchAlbum(guest, jukebox, album);

    const answer = await guest.searchApi(album);
    await expect(guest.resultRows).toHaveCount(answer.length);
    expect(await guest.listedSongs()).toEqual(answer.map(({ id, title }) => ({ id, title })));
    await expect(guest.searchStatus).toHaveText('');
    for (const song of listed) {
      await expect(guest.addButton(song.title)).toHaveText('Add');
      await expect(guest.addButton(song.title)).toBeEnabled();
    }
  }

  await guest.search(NO_MATCH_QUERY);

  await expect(guest.searchStatus).toHaveText('No songs match that search.');
  await expect(guest.resultRows).toHaveCount(0);
  expect(await guest.searchApi(NO_MATCH_QUERY)).toEqual([]);
});

test('a guest add lands at the end of the host queue, labeled with the guest, and spends a slot', async ({ hostPage, jukebox, mpv, openGuest }) => {
  const [hostSong] = await songsOf(jukebox, ALLOWED_ALBUMS.theSlip);
  await jukebox.queueSong(hostSong.id);
  await expect(hostPage.queueRow(hostSong.title)).toBeVisible();
  const { guest, label } = await joinGuest(openGuest, jukebox, await jukebox.openJukebox());
  const [song] = await searchAlbum(guest, jukebox, ALLOWED_ALBUMS.ghosts);
  await expect(guest.songsLeft).toHaveText(songsLeft(DEFAULT_GUEST_QUEUE_LIMIT));

  await guest.addButton(song.title).click();

  await expect(guest.addButton(song.title)).toHaveText('Added');
  await expect(guest.songsLeft).toHaveText(songsLeft(DEFAULT_GUEST_QUEUE_LIMIT - 1));
  await expect(hostPage.queueRows).toHaveCount(2);
  await expect(hostPage.queueRows.last()).toContainText(song.title);
  await expect(hostPage.queueRow(song.title)).toContainText(`Added by ${label}`);
  await expect(hostPage.queuePlayButton(song.title)).toHaveAccessibleName(`Play track 2: ${song.title}, added by ${label}`);
  await expect(guest.queueRow(song.title)).toHaveClass(/\bmine\b/);
  await expect(guest.removeButton(song.title)).toBeVisible();
  await expect.poll(() => mpv.queueSongIds()).toEqual([hostSong.id, song.id]);
  expect((await jukebox.guests())[0]?.songs.map((entry) => entry.title)).toEqual([song.title]);
});

test('a second add within the add interval waits out the 429 and then lands', async ({ hostPage, jukebox, mpv, openGuest }) => {
  const { guest } = await joinGuest(openGuest, jukebox, await jukebox.openJukebox());
  const [first, second] = await searchAlbum(guest, jukebox, ALLOWED_ALBUMS.ghosts, 2);
  const refused = guest.page.waitForResponse((response) => response.url().endsWith('/api/guest/queue') && response.status() === 429);

  await guest.addButton(first.title).click();
  await guest.addButton(second.title).click();

  const refusal = (await (await refused).json()) as { retryAfterMs?: number };
  expect(refusal.retryAfterMs).toBeGreaterThan(0);
  await expect(guest.addButton(first.title)).toHaveText('Added');
  await expect(guest.addButton(second.title)).toHaveText('Adding…');
  await expect(guest.addButton(second.title)).toHaveText('Added', { timeout: (refusal.retryAfterMs ?? 0) + RETRY_SETTLE_MS });
  await expect(hostPage.queueRows).toHaveCount(2);
  await expect.poll(() => mpv.queueSongIds()).toEqual([first.id, second.id]);
  await expect(guest.songsLeft).toHaveText(songsLeft(DEFAULT_GUEST_QUEUE_LIMIT - 2));
});

test('a song waiting in the queue shows In queue to another guest, and the API refuses it as a duplicate', async ({ jukebox, mpv, openGuest }) => {
  const joinLink = await jukebox.openJukebox();
  const { guest: adder } = await joinGuest(openGuest, jukebox, joinLink);
  const [song] = await searchAlbum(adder, jukebox, ALLOWED_ALBUMS.ghosts);
  await adder.addButton(song.title).click();
  await expect(adder.addButton(song.title)).toHaveText('Added');
  const { guest: other } = await joinGuest(openGuest, jukebox, joinLink);

  await searchAlbum(other, jukebox, ALLOWED_ALBUMS.ghosts);

  await expect(other.addButton(song.title)).toHaveText('In queue');
  await expect(other.addButton(song.title)).toBeDisabled();
  const refusal = await other.postAdd(song.id);
  expect(refusal.status()).toBe(409);
  expect(await refusal.json()).toEqual({ error: ALREADY_WAITING, code: 'duplicate' });
  await expect(other.songsLeft).toHaveText(songsLeft(DEFAULT_GUEST_QUEUE_LIMIT));
  expect(await mpv.queueSongIds()).toEqual([song.id]);
});

test('at the song limit the count reads 0 left, every Add button is disabled and the API refuses the add', async ({ jukebox, mpv, openGuest }) => {
  await jukebox.setGuestQueueLimit(1);
  const { guest } = await joinGuest(openGuest, jukebox, await jukebox.openJukebox());
  await expect(guest.songsLeft).toHaveText(songsLeft(1, 1));
  const [song, another] = await searchAlbum(guest, jukebox, ALLOWED_ALBUMS.ghosts, 2);
  const resultCount = (await guest.listedSongs()).length;

  await guest.addButton(song.title).click();

  await expect(guest.songsLeft).toHaveText(songsLeft(0, 1));
  await expect(guest.addButton(song.title)).toHaveText('Added');
  await expect(guest.addStateButtons()).toHaveCount(resultCount - 1);
  for (const button of await guest.addStateButtons().all()) await expect(button).toBeDisabled();
  const refusal = await guest.postAdd(another.id);
  expect(refusal.status()).toBe(429);
  expect(await refusal.json()).toEqual({ error: LIMIT_OF_ONE, code: 'limit' });
  expect(await mpv.queueSongIds()).toEqual([song.id]);
});

test('the host changes the song limit in the Guests dialog and the guest count follows without a reload', async ({ hostPage, jukebox, openGuest }) => {
  const { guest } = await joinGuest(openGuest, jukebox, await jukebox.openJukebox());
  await expect(guest.songsLeft).toHaveText(songsLeft(DEFAULT_GUEST_QUEUE_LIMIT));
  await hostPage.openGuestsDialog();
  await expect(hostPage.guestLimitInput).toHaveValue(String(DEFAULT_GUEST_QUEUE_LIMIT));

  await hostPage.setGuestLimit(RAISED_LIMIT);

  await expect(hostPage.guestLimitMessage).toHaveText('Saved.');
  await expect(guest.songsLeft).toHaveText(songsLeft(RAISED_LIMIT, RAISED_LIMIT));
  expect(await jukebox.guestQueueLimit()).toBe(RAISED_LIMIT);
});

test('a guest removes its own waiting song after the prompt, and has no remove control on other songs', async ({ hostPage, jukebox, mpv, openGuest }) => {
  const [hostSong] = await songsOf(jukebox, ALLOWED_ALBUMS.theSlip);
  await jukebox.queueSong(hostSong.id);
  const joinLink = await jukebox.openJukebox();
  const { guest: owner } = await joinGuest(openGuest, jukebox, joinLink);
  const [ownSong, otherSong] = await searchAlbum(owner, jukebox, ALLOWED_ALBUMS.ghosts, 2);
  await owner.addButton(ownSong.title).click();
  await expect(owner.addButton(ownSong.title)).toHaveText('Added');
  const { guest: other } = await joinGuest(openGuest, jukebox, joinLink);
  await searchAlbum(other, jukebox, ALLOWED_ALBUMS.ghosts);
  await other.addButton(otherSong.title).click();
  await expect(other.addButton(otherSong.title)).toHaveText('Added');
  await expect(owner.queueRows).toHaveCount(3);
  await expect(owner.queueRow(otherSong.title)).toBeVisible();
  await expect(owner.removeButton(hostSong.title)).toHaveCount(0);
  await expect(owner.removeButton(otherSong.title)).toHaveCount(0);
  await expect(owner.queue.getByRole('button')).toHaveCount(1);

  const prompt = owner.acceptNextPrompt();
  await owner.removeButton(ownSong.title).click();

  await expect(owner.queueRow(ownSong.title)).toHaveCount(0);
  expect(await prompt).toBe(`Remove ${ownSong.title} from the queue?`);
  await expect(owner.songsLeft).toHaveText(songsLeft(DEFAULT_GUEST_QUEUE_LIMIT));
  await expect(owner.addButton(ownSong.title)).toHaveText('Add');
  await expect(hostPage.queueRows).toHaveCount(2);
  await expect(hostPage.queueRow(ownSong.title)).toHaveCount(0);
  await expect(other.queueRow(ownSong.title)).toHaveCount(0);
  await expect.poll(() => mpv.queueSongIds()).toEqual([hostSong.id, otherSong.id]);
});

test('the host removal of a guest song names the guest, keeps the song on dismiss and removes it on accept', async ({ hostPage, jukebox, mpv, openGuest }) => {
  const [hostSong] = await songsOf(jukebox, ALLOWED_ALBUMS.theSlip);
  await jukebox.queueSong(hostSong.id);
  const { guest, label } = await joinGuest(openGuest, jukebox, await jukebox.openJukebox());
  const [song] = await searchAlbum(guest, jukebox, ALLOWED_ALBUMS.ghosts);
  await guest.addButton(song.title).click();
  await expect(hostPage.queueRow(song.title)).toBeVisible();
  const removePrompt = `Remove ${song.title}? ${label} added it.`;

  const dismissed = hostPage.dismissNextPrompt();
  await hostPage.removeButton(song.title).click();

  expect(await dismissed).toBe(removePrompt);
  await expect(hostPage.queueRow(song.title)).toBeVisible();
  expect(await mpv.queueSongIds()).toEqual([hostSong.id, song.id]);

  const accepted = hostPage.acceptNextPrompt();
  await hostPage.removeButton(song.title).click();

  await expect(hostPage.queueRow(song.title)).toHaveCount(0);
  expect(await accepted).toBe(removePrompt);
  await expect(guest.queueRow(song.title)).toHaveCount(0);
  await expect(guest.songsLeft).toHaveText(songsLeft(DEFAULT_GUEST_QUEUE_LIMIT));
  await expect.poll(() => mpv.queueSongIds()).toEqual([hostSong.id]);
  expect((await jukebox.guests())[0]?.songs).toEqual([]);
});

test('clearing a queue that holds guest songs asks with their count and clears on accept', async ({ hostPage, jukebox, mpv, openGuest }) => {
  const [hostSong] = await songsOf(jukebox, ALLOWED_ALBUMS.theSlip);
  await jukebox.queueSong(hostSong.id);
  const joinLink = await jukebox.openJukebox();
  const guests: GuestPage[] = [];
  for (const pick of [0, 1]) {
    const { guest } = await joinGuest(openGuest, jukebox, joinLink);
    const listed = await searchAlbum(guest, jukebox, ALLOWED_ALBUMS.ghosts, 2);
    await guest.addButton(listed[pick].title).click();
    await expect(guest.addButton(listed[pick].title)).toHaveText('Added');
    guests.push(guest);
  }
  await expect(hostPage.queueRows).toHaveCount(3);

  const prompt = hostPage.acceptNextPrompt();
  await hostPage.clearQueueButton.click();

  await expect(hostPage.emptyQueueText).toBeVisible();
  expect(await prompt).toBe('Clear the queue? 2 songs added from the guest page are removed.');
  for (const guest of guests) {
    await expect(guest.emptyQueueText).toBeVisible();
    await expect(guest.songsLeft).toHaveText(songsLeft(DEFAULT_GUEST_QUEUE_LIMIT));
  }
  await expect.poll(() => mpv.queueSongIds()).toEqual([]);
  expect((await jukebox.guests()).flatMap((entry) => entry.songs)).toEqual([]);
});

// The guest song comes from The Slip, since the replace loads Ghosts I–IV and a song the new queue holds is not restored.
test('a host replace through the play dialog brings the unplayed guest song back at the end of the new queue', async ({ hostPage, jukebox, mpv, openGuest }) => {
  const albumSongs = await songsOf(jukebox, ALLOWED_ALBUMS.ghosts);
  const { guest, label } = await joinGuest(openGuest, jukebox, await jukebox.openJukebox());
  const [song] = await searchAlbum(guest, jukebox, ALLOWED_ALBUMS.theSlip);
  await guest.addButton(song.title).click();
  await expect(hostPage.queueRow(song.title)).toBeVisible();

  await hostPage.replaceQueueWithAlbum(ALLOWED_ALBUMS.ghosts);

  await expect(hostPage.playDialog).toBeHidden();
  await expect(hostPage.queueRows).toHaveCount(albumSongs.length + 1);
  await expect(hostPage.queueRows.last()).toContainText(song.title);
  await expect(hostPage.queueRows.last()).toContainText(`Added by ${label}`);
  await expect(guest.songsLeft).toHaveText(songsLeft(DEFAULT_GUEST_QUEUE_LIMIT - 1));
  await expect.poll(() => mpv.queueSongIds()).toEqual([...albumSongs.map((entry) => entry.id), song.id]);
  expect((await jukebox.guests())[0]?.songs.map((entry) => entry.title)).toEqual([song.title]);
});

test('the admin queues a song from the guest page under the guest limits, labeled as the host', async ({ hostPage, jukebox, mpv }) => {
  await jukebox.openJukebox();
  const hostOnGuestPage = new GuestPage(await hostPage.page.context().newPage());

  await hostOnGuestPage.goto();

  await expect(hostOnGuestPage.welcomeDialog).toContainText(`You are adding songs as ${HOST_JUKEBOX_LABEL}.`);
  await hostOnGuestPage.dismissWelcome();
  await expect(hostOnGuestPage.hostBanner).toBeVisible();
  await expect(hostOnGuestPage.songsLeft).toHaveText(songsLeft(DEFAULT_GUEST_QUEUE_LIMIT));
  const [song] = await searchAlbum(hostOnGuestPage, jukebox, ALLOWED_ALBUMS.theSlip);

  await hostOnGuestPage.addButton(song.title).click();

  await expect(hostOnGuestPage.addButton(song.title)).toHaveText('Added');
  await expect(hostOnGuestPage.songsLeft).toHaveText(songsLeft(DEFAULT_GUEST_QUEUE_LIMIT - 1));
  await expect(hostOnGuestPage.queueRow(song.title)).toContainText(`Added by ${HOST_JUKEBOX_LABEL}`);
  // An add to an empty queue selects the song paused, so its row reads as the current one.
  await expect(hostPage.queuePlayButton(song.title)).toHaveAccessibleName(`Currently playing: ${song.title}, added by ${HOST_JUKEBOX_LABEL}`);
  await expect.poll(() => mpv.queueSongIds()).toEqual([song.id]);
  expect(await jukebox.guests()).toEqual([]);
});

test('mpv plays a guest song the host starts, and pause and next show on the host and guest pages', async ({ hostPage, jukebox, mpv, openGuest }) => {
  const [hostSong] = await songsOf(jukebox, ALLOWED_ALBUMS.theSlip);
  const { guest } = await joinGuest(openGuest, jukebox, await jukebox.openJukebox());
  const [song] = await searchAlbum(guest, jukebox, ALLOWED_ALBUMS.ghosts);
  await guest.addButton(song.title).click();
  await expect(hostPage.queueRow(song.title)).toBeVisible();
  await jukebox.queueSong(hostSong.id);
  await expect(hostPage.queueRows).toHaveCount(2);
  // An add to an empty queue selects the song paused.
  await expect(hostPage.stateBadge).toHaveText('Paused');
  const views = [hostPage, guest];

  await hostPage.playButton.click();

  await mpv.waitUntilPlaying();
  expect(await mpv.read('volume')).toBe(TEST_VOLUME);
  for (const view of views) {
    await expect(view.stateBadge).toHaveText('Playing');
    await expect(view.trackTitle).toHaveText(song.title);
    const start = await view.positionSeconds();
    await expect.poll(() => view.positionSeconds()).toBeGreaterThan(start);
  }

  await hostPage.pauseButton.click();

  for (const view of views) await expect(view.stateBadge).toHaveText('Paused');
  await expect.poll(() => mpv.read('pause')).toBe(true);

  await hostPage.nextButton.click();

  for (const view of views) await expect(view.trackTitle).toHaveText(hostSong.title);
  await expect.poll(() => mpv.readNumber('playlist-pos')).toBe(1);
});
