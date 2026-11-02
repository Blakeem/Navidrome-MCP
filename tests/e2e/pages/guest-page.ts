/**
 * Navidrome MCP Server - e2e guest page object
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Holds the guest page's locators and actions. Specs hold the assertions.
 */

import type { APIResponse, Locator, Page, Response } from '@playwright/test';

import { CSRF_HEADER, readJson, sessionCsrfToken } from '../harness/admin-api.js';
import { readPositionSeconds } from './position-label.js';
import { answerNextPrompt } from './prompts.js';

export const GUEST_PATH = '/guest';

interface ListedSong {
  id: string;
  title: string;
}

interface GuestSearchSong extends ListedSong {
  album: string;
}

export class GuestPage {
  readonly liveIndicator: Locator;
  readonly welcomeDialog: Locator;
  readonly welcomeDoneButton: Locator;
  readonly hostBanner: Locator;
  readonly searchBox: Locator;
  readonly searchButton: Locator;
  readonly searchStatus: Locator;
  readonly results: Locator;
  readonly resultRows: Locator;

  readonly nowPlaying: Locator;
  readonly trackTitle: Locator;
  readonly stateBadge: Locator;
  readonly positionLabel: Locator;
  readonly queue: Locator;
  readonly queueRows: Locator;
  readonly emptyQueueText: Locator;
  readonly jukeboxLine: Locator;
  readonly songsLeft: Locator;
  readonly changeNameButton: Locator;
  readonly nicknameInput: Locator;
  readonly nicknameSaveButton: Locator;
  readonly nicknameStatus: Locator;

  readonly joinCard: Locator;
  readonly refusedJoinCard: Locator;
  readonly sessionEndedCard: Locator;

  constructor(readonly page: Page) {
    // The connection label is a live region with no role, so its text locates it.
    this.liveIndicator = page.getByRole('banner').getByText('Live', { exact: true });
    this.welcomeDialog = page.getByRole('dialog', { name: 'Welcome to the jukebox' });
    this.welcomeDoneButton = this.welcomeDialog.getByRole('button', { name: 'Got it' });
    this.hostBanner = page.getByRole('main').getByText('You are on the guest page as the host.');
    const addSongs = page.getByRole('region', { name: 'Add songs' });
    this.searchBox = addSongs.getByRole('searchbox', { name: 'Search songs' });
    this.searchButton = addSongs.getByRole('button', { name: 'Search', exact: true });
    // The search status is a live region with no role, so its id locates it.
    this.searchStatus = addSongs.locator('#guest-search-status');
    this.results = addSongs.getByRole('list');
    this.resultRows = this.results.getByRole('listitem');

    this.nowPlaying = page.getByRole('region', { name: 'Now playing' });
    this.trackTitle = this.nowPlaying.getByRole('heading', { level: 2 });
    // The state badge and the position label have no role or label, so their ids locate them.
    this.stateBadge = this.nowPlaying.locator('#state-badge');
    this.positionLabel = page.getByRole('region', { name: 'Progress' }).locator('#guest-position');
    this.queue = page.getByRole('region', { name: 'Play queue' });
    this.queueRows = this.queue.getByRole('listitem');
    this.emptyQueueText = this.queue.getByText('Queue is empty', { exact: true });
    // The "You are" line and the name status are live regions with no role, and the host banner also
    // starts with "You are", so their ids locate them.
    this.jukeboxLine = page.locator('#guest-jukebox');
    this.songsLeft = addSongs.getByText(/^\d+ of \d+ songs left$/);
    const main = page.getByRole('main');
    this.changeNameButton = main.getByRole('button', { name: 'Change name' });
    this.nicknameInput = main.getByRole('textbox', { name: 'Nickname', exact: true });
    this.nicknameSaveButton = main.getByRole('button', { name: 'Save', exact: true });
    this.nicknameStatus = page.locator('#guest-name-status');

    // Each card is one section that its title names, so the title tells the cards apart.
    this.joinCard = page.getByRole('region', { name: 'Join the jukebox' });
    this.refusedJoinCard = page.getByRole('region', { name: 'Scan the jukebox QR code again' });
    this.sessionEndedCard = page.getByRole('region', { name: 'Your jukebox session ended' });
  }

  /** Resolves the page load's answer, which a network ban refuses, or null when only the hash changes. */
  join(joinLink: string): Promise<Response | null> {
    return this.page.goto(joinLink);
  }

  /** Opens the guest page with no join key, as the admin does from the player. */
  async goto(): Promise<void> {
    await this.page.goto(GUEST_PATH);
  }

  async search(query: string): Promise<void> {
    await this.searchBox.fill(query);
    await this.searchButton.click();
  }

  /** A search result row by its song title. */
  resultRow(title: string): Locator {
    return this.resultRows.filter({ has: this.page.getByText(title, { exact: true }) });
  }

  /** The row's one button, whose text follows its state: Add, Adding…, Added, Removing… or In queue. */
  addButton(title: string): Locator {
    return this.resultRow(title).getByRole('button');
  }

  /** The buttons in the Add state. A full song limit disables every one. */
  addStateButtons(): Locator {
    return this.results.getByRole('button', { name: /^Add: / });
  }

  /** The songs the search results list, in list order, read from the id and title the page puts on each Add button. */
  listedSongs(): Promise<ListedSong[]> {
    // The tests compile without the DOM lib, so an evaluated element is typed by the one property it reads.
    return this.results.getByRole('button').evaluateAll((buttons) => buttons.map((button) => {
      const { songId, title } = (button as unknown as { dataset: { songId?: string; title?: string } }).dataset;
      return { id: songId ?? '', title: title ?? '' };
    }));
  }

  /** A queue row by its song title. */
  queueRow(title: string): Locator {
    return this.queueRows.filter({ has: this.page.getByText(title, { exact: true }) });
  }

  removeButton(title: string): Locator {
    return this.queue.getByRole('button', { name: `Remove ${title} from the queue`, exact: true });
  }

  /** The guest search API's answer for this page's session, which the page lists. */
  async searchApi(query: string): Promise<GuestSearchSong[]> {
    const response = await this.page.request.get(this.apiUrl(`/api/guest/search?q=${encodeURIComponent(query)}`));
    return (await readJson<{ songs: GuestSearchSong[] }>(response, 'GET /api/guest/search')).songs;
  }

  /** Sends an add straight to the API with this page's session, skipping the Add button's rules. */
  async postAdd(songId: string): Promise<APIResponse> {
    const csrfToken = await sessionCsrfToken(this.page.request, this.apiUrl('/api/auth/session'), 'guest');
    return this.page.request.post(this.apiUrl('/api/guest/queue'), { data: { songId }, headers: { [CSRF_HEADER]: csrfToken } });
  }

  positionSeconds(): Promise<number> {
    return readPositionSeconds(this.positionLabel);
  }

  // A guest context has no base URL, since the join link points at the LAN origin.
  private apiUrl(path: string): string {
    return new URL(path, this.page.url()).href;
  }

  /** See `answerNextPrompt`. */
  acceptNextPrompt(): Promise<string> {
    return answerNextPrompt(this.page, 'accept');
  }

  async dismissWelcome(): Promise<void> {
    await this.welcomeDoneButton.click();
  }

  async openNameForm(): Promise<void> {
    await this.changeNameButton.click();
  }

  /** A refused name keeps the form open, so a spec submits again without reopening it. */
  async submitNickname(nickname: string): Promise<void> {
    await this.nicknameInput.fill(nickname);
    await this.nicknameSaveButton.click();
  }
}
