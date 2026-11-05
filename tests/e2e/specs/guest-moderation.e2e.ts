/**
 * Navidrome MCP Server - e2e Guests dialog: guest list, remove, ban and unban
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Host songs come from The Slip and guest songs from Ghosts I–IV. The host song is queued first, so it
 * stays selected and paused, and every guest song waits behind it.
 */

import { GUEST_ONLINE_WINDOW_MS } from '../../../src/constants/timeouts.js';
import { ALLOWED_ALBUMS, ALLOWED_ARTIST, songsOf } from '../content.js';
import { expect, joinGuest, test } from '../fixtures.js';
import type { AdminApi, BanReply, LibrarySong } from '../harness/admin-api.js';
import { GUEST_PATH, GuestPage } from '../pages/guest-page.js';
import type { HostPage } from '../pages/host-page.js';

const REMOVED_TEXT = 'The host removed you from the jukebox.';
const NETWORK_BAN_REFUSAL = 'Access denied';
const LOOPBACK_BAN_WARNING = 'This guest connects from this computer, which a network ban never blocks.';
const LOOPBACK_NETWORK_BAN_ERROR =
  'That guest connects from this computer, which a network ban never blocks, so it would have no effect. Ban without a network ban instead.';
const NETWORK_BAN_HOURS = 1;
// The guest page's last request starts the online window, and the poll then reads the guest list once per interval.
const OFFLINE_POLL = { timeout: GUEST_ONLINE_WINDOW_MS + 30_000, intervals: [5_000] };
const OFFLINE_TEST_TIMEOUT_MS = GUEST_ONLINE_WINDOW_MS + 90_000;

/** No guest action may end or change the admin session, so every test ends with this check. */
async function expectAdminSessionKept(hostPage: HostPage, api: AdminApi): Promise<void> {
  await expect(hostPage.liveIndicator).toBeVisible();
  expect(await api.sessionRole()).toBe('admin');
}

/** Queues the host song that holds the playing slot, and returns a guest song to add after it. */
async function queueHostSong(api: AdminApi): Promise<{ hostSongId: string; guestSong: LibrarySong }> {
  const [hostSong] = await songsOf(api, ALLOWED_ALBUMS.theSlip);
  await api.queueSong(hostSong.id);
  const [guestSong] = await songsOf(api, ALLOWED_ALBUMS.ghosts);
  return { hostSongId: hostSong.id, guestSong };
}

async function addAsGuest(guest: GuestPage, songId: string): Promise<void> {
  const response = await guest.postAdd(songId);
  expect(response.status(), await response.text()).toBe(200);
}

test('the Guests dialog lists each guest with its state and waiting songs, and a closed page reads offline after the online window', async ({ hostPage, jukebox, mpv, openGuest }) => {
  test.setTimeout(OFFLINE_TEST_TIMEOUT_MS);
  const { hostSongId, guestSong } = await queueHostSong(jukebox);
  const joinLink = await jukebox.openJukebox();
  const adder = await joinGuest(openGuest, jukebox, joinLink);
  const leaver = await joinGuest(openGuest, jukebox, joinLink);
  await addAsGuest(adder.guest, guestSong.id);
  await expect.poll(() => mpv.queueSongIds()).toEqual([hostSongId, guestSong.id]);

  await hostPage.openGuestsDialog();

  await expect(hostPage.guestOnlineDot(adder.label)).toBeVisible();
  await expect(hostPage.guestOnlineDot(leaver.label)).toBeVisible();
  await expect(hostPage.guestSongsLine(adder.label)).toHaveText('1 song waiting');
  await expect(hostPage.guestSongsLine(leaver.label)).toHaveText('No songs waiting');
  await hostPage.showGuestSongs(adder.label);
  await expect(hostPage.guestSongItems(adder.label)).toHaveText([`${guestSong.title} · ${ALLOWED_ARTIST}`]);
  expect((await jukebox.guests()).map(({ label, online, songs }) => ({ label, online, songs }))).toEqual([
    { label: adder.label, online: true, songs: [{ title: guestSong.title, artist: ALLOWED_ARTIST }] },
    { label: leaver.label, online: true, songs: [] },
  ]);

  await leaver.guest.page.context().close();

  await expect.poll(async () => (await jukebox.guests()).find((entry) => entry.sessionId === leaver.sessionId)?.online, OFFLINE_POLL).toBe(false);
  await hostPage.closeGuestsDialog();
  await hostPage.openGuestsDialog();
  await expect(hostPage.guestOfflineDot(leaver.label)).toBeVisible();
  await expect(hostPage.guestOnlineDot(adder.label)).toBeVisible();
  expect((await jukebox.guests()).find((entry) => entry.sessionId === adder.sessionId)?.online).toBe(true);
  await expectAdminSessionKept(hostPage, jukebox);
});

