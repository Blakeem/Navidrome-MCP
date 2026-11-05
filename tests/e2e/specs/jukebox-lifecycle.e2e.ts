/**
 * Navidrome MCP Server - e2e jukebox code lifecycle, guest join and session end
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { readFile } from 'node:fs/promises';
import type { APIRequestContext, Locator } from '@playwright/test';

import { DEFAULT_GUEST_QUEUE_LIMIT } from '../../../src/constants/defaults.js';
import { expect, test } from '../fixtures.js';
import { readJson } from '../harness/admin-api.js';
import { GUEST_PATH, GuestPage } from '../pages/guest-page.js';
import { ADMIN_PATH, HostPage } from '../pages/host-page.js';

const HOUR_MS = 60 * 60 * 1000;
const CHOSEN_LIFETIME_HOURS = 3;
const WRONG_PASSWORD = 'not-the-admin-password';
const WRONG_KEY = 'not-the-jukebox-key';
const NICKNAME = 'Night Owl';
const INVALID_CODE_ERROR = 'This jukebox code is not valid, closed or expired.';
const CLOSE_PROMPT = 'Close the jukebox? Every guest is signed out and the code stops working.';
const LAYOUT_VIEWPORTS = [
  { name: 'phone', size: { width: 390, height: 844 } },
  { name: 'desktop', size: { width: 1280, height: 800 } },
] as const;

/** The download name rule of the Jukebox dialog, written out here so the test does not read it from the page. */
function qrFileName(label: string): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug === '' ? 'jukebox-qr.svg' : `jukebox-qr-${slug}.svg`;
}

async function sessionRole(request: APIRequestContext): Promise<string> {
  const session = await readJson<{ role: string }>(await request.get('/api/auth/session'), 'GET /api/auth/session');
  return session.role;
}

/** The edges are relative to the viewport, so only spans read at one scroll position compare. */
async function verticalSpan(locator: Locator): Promise<{ top: number; bottom: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('e2e: the layout part has no box, so it is not rendered.');
  return { top: box.y, bottom: box.y + box.height };
}

test('the login form refuses a wrong password and opens the admin page for the right one', async ({ page, instance }) => {
  const host = new HostPage(page);
  await host.goto();
  await expect(host.loginView).toBeVisible();

  await host.logIn(WRONG_PASSWORD);

  await expect(host.loginStatus).toHaveText('Wrong password');
  await expect(host.loginPassword).toBeVisible();
  await expect(host.loginPassword).toHaveValue('');
  expect(await sessionRole(page.request)).toBe('anonymous');

  await host.logIn(instance.adminPassword);

  await expect(host.liveIndicator).toBeVisible();
  await expect(host.loginView).toBeHidden();
  expect(await sessionRole(page.request)).toBe('admin');
});

test('the root sends a browser with no session to the guest page and the admin to the admin page', async ({ page, hostPage, instance }) => {
  const anonymousRoot = await page.request.get('/', { maxRedirects: 0 });
  expect(anonymousRoot.status()).toBe(302);
  expect(anonymousRoot.headers()['location']).toBe(GUEST_PATH);

  await page.goto('/');

  await expect(page).toHaveURL(`${instance.baseUrl}${GUEST_PATH}`);
  await expect(new GuestPage(page).joinCard).toBeVisible();

  await hostPage.page.goto('/');

  await expect(hostPage.page).toHaveURL(`${instance.baseUrl}${ADMIN_PATH}`);
  await expect(hostPage.liveIndicator).toBeVisible();
});

test('the Jukebox dialog opens a code for the chosen lifetime and shows its link and QR code', async ({ hostPage, jukebox }) => {
  await hostPage.openJukeboxDialog();
  await expect(hostPage.jukeboxClosedText).toBeVisible();
  const beforeOpen = Date.now();

  await hostPage.openJukebox(CHOSEN_LIFETIME_HOURS);

  await expect(hostPage.jukeboxQr).toBeVisible();
  const afterOpen = Date.now();
  const code = await jukebox.jukeboxCode();
  const link = await jukebox.liveJoinLink();
  expect(code.active).toBe(true);
  expect(code.expiresAt).toBeGreaterThanOrEqual(beforeOpen + CHOSEN_LIFETIME_HOURS * HOUR_MS);
  expect(code.expiresAt).toBeLessThanOrEqual(afterOpen + CHOSEN_LIFETIME_HOURS * HOUR_MS);
  await expect(hostPage.jukeboxUrl).toHaveText(link.url);
  await expect(hostPage.jukeboxQr).toHaveAttribute('alt', `QR code for the ${link.label} join link`);
  // The tests compile without the DOM lib, so an evaluated element is typed by the one property it reads.
  await expect.poll(() => hostPage.jukeboxQr.evaluate((img) => (img as { naturalWidth: number }).naturalWidth)).toBeGreaterThan(0);
  await expect(hostPage.jukeboxStatus).toHaveText(/^Open until .+\. 0 guests\.$/);
  await expect(hostPage.jukeboxClosedText).toBeHidden();
});

