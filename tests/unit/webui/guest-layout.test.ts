/**
 * Navidrome MCP Server - Guest page layout test
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// src/webui/public/ is outside eslint and type checking, and no DOM library runs in vitest. These
// checks read the page source, so a moved section or a renamed id fails here and not in a browser.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string): string => readFileSync(new URL(`../../../src/webui/public/${file}`, import.meta.url), 'utf8');

const HTML = read('guest.html');

describe('guest page order', () => {
  it('lists now playing, progress, the You are line, Queue, Lyrics, then Add songs', () => {
    const markers = [
      'aria-label="Now playing"',
      'aria-label="Progress"',
      'id="guest-jukebox"',
      'aria-label="Play queue"',
      'aria-label="Lyrics"',
      'id="guest-add"',
    ];
    const positions = markers.map((marker) => HTML.indexOf(marker));
    expect(positions.every((position) => position !== -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});

describe('guest header search button', () => {
  it('is a hidden icon button named Add songs in the header', () => {
    const header = HTML.slice(HTML.indexOf('<header class="topbar">'), HTML.indexOf('</header>'));
    expect(header).toMatch(/<button[^>]*id="guest-add-jump"[^>]*aria-label="Add songs"[^>]*hidden/);
  });

  it('scrolls to the section and focuses its field, and hides with the section', () => {
    const add = read('guest-add.js');
    expect(add).toContain('section.scrollIntoView(');
    expect(add).toContain('input.focus({ preventScroll: true })');
    expect(add).toContain('setHidden(jump, !canQueue)');
  });

  it('hides on every join card, since the header outlives the main view', () => {
    expect(read('guest.js')).toMatch(/function showJoinCard[\s\S]*?showGuestAdd\(false\)/);
  });
});

describe('guest lyrics panel', () => {
  it('starts collapsed behind a Show lyrics button', () => {
    expect(HTML).toMatch(/id="guest-lyrics-toggle"[^>]*aria-expanded="false"[^>]*>Show lyrics</);
    expect(HTML).toMatch(/id="guest-lyrics-body" hidden/);
  });

  it('flips the button text between Show lyrics and Hide lyrics', () => {
    const lyrics = read('guest-lyrics.js');
    expect(lyrics).toContain("open ? 'Hide lyrics' : 'Show lyrics'");
  });

  it('scrolls the lines without animation under reduced motion', () => {
    const lyrics = read('guest-lyrics.js');
    expect(lyrics).toContain("scrollToActive(reducedMotion.matches ? 'auto' : 'smooth')");
    expect(lyrics).toContain("scrollToActive('auto')");
    expect(lyrics).not.toContain("'instant'");
  });
});

describe('guest queue preview', () => {
  it('keeps a Show all button in the queue section, hidden until more wait', () => {
    expect(HTML).toMatch(/id="guest-queue-more"[^>]*hidden/);
    expect(read('guest-queue.js')).toContain('`Show all ${items.length}`');
    expect(read('guest-queue.js')).toContain('hasMoreWaiting(items, currentIndex, UPCOMING_LIMIT)');
    expect(read('guest-queue.js')).toContain('setHidden(more, !hasMore)');
  });

  it('exposes the queue toggle state like the lyrics toggle', () => {
    expect(HTML).toMatch(/id="guest-queue-more"[^>]*aria-controls="guest-queue-list"[^>]*aria-expanded="false"/);
    expect(read('guest-queue.js')).toContain("more.setAttribute('aria-expanded', String(showAll))");
  });

  it('binds the queue and lyrics toggles once with the other guest controls', () => {
    const guest = read('guest.js');
    expect(guest).toContain('bindGuestQueue();');
    expect(guest).toContain('bindGuestLyrics();');
  });

  it('leaves the admin queue unwindowed', () => {
    expect(read('queue.js')).not.toContain('queueWindow');
  });
});

describe('guest nickname controls', () => {
  it('puts a hidden Change name button and an inline Save and Cancel form under the You are line', () => {
    expect(HTML).toMatch(/id="guest-name-change"[^>]*hidden>Change name</);
    expect(HTML).toMatch(/<form[^>]*id="guest-name-form"[^>]*hidden>/);
    expect(HTML).toMatch(/id="guest-name-save">Save</);
    expect(HTML).toMatch(/id="guest-name-cancel">Cancel</);
    expect(HTML.indexOf('id="guest-jukebox"')).toBeLessThan(HTML.indexOf('id="guest-name-form"'));
    expect(HTML.indexOf('id="guest-name-form"')).toBeLessThan(HTML.indexOf('aria-label="Play queue"'));
  });

  it('saves a typed nickname through the guest route before Got it closes the card', () => {
    expect(HTML).toMatch(/<button type="button"[^>]*id="guest-welcome-done">Got it</);
    const welcome = read('guest-welcome.js');
    expect(welcome).toMatch(/async function closeAfterSave\(\) \{\s*if \(await saveTypedNickname\(\)\) dialog\.close\(\);/);
    expect(read('api.js')).toContain("requestJson('/api/guest/nickname', { nickname })");
  });

  it('hides the controls for the admin preview and on every join card', () => {
    const guest = read('guest.js');
    expect(guest).toContain('showChangeName(canQueue);');
    expect(guest).toMatch(/function showJoinCard[\s\S]*?showChangeName\(false\)/);
    expect(read('guest-welcome.js')).toContain('setHidden(nicknameFields, !canQueue)');
  });
});
