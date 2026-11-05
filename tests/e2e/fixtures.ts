/**
 * Navidrome MCP Server - e2e fixtures
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Every spec imports `test` and `expect` from here. Each role gets its own browser context.
 * Playwright sets up auto fixtures before the others, so the state reset runs before any page opens.
 */

import { type BrowserContext, test as base, expect } from '@playwright/test';

import { AdminApi } from './harness/admin-api.js';
import { MpvProbe } from './harness/mpv-probe.js';
import { type Instance, readRunEnv } from './harness/run-env.js';
import { ScrobbleGuard } from './harness/scrobble-guard.js';
import { GuestPage } from './pages/guest-page.js';
import { HostPage } from './pages/host-page.js';

export const TEST_VOLUME = 10;

interface OpenGuestOptions {
  /** Leaves the welcome dialog open, for a test of the dialog itself. */
  keepWelcome?: boolean;
}

type OpenGuest = (joinLink: string, options?: OpenGuestOptions) => Promise<GuestPage>;

interface TestFixtures {
  jukebox: AdminApi;
  mpv: MpvProbe;
  hostPage: HostPage;
  newGuestPage: () => Promise<GuestPage>;
  openGuest: OpenGuest;
  resetState: void;
  scrobbleGuard: ScrobbleGuard;
}

interface WorkerFixtures {
  instance: Instance;
  adminStatePath: string;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  instance: [async ({}, use) => {
    await use(readRunEnv().instance);
  }, { scope: 'worker' }],

  adminStatePath: [async ({}, use) => {
    await use(readRunEnv().adminStatePath);
  }, { scope: 'worker' }],

  baseURL: async ({ instance }, use) => {
    await use(instance.baseUrl);
  },

  jukebox: async ({ playwright, instance, adminStatePath }, use) => {
    const context = await playwright.request.newContext({ baseURL: instance.baseUrl, storageState: adminStatePath });
    await use(new AdminApi(context));
    await context.dispose();
  },

  mpv: async ({ instance }, use) => {
    const probe = new MpvProbe(instance.ipcPath);
    await use(probe);
    probe.close();
  },

  // Closing the jukebox signs every guest out. The volume call starts mpv when it is not running, so
  // mpv runs at TEST_VOLUME before any test plays audio.
  resetState: [async ({ jukebox }, use) => {
    await jukebox.closeJukebox();
    await jukebox.removeAllBans();
    await jukebox.clearQueue();
    await jukebox.resetJukeboxSettings();
    await jukebox.setVolume(TEST_VOLUME);
    await use();
  }, { auto: true }],

  scrobbleGuard: [async ({ mpv }, use) => {
    const guard = new ScrobbleGuard(mpv);
    guard.start();
    await use(guard);
    await guard.stop();
    if (guard.trip !== null) throw new Error(guard.trip);
  }, { auto: true }],

  hostPage: async ({ browser, baseURL, adminStatePath }, use) => {
    const context = await browser.newContext({ baseURL, storageState: adminStatePath });
    const host = new HostPage(await context.newPage());
    await host.goto();
    await expect(host.liveIndicator).toBeVisible();
    await use(host);
    await context.close();
  },

  newGuestPage: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async () => {
      // The join link points at the LAN origin, so the context needs no base URL.
      const context = await browser.newContext();
      contexts.push(context);
      return new GuestPage(await context.newPage());
    });
    for (const context of contexts) await context.close();
  },

  openGuest: async ({ newGuestPage }, use) => {
    await use(async (joinLink, { keepWelcome = false } = {}) => {
      const guest = await newGuestPage();
      await guest.join(joinLink);
      await expect(guest.welcomeDialog).toBeVisible();
      if (!keepWelcome) {
        await guest.dismissWelcome();
        await expect(guest.welcomeDialog).toBeHidden();
      }
      return guest;
    });
  },
});

/** Joins one more guest and reads its label from the guest list, so a test with two guests knows which is which. */
export async function joinGuest(openGuest: OpenGuest, api: AdminApi, joinLink: string): Promise<{ guest: GuestPage; label: string; sessionId: string }> {
  const before = new Set((await api.guests()).map((entry) => entry.sessionId));
  const guest = await openGuest(joinLink);
  await expect.poll(async () => (await api.guests()).length).toBe(before.size + 1);
  const joined = (await api.guests()).find((entry) => !before.has(entry.sessionId));
  if (joined === undefined) throw new Error('e2e: the guest list gained no new guest after the join.');
  return { guest, label: joined.label, sessionId: joined.sessionId };
}

export { expect };
