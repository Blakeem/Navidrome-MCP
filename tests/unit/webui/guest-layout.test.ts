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
    expect(add).toContain('setHidden(jump, !visible)');
  });

  it('keeps Add songs in place when a snapshot or a lyrics answer redraws the sections above it', () => {
    expect(read('guest.js')).toMatch(/keepAddSongsInPlace\(\(\) => \{\s*renderNowPlaying\([\s\S]*?renderGuestQueue\([\s\S]*?renderJukebox\(jukebox\);\s*\}\);/);
    expect(read('guest-lyrics.js')).toContain('keepAddSongsInPlace(() => showLyrics(dto));');
    expect(read('styles.css')).toContain('.guest-page { overflow-anchor: none; }');
  });

  it('reports add and remove results in a toast outside the page flow', () => {
    expect(HTML.indexOf('id="guest-toast"')).toBeGreaterThan(HTML.indexOf('</main>'));
    expect(HTML).toMatch(/<p class="guest-toast" id="guest-toast" role="status"><\/p>/);
    expect(read('styles.css')).toMatch(/\.guest-toast \{\s*position: fixed;/);
  });

  it('asks before an Added button removes the song', () => {
    expect(read('guest-add.js')).toContain("window.confirm(removeConfirmText(song, 'guest'))");
  });

  it('hides on every join card, since the header outlives the main view', () => {
    expect(read('guest.js')).toMatch(/function showJoinCard[\s\S]*?showGuestAdd\(false\)/);
  });
});

describe('guest page visualizer', () => {
  it('closes the levels stream on every join card, since no snapshot arrives to close it', () => {
    expect(read('guest.js')).toMatch(/function showJoinCard[\s\S]*?stopVisualizer\(\);/);
    expect(read('visualizer.js')).toMatch(/export function stopVisualizer\(\) \{\s*enabled = false;\s*refresh\(\);/);
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

// A removed or banned guest sees the join card, so its only admin link is the one a host page shows.
describe('guest join card', () => {
  it('links to the admin page only from the host link line', () => {
    const start = HTML.indexOf('id="guest-join"');
    const joinCard = HTML.slice(start, HTML.indexOf('</section>', start));
    const hostLine = /<p[^>]*id="guest-host-link"[^>]*hidden><a href="\/admin"><\/a><\/p>/;

    expect(start).toBeGreaterThan(-1);
    expect(joinCard).toMatch(hostLine);
    expect(joinCard.replace(hostLine, '')).not.toContain('/admin');
    expect(read('guest.js')).toContain("setHidden(hostLink, !isHost || adminLink === '');");
    for (const file of ['guest.js', 'guest-welcome.js', 'guest-name.js', 'guest-add.js', 'page-view.js']) {
      expect(read(file)).not.toContain('/admin');
    }
  });

  it('writes the Copy link feedback to its label, so the button keeps its icon', () => {
    expect(read('jukebox.js')).not.toMatch(/copyBtn\.textContent/);
    expect(read('index.html')).toMatch(/id="jukebox-copy"[^>]*><svg[\s\S]*?<\/svg><span id="jukebox-copy-label">Copy link<\/span>/);
  });
});

describe('guest nickname controls', () => {
  it('puts a hidden Change name button and an inline Save and Cancel form under the You are line', () => {
    expect(HTML).toMatch(/id="guest-name-change"[^>]*hidden><svg[^>]*><path[^>]*\/><\/svg>Change name</);
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

  it('shows the controls to a guest and the host, and hides them on every join card', () => {
    const guest = read('guest.js');
    expect(guest).toContain('showChangeName(true);');
    expect(guest).toMatch(/function showJoinCard[\s\S]*?showChangeName\(false\)/);
    expect(HTML).toContain('<div class="nickname-fields">');
  });
});

describe('guest page for the host', () => {
  it('shows the host banner with its player link inside the main view only', () => {
    const banner = /<p class="guest-host-banner" id="guest-host-banner" hidden>You are on the guest page as the host\. <a href="\/admin">Open the player<\/a><\/p>/;
    expect(HTML.slice(HTML.indexOf('<main id="guest-main"'), HTML.indexOf('</main>'))).toMatch(banner);
    expect(read('guest.js')).toContain('setHidden(hostBanner, !isHost);');
  });

  it('welcomes the host by the name it uses, with the song limit and no expiry line', () => {
    const welcome = read('guest-welcome.js');
    expect(welcome).toContain('`You are adding songs as ${name}.${queueText(jukebox)}`');
    expect(welcome).toContain("expiry.textContent = isHost ? '' : jukeboxEndText(jukebox.expiresAt);");
    expect(welcome).toContain(' You can add up to ${songs} at a time to the end of the queue, and remove your own songs before they start playing.');
  });

  it('shows the closed card with the player link while no code is live', () => {
    const guest = read('guest.js');
    expect(guest).toContain("const CLOSED_TITLE = 'The jukebox is closed.';");
    expect(guest).toContain("const HOST_CLOSED_HELP = 'Open it from the player.';");
    expect(guest).toContain("const HOST_PLAYER_LINK = 'Open the player';");
    expect(guest).toMatch(/view === 'host-closed'\) \{\s*isHost = true;\s*showHostClosedCard\(\);/);
  });
});