test('removing a guest shows it the removed card, drops it from the list, and its browser joins again with the live link', async ({ hostPage, jukebox, openGuest }) => {
  const joinLink = await jukebox.openJukebox();
  const { guest, label, sessionId } = await joinGuest(openGuest, jukebox, joinLink);
  await hostPage.openGuestsDialog();
  await expect(hostPage.guestRow(label)).toBeVisible();

  await hostPage.removeGuest(label);

  await expect(hostPage.guestMessage).toHaveText(`${label} was signed out. Their songs stay queued, and the jukebox code lets them join again.`);
  await expect(hostPage.guestRow(label)).toHaveCount(0);
  await expect(hostPage.guestListStatus).toHaveText('No guest is signed in.');
  await expect(guest.sessionEndedCard).toContainText(REMOVED_TEXT);
  expect(await jukebox.guests()).toHaveLength(0);
  expect(await jukebox.bans()).toEqual([]);

  await guest.join((await jukebox.liveJoinLink()).url);

  await expect(guest.welcomeDialog).toBeVisible();
  await expect.poll(async () => (await jukebox.guests()).length).toBe(1);
  expect((await jukebox.guests())[0]?.sessionId).not.toBe(sessionId);
  await expectAdminSessionKept(hostPage, jukebox);
});

test('a ban with no network ban ends the session, removes the guest songs and blocks only that browser', async ({ hostPage, jukebox, mpv, openGuest }) => {
  const { hostSongId, guestSong } = await queueHostSong(jukebox);
  const joinLink = await jukebox.openJukebox();
  const { guest, label } = await joinGuest(openGuest, jukebox, joinLink);
  await addAsGuest(guest, guestSong.id);
  await expect.poll(() => mpv.queueSongIds()).toEqual([hostSongId, guestSong.id]);
  await hostPage.openGuestsDialog();
  const banReply = hostPage.page.waitForResponse((response) => response.url().endsWith('/api/jukebox/guests/ban'));

  await hostPage.banGuest(label, { networkBanHours: 0, newCode: false });

  const reply = (await (await banReply).json()) as BanReply;
  expect(reply).toMatchObject({ songsRemoved: 1, songsStayed: 0 });
  await expect(hostPage.guestMessage).toHaveText(`${label} was banned, and 1 song left the queue.`);
  await expect(guest.sessionEndedCard).toContainText(REMOVED_TEXT);
  await expect(hostPage.guestRow(label)).toHaveCount(0);
  await expect(hostPage.banRow(label, 'guest')).toBeVisible();
  await expect(hostPage.banRow(label, 'network')).toHaveCount(0);
  await expect(hostPage.banRow(label, 'guest').getByRole('button', { name: `Unban ${label}`, exact: true })).toBeVisible();
  await expect(hostPage.queueRows).toHaveCount(1);
  await expect.poll(() => mpv.queueSongIds()).toEqual([hostSongId]);
  expect((await jukebox.bans()).map(({ kind, label: banned }) => ({ kind, label: banned }))).toEqual([{ kind: 'guest', label }]);
  expect(await jukebox.guests()).toHaveLength(0);

  await guest.join(joinLink);

  await expect(guest.refusedJoinCard.getByRole('alert')).toHaveText(REMOVED_TEXT);
  expect(await jukebox.guests()).toHaveLength(0);

  await openGuest(joinLink);

  await expect.poll(async () => (await jukebox.guests()).length).toBe(1);
  await expectAdminSessionKept(hostPage, jukebox);
});

