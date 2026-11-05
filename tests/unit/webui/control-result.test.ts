/**
 * Navidrome MCP Server - Control result banner test
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// src/webui/public/ is outside eslint and type checking, and no DOM library runs in vitest. These
// tests give the page modules a minimal fake document, so the refusal paths run without a browser.

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { missingAudioOutputMessage, OUTPUT_MISSING_CODE } from '../../../src/tools/missing-audio-output.js';

interface FakeButton {
  focus: () => void;
  addEventListener: (type: string, listener: () => void) => void;
  click: () => void;
}
interface FakeBanner {
  hidden: boolean;
  inert: boolean;
  text: { textContent: string };
  button: FakeButton;
  setAttribute: (name: string) => void;
  removeAttribute: (name: string) => void;
  querySelector: (selector: string) => unknown;
}
interface FakeDom {
  status: { textContent: string };
  main: FakeBanner;
  lyrics: FakeBanner;
  active: FakeButton | null;
}

const OUTPUT_LOST_TEXT = 'The audio output is not connected. Turn it on, or pick another output.';
const AUTO_REFUSAL = missingAudioOutputMessage({ id: 'auto', name: null });
const NAMED_REFUSAL = missingAudioOutputMessage({ id: 'pulse/speaker', name: 'Speaker' });
const GENERIC_TEXT = 'That action failed. Try again.';
const REFUSED_TEXT = 'That is not possible right now.';

// A hidden or inert banner ignores focus, as a browser does.
function fakeBanner(getActive: () => FakeDom): FakeBanner {
  const listeners: Array<() => void> = [];
  const button: FakeButton = {
    focus: () => {
      if (!banner.hidden && !banner.inert) getActive().active = button;
    },
    addEventListener: (_type, listener) => {
      listeners.push(listener);
    },
    click: () => {
      for (const listener of listeners) listener();
    },
  };
  const banner: FakeBanner = {
    hidden: true,
    inert: false,
    text: { textContent: '' },
    button,
    setAttribute: () => {
      banner.hidden = true;
    },
    removeAttribute: () => {
      banner.hidden = false;
    },
    querySelector: (selector) => (selector === '.output-banner-text' ? banner.text : button),
  };
  return banner;
}

function installDom(): FakeDom {
  const dom: FakeDom = {
    status: { textContent: '' },
    main: fakeBanner(() => dom),
    lyrics: fakeBanner(() => dom),
    active: null,
  };
  const byId: Record<string, unknown> = {
    'control-status': dom.status,
    'output-banner': dom.main,
    'lyrics-output-banner': dom.lyrics,
  };
  vi.stubGlobal('document', {
    getElementById: (id: string) => byId[id] ?? null,
    get activeElement() {
      return dom.active;
    },
  });
  return dom;
}

async function loadPage() {
  vi.resetModules();
  const dom = installDom();
  const controls = await import('../../../src/webui/public/controls.js');
  const banner = await import('../../../src/webui/public/output-banner.js');
  return { dom, controls, banner };
}

function answerWith(body: unknown) {
  return vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)) });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.doUnmock('../../../src/webui/public/play-toolbar.js');
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('showControlResult', () => {
  it('clears the line after an answer that succeeded', async () => {
    const { dom, controls } = await loadPage();
    dom.status.textContent = 'old';

    controls.showControlResult(true, { success: true });

    expect(dom.status.textContent).toBe('');
  });

  it('clears the line after an answer with no success field', async () => {
    const { dom, controls } = await loadPage();
    dom.status.textContent = 'old';

    controls.showControlResult(true, { ok: true });

    expect(dom.status.textContent).toBe('');
  });

  it.each([
    ['the automatic device', AUTO_REFUSAL],
    ['a named device', NAMED_REFUSAL],
  ])('shows the banner and focuses its button when resume is refused for %s', async (_name, message) => {
    const { dom, controls } = await loadPage();
    dom.status.textContent = 'old';

    controls.showControlResult(true, { success: false, message, code: OUTPUT_MISSING_CODE });

    expect(dom.status.textContent).toBe('');
    expect(dom.main.hidden).toBe(false);
    expect(dom.lyrics.hidden).toBe(false);
    expect(dom.active).toBe(dom.main.button);
  });

  it('focuses the lyrics banner when the main view is inert', async () => {
    const { dom, controls } = await loadPage();
    dom.main.inert = true;

    controls.showControlResult(true, { success: false, message: NAMED_REFUSAL, code: OUTPUT_MISSING_CODE });

    expect(dom.active).toBe(dom.lyrics.button);
  });

  it('shows the banner and focuses its button when a play stays paused for a missing output', async () => {
    const { dom, controls } = await loadPage();
    dom.status.textContent = 'old';

    controls.showControlResult(true, { success: true, paused: true, message: NAMED_REFUSAL, code: OUTPUT_MISSING_CODE });

    expect(dom.status.textContent).toBe('');
    expect(dom.main.hidden).toBe(false);
    expect(dom.active).toBe(dom.main.button);
  });

  it('shows page wording for any other refusal and clears it after the delay', async () => {
    const { dom, controls } = await loadPage();

    controls.showControlResult(true, {
      success: false,
      message: 'The play queue is empty. Nothing to shuffle. Start something with a play tool.',
    });

    expect(dom.status.textContent).toBe(REFUSED_TEXT);
    expect(dom.main.hidden).toBe(true);
    vi.advanceTimersByTime(4000);
    expect(dom.status.textContent).toBe('');
  });

  it('shows page wording, not the message, for a refusal whose text names an audio output but carries no code', async () => {
    const { dom, controls } = await loadPage();

    controls.showControlResult(true, { success: false, message: NAMED_REFUSAL });

    expect(dom.status.textContent).toBe(REFUSED_TEXT);
    expect(dom.main.hidden).toBe(true);
  });

  it('shows the error text of a failed request', async () => {
    const { dom, controls } = await loadPage();

    controls.showControlResult(false, { error: 'Not allowed', message: NAMED_REFUSAL });

    expect(dom.status.textContent).toBe('Not allowed');
    expect(dom.main.hidden).toBe(true);
  });

  it('shows the generic text for a request that got no answer', async () => {
    const { dom, controls } = await loadPage();

    controls.showControlResult(false, null);

    expect(dom.status.textContent).toBe(GENERIC_TEXT);
  });
});

describe('playLibraryItem', () => {
  const NAME = 'Album One';

  async function loadLibraryPlay(mode: 'replace' | 'append') {
    const page = await loadPage();
    vi.doMock('../../../src/webui/public/play-toolbar.js', () => ({
      playMode: () => mode,
      shuffleOptions: () => ({}),
    }));
    const { playLibraryItem } = await import('../../../src/webui/public/library-play.js');
    const dialog = { close: vi.fn() };
    const button = { disabled: false, focus: vi.fn(), closest: () => dialog };
    const status = { textContent: '' };
    return { ...page, playLibraryItem, dialog, button, status };
  }

  it.each(['replace', 'append'] as const)('shows the banner when a %s play stays paused for a missing output', async (mode) => {
    const { dom, playLibraryItem, button, status } = await loadLibraryPlay(mode);
    vi.stubGlobal(
      'fetch',
      answerWith({ success: true, paused: true, message: NAMED_REFUSAL, code: OUTPUT_MISSING_CODE }),
    );

    await playLibraryItem(button, 'album', 'al-1', NAME, status);

    expect(dom.main.hidden).toBe(false);
    expect(dom.lyrics.hidden).toBe(false);
  });

  it('leaves the banner alone when the output is connected', async () => {
    const { dom, playLibraryItem, button, status } = await loadLibraryPlay('append');
    vi.stubGlobal('fetch', answerWith({ success: true }));

    await playLibraryItem(button, 'album', 'al-1', NAME, status);

    expect(dom.main.hidden).toBe(true);
    expect(status.textContent).toBe(`Added “${NAME}” to the queue.`);
  });
});

describe('postControl', () => {
  it('reports a refusal as not done, so a seek restores the clock', async () => {
    const { controls } = await loadPage();
    vi.stubGlobal('fetch', answerWith({ success: false, message: 'Nothing to seek.' }));

    await expect(controls.postControl('/api/controls/seek')).resolves.toBe(false);
  });

  it('reports a success as done', async () => {
    const { controls } = await loadPage();
    vi.stubGlobal('fetch', answerWith({ success: true }));

    await expect(controls.postControl('/api/controls/next')).resolves.toBe(true);
  });
});

describe('the output banner', () => {
  it('names no device and offers the picker in both views', async () => {
    const { dom, banner } = await loadPage();
    const onPick = vi.fn();

    banner.bindOutputBanner(onPick);
    dom.lyrics.button.click();

    expect(dom.main.text.textContent).toBe(OUTPUT_LOST_TEXT);
    expect(dom.lyrics.text.textContent).toBe(OUTPUT_LOST_TEXT);
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('follows the snapshot flag in both views', async () => {
    const { dom, banner } = await loadPage();

    banner.renderOutputBanner(true);
    expect([dom.main.hidden, dom.lyrics.hidden]).toEqual([false, false]);

    banner.renderOutputBanner(false);
    expect([dom.main.hidden, dom.lyrics.hidden]).toEqual([true, true]);
  });
});

describe('the page markup', () => {
  const html = readFileSync(new URL('../../../src/webui/public/index.html', import.meta.url), 'utf8');

  it.each(['output-banner', 'lyrics-output-banner'])('holds %s hidden with a Pick output button', (id) => {
    const start = html.indexOf(`id="${id}"`);
    const banner = html.slice(start, html.indexOf('</div>', start));

    expect(start).toBeGreaterThanOrEqual(0);
    expect(banner).toMatch(/^[^>]*hidden/);
    expect(banner).toMatch(/output-banner-btn[^>]*>Pick output<\/button>/);
  });

  it.each(['output-banner', 'lyrics-output-banner'])('ties the %s button to its text for a screen reader', (id) => {
    expect(html).toContain(`id="${id}-text"`);
    expect(html).toContain(`aria-describedby="${id}-text"`);
  });

  it('places the lyrics banner inside the lyrics footer', () => {
    const footer = html.slice(html.indexOf('<footer class="lyrics-transport">'), html.indexOf('</footer>'));

    expect(footer).toContain('id="lyrics-output-banner"');
  });
});
