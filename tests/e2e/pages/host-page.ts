/**
 * Navidrome MCP Server - e2e admin page object
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Holds the admin page's locators and actions. Specs hold the assertions.
 */

import type { Locator, Page } from '@playwright/test';

import { readPositionSeconds } from './position-label.js';
import { answerNextPrompt } from './prompts.js';

export const ADMIN_PATH = '/admin';

type BanKind = 'guest' | 'network';

interface BanChoice {
  /** 0 picks "No network ban". */
  networkBanHours: number;
  newCode: boolean;
}

export class HostPage {
  readonly liveIndicator: Locator;
  readonly jukeboxButton: Locator;
  readonly guestsButton: Locator;
  readonly trackTitle: Locator;
  readonly stateBadge: Locator;
  readonly positionLabel: Locator;
  readonly playButton: Locator;
  readonly pauseButton: Locator;
  readonly nextButton: Locator;

  readonly queue: Locator;
  readonly queueRows: Locator;
  readonly emptyQueueText: Locator;
  readonly clearQueueButton: Locator;

  readonly openPlayDialogButton: Locator;
  readonly playDialog: Locator;
  readonly replaceModeLabel: Locator;
  readonly librarySearchBox: Locator;
  readonly librarySearchButton: Locator;

  readonly loginView: Locator;
  readonly loginPassword: Locator;
  readonly loginButton: Locator;
  readonly loginStatus: Locator;

  readonly jukeboxDialog: Locator;
  readonly jukeboxClosedText: Locator;
  readonly jukeboxLifetime: Locator;
  readonly openJukeboxButton: Locator;
  readonly jukeboxQr: Locator;
  readonly jukeboxUrl: Locator;
  readonly jukeboxStatus: Locator;
  readonly jukeboxMessage: Locator;
  readonly fullScreenButton: Locator;
  readonly downloadQrButton: Locator;
  readonly newCodeButton: Locator;
  readonly signOutGuestsCheckbox: Locator;
  readonly makeNewCodeButton: Locator;
  readonly closeJukeboxButton: Locator;
  readonly fullScreenDialog: Locator;
  readonly fullScreenQr: Locator;

  readonly guestsDialog: Locator;
  readonly guestsCloseButton: Locator;
  readonly signedInGroup: Locator;
  readonly guestListStatus: Locator;
  readonly guestMessage: Locator;
  readonly banHoursSelect: Locator;
  readonly banWarning: Locator;
  readonly banNewCodeCheckbox: Locator;
  readonly banConfirmButton: Locator;
  readonly banCancelButton: Locator;
  readonly bannedGroup: Locator;
  readonly banListStatus: Locator;
  readonly banMessage: Locator;
  readonly guestLimitInput: Locator;
  readonly guestLimitSaveButton: Locator;
  readonly guestLimitMessage: Locator;