test('a ban that also makes a new code keeps the other guests on the new code and the banned browser out', async ({ hostPage, jukebox, openGuest }) => {
  const oldLink = await jukebox.openJukebox();
  const target = await joinGuest(openGuest, jukebox, oldLink);
  const bystander = await joinGuest(openGuest, jukebox, oldLink);
  await hostPage.openGuestsDialog();

  await hostPage.banGuest(target.label, { networkBanHours: 0, newCode: true });

  await expect(hostPage.guestMessage).toHaveText(`${target.label} was banned, and 0 songs left the queue.`);
  await expect(target.guest.sessionEndedCard).toContainText(REMOVED_TEXT);
  await expect(hostPage.guestRow(target.label)).toHaveCount(0);
  await expect(hostPage.guestRow(bystander.label)).toBeVisible();
  const newLink = await jukebox.liveJoinLink();
  expect(newLink.url).not.toBe(oldLink);
  expect((await jukebox.guests()).map((entry) => entry.sessionId)).toEqual([bystander.sessionId]);
  const code = await jukebox.jukeboxCode();
  expect((await jukebox.bans()).map(({ kind, expiresAt }) => ({ kind, expiresAt }))).toEqual([{ kind: 'guest', expiresAt: code.expiresAt }]);
  await bystander.guest.page.reload();
  await expect(bystander.guest.jukeboxLine).toContainText(`You are ${bystander.label}.`);
  await expect(bystander.guest.sessionEndedCard).toBeHidden();

  await target.guest.join(newLink.url);

  await expect(target.guest.refusedJoinCard.getByRole('alert')).toHaveText(REMOVED_TEXT);
  expect((await jukebox.guests()).map((entry) => entry.sessionId)).toEqual([bystander.sessionId]);
  await expectAdminSessionKept(hostPage, jukebox);
});

test('unbanning a browser in the Guests dialog lets it join again', async ({ hostPage, jukebox, openGuest }) => {
  const joinLink = await jukebox.openJukebox();
  const { guest, label, sessionId } = await joinGuest(openGuest, jukebox, joinLink);
  await jukebox.banGuest(sessionId);
  await expect(guest.sessionEndedCard).toContainText(REMOVED_TEXT);
  await hostPage.openGuestsDialog();
  await expect(hostPage.banRow(label, 'guest')).toBeVisible();

  await hostPage.unban(label, 'guest');

  await expect(hostPage.banMessage).toHaveText(`The ban on ${label} was lifted, so their browser can join again.`);
  await expect(hostPage.banListStatus).toHaveText('No one is banned.');
  await expect(hostPage.banRow(label, 'guest')).toHaveCount(0);
  expect(await jukebox.bans()).toEqual([]);

  await guest.join(joinLink);

  await expect(guest.welcomeDialog).toBeVisible();
  await expect.poll(async () => (await jukebox.guests()).length).toBe(1);
  await expectAdminSessionKept(hostPage, jukebox);
});

test('closing and reopening the jukebox ends every browser ban, so the banned browser joins the new code', async ({ hostPage, jukebox, openGuest }) => {
  const { guest, label, sessionId } = await joinGuest(openGuest, jukebox, await jukebox.openJukebox());
  await jukebox.banGuest(sessionId);
  await expect(guest.sessionEndedCard).toContainText(REMOVED_TEXT);
  expect(await jukebox.bans()).toHaveLength(1);

  await jukebox.closeJukebox();
  const reopenedLink = await jukebox.openJukebox();

  expect(await jukebox.bans()).toEqual([]);
  await hostPage.openGuestsDialog();
  await expect(hostPage.banListStatus).toHaveText('No one is banned.');
  await expect(hostPage.banRow(label, 'guest')).toHaveCount(0);

  await guest.join(reopenedLink);

  await expect(guest.welcomeDialog).toBeVisible();
  await expect.poll(async () => (await jukebox.guests()).length).toBe(1);
  await expectAdminSessionKept(hostPage, jukebox);
});