test('the QR code downloads as an SVG named for its link and opens full screen until a click', async ({ hostPage, jukebox }) => {
  await jukebox.openJukebox();
  const link = await jukebox.liveJoinLink();
  await hostPage.openJukeboxDialog();
  await expect(hostPage.jukeboxQr).toBeVisible();

  const downloadEvent = hostPage.page.waitForEvent('download');
  await hostPage.downloadQrButton.click();
  const download = await downloadEvent;

  expect(download.suggestedFilename()).toBe(qrFileName(link.label));
  expect(await readFile(await download.path(), 'utf8')).toBe(link.qrSvg);

  await hostPage.fullScreenButton.click();

  await expect(hostPage.fullScreenDialog).toBeVisible();
  await expect(hostPage.fullScreenQr).toHaveAttribute('alt', `QR code for the ${link.label} join link`);

  await hostPage.fullScreenDialog.click();

  await expect(hostPage.fullScreenDialog).toBeHidden();
  await expect(hostPage.jukeboxDialog).toBeVisible();
});

test('a guest joins through the link, sees the welcome once and shows online to the host', async ({ hostPage, jukebox, openGuest }) => {
  const joinLink = await jukebox.openJukebox();

  const guest = await openGuest(joinLink, { keepWelcome: true });

  await expect(guest.page).toHaveURL(`${new URL(joinLink).origin}${GUEST_PATH}`);
  await expect.poll(async () => (await jukebox.guests()).length).toBe(1);
  const [entry] = await jukebox.guests();
  await expect(guest.welcomeDialog).toContainText(`You joined as ${entry.label}.`);
  await guest.dismissWelcome();
  await expect(guest.welcomeDialog).toBeHidden();
  await expect(guest.jukeboxLine).toContainText(`You are ${entry.label}.`);
  await expect(guest.songsLeft).toHaveText(`${String(DEFAULT_GUEST_QUEUE_LIMIT)} of ${String(DEFAULT_GUEST_QUEUE_LIMIT)} songs left`);

  await guest.page.reload();

  // The welcome opens in the same render that fills the "You are" line, so the line shows first.
  await expect(guest.jukeboxLine).toContainText(`You are ${entry.label}.`);
  await expect(guest.welcomeDialog).toBeHidden();

  await hostPage.openGuestsDialog();

  await expect(hostPage.guestOnlineDot(entry.label)).toBeVisible();
  await expect.poll(async () => (await jukebox.guests())[0]?.online).toBe(true);
});

test('a guest sets a nickname the host sees, and each refused name shows its reason', async ({ hostPage, jukebox, openGuest }) => {
  const guest = await openGuest(await jukebox.openJukebox());
  await expect.poll(async () => (await jukebox.guests()).length).toBe(1);
  const [entry] = await jukebox.guests();
  await guest.openNameForm();

  await guest.submitNickname('Host');
  await expect(guest.nicknameStatus).toHaveText("Host is the host's name. Pick another nickname.");

  await guest.submitNickname('<b>');
  await expect(guest.nicknameStatus).toHaveText("nickname must be 1 to 24 letters, digits, spaces or . , ' ! ? - _");

  await guest.submitNickname('   ');
  await expect(guest.nicknameStatus).toHaveText('Enter a nickname to save.');
  expect((await jukebox.guests())[0]?.nickname).toBeNull();

  await guest.submitNickname(NICKNAME);

  await expect(guest.nicknameInput).toBeHidden();
  await expect(guest.jukeboxLine).toContainText(`You are ${NICKNAME} (${entry.label}).`);
  await expect.poll(async () => (await jukebox.guests())[0]?.nickname).toBe(NICKNAME);
  await hostPage.openGuestsDialog();
  await expect(hostPage.guestRow(`${entry.label} (${NICKNAME})`)).toBeVisible();
});

test('a link with a wrong key shows the refusal card and creates no guest', async ({ page, jukebox }) => {
  const badLink = new URL(await jukebox.openJukebox());
  badLink.hash = `k=${WRONG_KEY}`;
  const newcomer = new GuestPage(page);

  await newcomer.join(badLink.href);

  await expect(newcomer.refusedJoinCard).toBeVisible();
  await expect(newcomer.refusedJoinCard.getByRole('alert')).toHaveText(INVALID_CODE_ERROR);
  expect(await jukebox.guests()).toHaveLength(0);
  expect((await jukebox.jukeboxCode()).guestCount).toBe(0);
});