  constructor(readonly page: Page) {
    // The connection label is a live region with no role, so its text locates it.
    this.liveIndicator = page.getByRole('banner').getByText('Live', { exact: true });
    this.jukeboxButton = page.getByRole('button', { name: 'Jukebox', exact: true });
    this.guestsButton = page.getByRole('button', { name: 'Guests', exact: true });
    const nowPlaying = page.getByRole('region', { name: 'Now playing' });
    this.trackTitle = nowPlaying.getByRole('heading', { level: 2 });
    // The state badge and the position label have no role or label, so their ids locate them.
    this.stateBadge = nowPlaying.locator('#state-badge');
    this.positionLabel = page.getByRole('region', { name: 'Progress' }).locator('#position-label');
    const transport = page.getByRole('region', { name: 'Transport controls' });
    // The one play button is named for what it does next, so each name locates it in one state.
    this.playButton = transport.getByRole('button', { name: 'Play', exact: true });
    this.pauseButton = transport.getByRole('button', { name: 'Pause', exact: true });
    this.nextButton = transport.getByRole('button', { name: 'Next track' });

    this.queue = page.getByRole('region', { name: 'Play queue' });
    this.queueRows = this.queue.getByRole('listitem');
    this.emptyQueueText = this.queue.getByText('Queue is empty', { exact: true });
    this.clearQueueButton = this.queue.getByRole('button', { name: 'Clear the queue and stop playback' });

    this.openPlayDialogButton = page.getByRole('button', { name: 'Browse and play music' });
    this.playDialog = page.getByRole('dialog', { name: 'Play Music' });
    // The mode radio is visually hidden under its label, which takes the click, so the label's `for` locates it.
    this.replaceModeLabel = this.playDialog.locator('label[for="play-mode-replace"]');
    this.librarySearchBox = this.playDialog.getByRole('searchbox', { name: 'Search artists, albums and songs' });
    this.librarySearchButton = this.playDialog.getByRole('button', { name: 'Search', exact: true });

    this.loginView = page.getByRole('region', { name: 'Log in' });
    this.loginPassword = this.loginView.getByLabel('Admin password');
    this.loginButton = this.loginView.getByRole('button', { name: 'Log in' });
    this.loginStatus = this.loginView.getByRole('alert');

    // "Jukebox QR code" holds "Jukebox", so the name matches exactly.
    this.jukeboxDialog = page.getByRole('dialog', { name: 'Jukebox', exact: true });
    this.jukeboxClosedText = this.jukeboxDialog.getByText('The jukebox is closed.');
    this.jukeboxLifetime = this.jukeboxDialog.getByLabel('Open for');
    this.openJukeboxButton = this.jukeboxDialog.getByRole('button', { name: 'Open the jukebox' });
    this.jukeboxQr = this.jukeboxDialog.getByRole('img', { name: /^QR code for the / });
    // The link, the status line and the message have no role or label, so their ids locate them.
    this.jukeboxUrl = this.jukeboxDialog.locator('#jukebox-url');
    this.jukeboxStatus = this.jukeboxDialog.locator('#jukebox-status');
    this.jukeboxMessage = this.jukeboxDialog.locator('#jukebox-message');
    this.fullScreenButton = this.jukeboxDialog.getByRole('button', { name: 'Full screen' });
    this.downloadQrButton = this.jukeboxDialog.getByRole('button', { name: 'Download QR' });
    this.newCodeButton = this.jukeboxDialog.getByRole('button', { name: 'New code' });
    this.signOutGuestsCheckbox = this.jukeboxDialog.getByRole('checkbox', { name: 'Sign out current guests' });
    this.makeNewCodeButton = this.jukeboxDialog.getByRole('button', { name: 'Make new code' });
    this.closeJukeboxButton = this.jukeboxDialog.getByRole('button', { name: 'Close the jukebox' });
    this.fullScreenDialog = page.getByRole('dialog', { name: 'Jukebox QR code' });
    this.fullScreenQr = this.fullScreenDialog.getByRole('img');

    this.guestsDialog = page.getByRole('dialog', { name: 'Guests' });
    this.guestsCloseButton = this.guestsDialog.getByRole('button', { name: 'Close', exact: true });
    // A ban row names the guest as its guest row does, so each list is scoped to its section.
    this.signedInGroup = this.guestsDialog.getByRole('group', { name: 'Signed in' });
    this.bannedGroup = this.guestsDialog.getByRole('group', { name: 'Banned' });
    // The list status lines, the ban warning and the messages have no role or label, so their ids locate them.
    this.guestListStatus = this.signedInGroup.locator('#guest-list-status');
    this.guestMessage = this.signedInGroup.locator('#guest-message');
    this.banWarning = this.signedInGroup.locator('#guest-ban-warn');
    this.banListStatus = this.bannedGroup.locator('#ban-list-status');
    this.banMessage = this.bannedGroup.locator('#ban-message');
    this.banHoursSelect = this.signedInGroup.getByLabel('Also block their network address');
    this.banNewCodeCheckbox = this.signedInGroup.getByRole('checkbox', { name: /^Also make a new jukebox code/ });
    // Each guest row's Ban button names its guest, so the exact name picks the panel's button.
    this.banConfirmButton = this.signedInGroup.getByRole('button', { name: 'Ban', exact: true });
    this.banCancelButton = this.signedInGroup.getByRole('button', { name: 'Cancel', exact: true });
    this.guestLimitInput = this.guestsDialog.getByLabel('Songs each guest may have waiting');
    this.guestLimitSaveButton = this.guestsDialog.getByRole('button', { name: 'Save', exact: true });
    // The limit message is a live region with no role, so its id locates it.
    this.guestLimitMessage = this.guestsDialog.locator('#jukebox-guest-limit-message');
  }

  async goto(): Promise<void> {
    await this.page.goto(ADMIN_PATH);
  }

  async logIn(password: string): Promise<void> {
    await this.loginPassword.fill(password);
    await this.loginButton.click();
  }

  positionSeconds(): Promise<number> {
    return readPositionSeconds(this.positionLabel);
  }