test('a guest that joined over loopback cannot be network-banned in the dialog or the API', async ({ page, hostPage, jukebox }) => {
  const joinLink = new URL(await jukebox.openJukebox());
  const loopbackGuest = new GuestPage(page);
  await loopbackGuest.join(`${GUEST_PATH}${joinLink.hash}`);
  await expect(loopbackGuest.welcomeDialog).toBeVisible();
  await expect.poll(async () => (await jukebox.guests()).length).toBe(1);
  const [entry] = await jukebox.guests();
  expect(entry.addressClass).toBe('loopback');
  await hostPage.openGuestsDialog();

  await hostPage.openBanPanel(entry.label);

  await expect(hostPage.banHoursSelect).toBeDisabled();
  await expect(hostPage.banHoursSelect).toHaveValue('0');
  await expect(hostPage.banWarning).toHaveText(LOOPBACK_BAN_WARNING);
  await hostPage.banCancelButton.click();
  await expect(hostPage.banConfirmButton).toBeHidden();

  const refusal = await jukebox.postResponse('/api/jukebox/guests/ban', { sessionId: entry.sessionId, networkBanHours: NETWORK_BAN_HOURS });

  expect(refusal.status()).toBe(400);
  expect(await refusal.json()).toEqual({ error: LOOPBACK_NETWORK_BAN_ERROR });
  expect(await jukebox.bans()).toEqual([]);
  expect((await jukebox.guests()).map((guest) => guest.sessionId)).toEqual([entry.sessionId]);
  await expect(loopbackGuest.sessionEndedCard).toBeHidden();
  await expectAdminSessionKept(hostPage, jukebox);
});

test('a network ban blocks a new browser on the LAN address until the host lifts it', async ({ hostPage, jukebox, newGuestPage, openGuest }) => {
  const joinLink = await jukebox.openJukebox();
  const { guest, label } = await joinGuest(openGuest, jukebox, joinLink);
  const [entry] = await jukebox.guests();
  expect(entry.addressClass).toBe('lan');
  await hostPage.openGuestsDialog();

  await hostPage.banGuest(label, { networkBanHours: NETWORK_BAN_HOURS, newCode: false });

  await expect(hostPage.guestMessage).toHaveText(`${label} was banned, and 0 songs left the queue.`);
  await expect(guest.sessionEndedCard).toContainText(REMOVED_TEXT);
  await expect(hostPage.banRow(label, 'guest')).toBeVisible();
  await expect(hostPage.banRow(label, 'network')).toContainText(`Network ${entry.networkKey} blocked until`);
  expect((await jukebox.bans()).map(({ kind, networkKey }) => ({ kind, networkKey }))).toEqual([
    { kind: 'guest', networkKey: entry.networkKey },
    { kind: 'network', networkKey: entry.networkKey },
  ]);
  const blocked = await newGuestPage();
  const refused = await blocked.join(joinLink);
  expect(refused?.status()).toBe(403);
  expect(await refused?.json()).toEqual({ error: NETWORK_BAN_REFUSAL });
  expect(await jukebox.guests()).toHaveLength(0);

  await hostPage.unban(label, 'network');

  await expect(hostPage.banMessage).toHaveText(`The network ban on ${label} was lifted.`);
  await expect(hostPage.banRow(label, 'network')).toHaveCount(0);
  await expect(hostPage.banRow(label, 'guest')).toBeVisible();
  expect((await jukebox.bans()).map((ban) => ban.kind)).toEqual(['guest']);

  await openGuest(joinLink);

  await expect.poll(async () => (await jukebox.guests()).length).toBe(1);
  await expectAdminSessionKept(hostPage, jukebox);
});