test('a new code that keeps guests leaves them joined and stops the old key', async ({ page, hostPage, jukebox, openGuest }) => {
  const oldLink = await jukebox.openJukebox();
  const guest = await openGuest(oldLink);
  await expect.poll(async () => (await jukebox.guests()).length).toBe(1);
  const [kept] = await jukebox.guests();
  await hostPage.openJukeboxDialog();
  await expect(hostPage.jukeboxUrl).toHaveText(oldLink);

  await hostPage.makeNewCode({ signOutGuests: false });

  await expect(hostPage.jukeboxUrl).not.toHaveText(oldLink);
  const newLink = await jukebox.liveJoinLink();
  await expect(hostPage.jukeboxUrl).toHaveText(newLink.url);
  await expect(hostPage.jukeboxStatus).toContainText('1 guest.');
  expect((await jukebox.guests()).map((entry) => entry.sessionId)).toEqual([kept.sessionId]);
  await guest.page.reload();
  await expect(guest.jukeboxLine).toContainText(`You are ${kept.label}.`);
  await expect(guest.sessionEndedCard).toBeHidden();

  const newcomer = new GuestPage(page);
  await newcomer.join(oldLink);

  await expect(newcomer.refusedJoinCard.getByRole('alert')).toHaveText(INVALID_CODE_ERROR);
  expect((await jukebox.guests()).map((entry) => entry.sessionId)).toEqual([kept.sessionId]);
});

test('a new code that signs guests out ends each session, and its key joins', async ({ hostPage, jukebox, openGuest }) => {
  const oldLink = await jukebox.openJukebox();
  const first = await openGuest(oldLink);
  const second = await openGuest(oldLink);
  await expect.poll(async () => (await jukebox.guests()).length).toBe(2);
  const signedOutIds = (await jukebox.guests()).map((entry) => entry.sessionId);
  await hostPage.openJukeboxDialog();

  await hostPage.makeNewCode({ signOutGuests: true });

  await expect(hostPage.jukeboxUrl).not.toHaveText(oldLink);
  for (const guest of [first, second]) {
    await expect(guest.sessionEndedCard).toBeVisible();
    await expect(guest.sessionEndedCard).toContainText('The host made a new jukebox code. Scan the new code to rejoin.');
  }
  await expect.poll(async () => (await jukebox.guests()).length).toBe(0);

  await first.join((await jukebox.liveJoinLink()).url);

  await expect(first.welcomeDialog).toBeVisible();
  await expect.poll(async () => (await jukebox.guests()).length).toBe(1);
  expect(signedOutIds).not.toContain((await jukebox.guests())[0]?.sessionId);
});

test('closing the jukebox ends each guest session and stops the link', async ({ page, hostPage, jukebox, openGuest }) => {
  const joinLink = await jukebox.openJukebox();
  const guests = [await openGuest(joinLink), await openGuest(joinLink)];
  await expect.poll(async () => (await jukebox.guests()).length).toBe(2);
  await hostPage.openJukeboxDialog();
  await expect(hostPage.closeJukeboxButton).toBeVisible();

  const prompt = hostPage.acceptNextPrompt();
  await hostPage.closeJukeboxButton.click();

  // The message shows only once the prompt was accepted, so a missing prompt fails here instead of at the test timeout.
  await expect(hostPage.jukeboxMessage).toHaveText('The jukebox closed. Every guest was signed out.');
  expect(await prompt).toBe(CLOSE_PROMPT);
  await expect(hostPage.jukeboxClosedText).toBeVisible();
  for (const guest of guests) {
    await expect(guest.sessionEndedCard).toContainText('The host closed the jukebox.');
    await expect(guest.sessionEndedCard).toContainText('Scan a new code from the host to join again.');
  }
  expect((await jukebox.jukeboxCode()).active).toBe(false);
  expect(await jukebox.guests()).toHaveLength(0);

  const newcomer = new GuestPage(page);
  await newcomer.join(joinLink);

  await expect(newcomer.refusedJoinCard.getByRole('alert')).toHaveText(INVALID_CODE_ERROR);
  expect(await jukebox.guests()).toHaveLength(0);
});

for (const viewport of LAYOUT_VIEWPORTS) {
  test(`the guest page stacks now playing, the queue and search within the ${viewport.name} width`, async ({ jukebox, openGuest }) => {
    const guest = await openGuest(await jukebox.openJukebox());
    await expect.poll(async () => (await jukebox.guests()).length).toBe(1);

    await guest.page.setViewportSize(viewport.size);

    const parts = [guest.nowPlaying, guest.queue, guest.searchBox];
    for (const part of parts) await expect(part).toBeVisible();
    const [nowPlaying, queue, search] = await Promise.all(parts.map(verticalSpan));
    expect(nowPlaying.bottom).toBeLessThanOrEqual(queue.top);
    expect(queue.bottom).toBeLessThanOrEqual(search.top);
    for (const part of parts) {
      await part.scrollIntoViewIfNeeded();
      await expect(part).toBeInViewport();
    }
    const pageWidth = await guest.page.locator('html').evaluate((root) => (root as { scrollWidth: number }).scrollWidth);
    expect(pageWidth).toBeLessThanOrEqual(viewport.size.width);
  });
}