  async openJukeboxDialog(): Promise<void> {
    await this.jukeboxButton.click();
  }

  async openJukebox(lifetimeHours: number): Promise<void> {
    await this.jukeboxLifetime.selectOption(String(lifetimeHours));
    await this.openJukeboxButton.click();
  }

  async makeNewCode({ signOutGuests }: { signOutGuests: boolean }): Promise<void> {
    await this.newCodeButton.click();
    await this.signOutGuestsCheckbox.setChecked(signOutGuests);
    await this.makeNewCodeButton.click();
  }

  async openGuestsDialog(): Promise<void> {
    await this.guestsButton.click();
  }

  async closeGuestsDialog(): Promise<void> {
    await this.guestsCloseButton.click();
  }

  /** A guest's row in the Guests dialog. The row names the guest by label, then nickname in parentheses. */
  guestRow(name: string): Locator {
    return this.signedInGroup.getByRole('listitem').filter({ has: this.page.getByText(name, { exact: true }) });
  }

  guestOnlineDot(name: string): Locator {
    return this.guestRow(name).getByRole('img', { name: 'Online' });
  }

  guestOfflineDot(name: string): Locator {
    return this.guestRow(name).getByRole('img', { name: 'Offline' });
  }

  /** The row's waiting-songs line, "No songs waiting" or the summary that opens the song list. */
  guestSongsLine(name: string): Locator {
    return this.guestRow(name).getByText(/^(No songs|\d+ songs?) waiting$/);
  }

  /** The waiting songs, listed once `showGuestSongs` opened them. */
  guestSongItems(name: string): Locator {
    return this.guestRow(name).getByRole('list').getByRole('listitem');
  }

  async showGuestSongs(name: string): Promise<void> {
    await this.guestSongsLine(name).click();
  }

  async removeGuest(name: string): Promise<void> {
    await this.guestRow(name).getByRole('button', { name: `Remove ${name}`, exact: true }).click();
  }

  async openBanPanel(name: string): Promise<void> {
    await this.guestRow(name).getByRole('button', { name: `Ban ${name}`, exact: true }).click();
  }

  async confirmBan({ networkBanHours, newCode }: BanChoice): Promise<void> {
    await this.banHoursSelect.selectOption(String(networkBanHours));
    await this.banNewCodeCheckbox.setChecked(newCode);
    await this.banConfirmButton.click();
  }

  async banGuest(name: string, choice: BanChoice): Promise<void> {
    await this.openBanPanel(name);
    await this.confirmBan(choice);
  }

  /** A ban row by its guest name. A network ban lists a second row under the same name, which its detail line tells apart. */
  banRow(name: string, kind: BanKind): Locator {
    const detail = kind === 'network' ? /^Network .+ blocked until / : /^Browser blocked until /;
    return this.bannedGroup.getByRole('listitem')
      .filter({ has: this.page.getByText(name, { exact: true }) })
      .filter({ has: this.page.getByText(detail) });
  }

  async unban(name: string, kind: BanKind): Promise<void> {
    await this.banRow(name, kind).getByRole('button', { name: `Unban ${name}`, exact: true }).click();
  }

  async setGuestLimit(limit: number): Promise<void> {
    await this.guestLimitInput.fill(String(limit));
    await this.guestLimitSaveButton.click();
  }

  /** A queue row by its song title. The row's play button names the title and, for a labeled song, its adder. */
  queueRow(title: string): Locator {
    return this.queueRows.filter({ has: this.page.getByText(title, { exact: true }) });
  }

  queuePlayButton(title: string): Locator {
    return this.queueRow(title).getByRole('button').first();
  }

  removeButton(title: string): Locator {
    return this.queue.getByRole('button', { name: `Remove ${title} from the queue`, exact: true });
  }

  /** Replaces the queue with an album through the play dialog's search, which closes the dialog. */
  async replaceQueueWithAlbum(album: string): Promise<void> {
    await this.openPlayDialogButton.click();
    await this.replaceModeLabel.click();
    await this.librarySearchBox.fill(album);
    await this.librarySearchButton.click();
    await this.playDialog.getByRole('button', { name: `Play “${album}” now`, exact: true }).click();
  }

  /** See `answerNextPrompt`. */
  acceptNextPrompt(): Promise<string> {
    return answerNextPrompt(this.page, 'accept');
  }

  dismissNextPrompt(): Promise<string> {
    return answerNextPrompt(this.page, 'dismiss');
  }
}
