/**
 * Navidrome MCP Server - Jukebox Remote message line test
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// src/webui/public/ is outside eslint and type checking, and no DOM library runs in vitest. These
// tests give messages.js a minimal fake document, so its timing and save rules run without a browser.

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeElement {
  textContent: string;
  dataset: Record<string, string>;
  inert: boolean;
  disabled: boolean;
  isConnected: boolean;
  attributes: Map<string, string>;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
  replaceChildren: (...nodes: unknown[]) => void;
  contains: (node: unknown) => boolean;
  focus: ReturnType<typeof vi.fn>;
}

interface Messages {
  readingTimeMs: (text: string) => number;
  showMessage: (el: FakeElement, text: string, tone: string) => void;
  clearMessage: (el: FakeElement) => void;
  runDialogSave: (options: {
    form: FakeElement;
    button?: FakeElement | null;
    line: FakeElement;
    request: () => Promise<unknown>;
    confirm?: boolean;
  }) => Promise<boolean>;
}

const FAILED_TEXT = 'That action failed. Try again.';
const FADE_MS = 150;
const SAVED_HOLD_MS = 1500;

const read = (file: string): string => readFileSync(new URL(`../../../src/webui/public/${file}`, import.meta.url), 'utf8');

function fakeElement(textContent = '', children: FakeElement[] = []): FakeElement {
  const el: FakeElement = {
    textContent,
    dataset: {},
    inert: false,
    disabled: false,
    isConnected: true,
    attributes: new Map(),
    setAttribute: (name, value) => { el.attributes.set(name, value); },
    removeAttribute: (name) => { el.attributes.delete(name); },
    replaceChildren: (...nodes) => {
      el.textContent = nodes.map((node) => (typeof node === 'string' ? node : '')).join('');
    },
    contains: (node) => node === el || children.includes(node as FakeElement),
    focus: vi.fn(),
  };
  return el;
}

let documentStub: { activeElement: unknown; body: unknown; createElementNS: () => unknown };

async function loadMessages(): Promise<Messages> {
  vi.resetModules();
  documentStub = {
    activeElement: null,
    body: { tag: 'body' },
    createElementNS: () => ({ setAttribute: () => undefined, appendChild: () => undefined }),
  };
  vi.stubGlobal('document', documentStub);
  return (await import('../../../src/webui/public/messages.js')) as unknown as Messages;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('readingTimeMs', () => {
  it('gives 1500 ms plus 50 ms per character', async () => {
    const { readingTimeMs } = await loadMessages();

    expect(readingTimeMs('x'.repeat(40))).toBe(3500);
  });

  it('clamps a short text to 2500 ms and a long text to 6000 ms', async () => {
    const { readingTimeMs } = await loadMessages();

    expect(readingTimeMs('Saved.')).toBe(2500);
    expect(readingTimeMs('x'.repeat(20))).toBe(2500);
    expect(readingTimeMs('x'.repeat(90))).toBe(6000);
    expect(readingTimeMs('x'.repeat(400))).toBe(6000);
  });
});

describe('showMessage', () => {
  it('clears a success after its reading time and a fade', async () => {
    const { readingTimeMs, showMessage } = await loadMessages();
    const line = fakeElement();
    const text = 'Added “Album One” to the queue.';

    showMessage(line, text, 'success');
    expect(line.textContent).toBe(text);
    expect(line.dataset.tone).toBe('success');

    vi.advanceTimersByTime(readingTimeMs(text) - 1);
    expect(line.textContent).toBe(text);
    expect(line.dataset.leaving).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(line.dataset.leaving).toBe('');
    vi.advanceTimersByTime(FADE_MS);
    expect(line.textContent).toBe('');
    expect(line.dataset.tone).toBeUndefined();
    expect(line.dataset.leaving).toBeUndefined();
  });

  it.each(['error', 'warning', 'info'])('keeps %s text until the next message or clear on the line', async (tone) => {
    const { clearMessage, showMessage } = await loadMessages();
    const line = fakeElement();

    showMessage(line, 'Could not add “Album One”.', tone);
    vi.advanceTimersByTime(60_000);
    expect(line.textContent).toBe('Could not add “Album One”.');
    expect(line.dataset.tone).toBe(tone);

    clearMessage(line);
    expect(line.textContent).toBe('');
    expect(line.dataset.tone).toBeUndefined();
  });

  it('replaces a success at once, so its clear never removes the next message', async () => {
    const { showMessage } = await loadMessages();
    const line = fakeElement();

    showMessage(line, 'Saved.', 'success');
    vi.advanceTimersByTime(2000);
    showMessage(line, 'Could not save settings.', 'error');
    vi.advanceTimersByTime(60_000);

    expect(line.textContent).toBe('Could not save settings.');
    expect(line.dataset.tone).toBe('error');
  });

  it('shows a message that arrives during the fade at full opacity', async () => {
    const { readingTimeMs, showMessage } = await loadMessages();
    const line = fakeElement();

    showMessage(line, 'Saved.', 'success');
    vi.advanceTimersByTime(readingTimeMs('Saved.'));
    showMessage(line, 'Could not save settings.', 'error');
    vi.advanceTimersByTime(FADE_MS);

    expect(line.textContent).toBe('Could not save settings.');
    expect(line.dataset.leaving).toBeUndefined();
  });

  it('refuses an unknown tone', async () => {
    const { showMessage } = await loadMessages();

    expect(() => showMessage(fakeElement(), 'Saved.', 'succes')).toThrow('unknown tone "succes"');
  });

  it('writes text only through textContent', () => {
    expect(read('messages.js')).not.toMatch(/innerHTML|insertAdjacentHTML/);
  });
});

describe('the message lines', () => {
  const ADMIN = read('index.html');
  const GUEST = read('guest.html');
  const CSS = read('styles.css');
  // Each line, its page and the modules that write it.
  const LINES: Array<[string, string, string[]]> = [
    ['control-status', ADMIN, ['controls.js']],
    ['audio-device-status', ADMIN, ['audio-device.js']],
    ['settings-status', ADMIN, ['settings.js']],
    ['network-info-status', ADMIN, ['network-info.js']],
    ['play-status', ADMIN, ['library-play.js', 'play-dialog.js']],
    ['guest-message', ADMIN, ['guests-list.js']],
    ['ban-message', ADMIN, ['guests-list.js']],
    ['jukebox-guest-limit-message', ADMIN, ['guests.js']],
    ['jukebox-message', ADMIN, ['jukebox.js']],
    ['guest-name-status', GUEST, ['guest-name.js']],
    ['guest-nickname-status', GUEST, ['guest-welcome.js']],
    ['guest-status', GUEST, ['guest-add.js']],
  ];

  it.each(LINES)('holds #%s in a slot that keeps its space while it is empty', (id, page) => {
    expect(page).toMatch(new RegExp(String.raw`<div class="msg-slot[^"]*"[^>]*><p class="msg[^"]*" id="${id}" aria-live="polite"></p></div>`));
  });

  it.each(LINES)('writes #%s only through messages.js', (id, _page, files) => {
    for (const file of files) {
      const source = read(file);
      const name = new RegExp(String.raw`const (\w+) = byId\('${id}'\);`).exec(source)?.[1];
      expect(name, `${file} looks up #${id}`).toBeDefined();
      expect(source).not.toMatch(new RegExp(String.raw`\b${name}\.(textContent|innerHTML)\s*=`));
    }
  });

  it('routes the All settings result line through messages.js', () => {
    expect(read('settings.js')).not.toMatch(/statusLine\.textContent\s*=/);
  });

  it('reports every play result in the Play Music status bar, outside the panes', () => {
    const dialog = ADMIN.slice(ADMIN.indexOf('<dialog id="play-dialog"'), ADMIN.indexOf('</dialog>', ADMIN.indexOf('<dialog id="play-dialog"')));
    expect(dialog.lastIndexOf('class="modal-pane"')).toBeLessThan(dialog.indexOf('id="play-status"'));
    expect(dialog).toMatch(/id="play-status"[^\n]*\n\s*<\/form>/);
    expect(CSS).toMatch(/\.modal-full \.play-status-bar \{ flex: none; \}/);
    for (const removed of ['lib-status', 'favorites-status']) {
      expect(ADMIN).not.toContain(`id="${removed}"`);
      for (const file of ['search-pane.js', 'favorites-pane.js', 'playlists-pane.js', 'library-tree.js', 'library-play.js']) {
        expect(read(file)).not.toContain(removed);
      }
    }
    expect(ADMIN).toContain('id="playlists-status"');
  });

  it('places each dialog line after the controls that write it', () => {
    const settings = ADMIN.slice(ADMIN.indexOf('<dialog id="settings-dialog"'), ADMIN.indexOf('</dialog>', ADMIN.indexOf('<dialog id="settings-dialog"')));
    expect(settings).toMatch(/id="settings-status"[^\n]*\n\s*<\/form>/);
    expect(GUEST.indexOf('id="guest-welcome-done"')).toBeLessThan(GUEST.indexOf('id="guest-nickname-status"'));
    expect(GUEST.indexOf('id="guest-name-form"')).toBeLessThan(GUEST.indexOf('id="guest-name-status"'));
  });

  it('marks each dialog Save button to hold its width while its label changes', () => {
    for (const [page, id] of [[ADMIN, 'jukebox-guest-limit-save'], [GUEST, 'guest-nickname-save'], [GUEST, 'guest-name-save']] as const) {
      expect(page).toMatch(new RegExp(String.raw`class="primary-btn save-btn" id="${id}">Save<`));
    }
    expect(CSS).toMatch(/\.save-btn \{ min-width: [\d.]+rem; \}/);
  });

  it('makes no message line an overlay, apart from the guest bar', () => {
    const fixedOrAbsolute = [...CSS.matchAll(/([^{}]+)\{[^}]*position: (fixed|absolute)/g)].map((match) => (match[1] ?? '').trim());
    expect(fixedOrAbsolute.filter((selector) => /\.msg\b|msg-slot/.test(selector))).toEqual([]);
    expect(fixedOrAbsolute).toContain('.guest-status-bar');
  });

  it('turns off every message transition under reduced motion', () => {
    const reduced = [...CSS.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map((match) => match[1]).join('\n');
    expect(CSS).toMatch(/\.msg\[data-tone\] \{ animation: msg-in/);
    expect(CSS).toMatch(/\.msg\[data-leaving\] \{ opacity: 0; transition: opacity/);
    expect(CSS).toMatch(/form\[aria-busy="true"\] \{ opacity: [\d.]+; transition: opacity/);
    expect(reduced).toMatch(/\.msg\[data-tone\] \{ animation: none; \}/);
    expect(reduced).toMatch(/\.msg\[data-leaving\],\s*form\[aria-busy="true"\] \{ transition: none; \}/);
  });
});

describe('runDialogSave', () => {
  function saveParts() {
    const button = fakeElement('Save');
    const input = fakeElement();
    const line = fakeElement();
    const form = fakeElement('', [button, input, line]);
    return { button, input, line, form };
  }

  it('blocks the form and labels the button Saving… until the answer, then shows Saved for 1500 ms', async () => {
    const { runDialogSave } = await loadMessages();
    const { button, line, form } = saveParts();
    const answer = deferred<unknown>();

    const saving = runDialogSave({ form, button, line, request: () => answer.promise });

    expect(form.inert).toBe(true);
    expect(form.attributes.get('aria-busy')).toBe('true');
    expect(button.textContent).toBe('Saving…');
    answer.resolve({ ok: true });
    await expect(saving).resolves.toBe(true);
    expect(form.inert).toBe(false);
    expect(form.attributes.has('aria-busy')).toBe(false);
    expect(button.textContent).toBe('Saved');
    expect(button.disabled).toBe(true);
    expect(line.textContent).toBe('');

    vi.advanceTimersByTime(SAVED_HOLD_MS - 1);
    expect(button.textContent).toBe('Saved');
    vi.advanceTimersByTime(1);
    expect(button.textContent).toBe('Save');
    expect(button.disabled).toBe(false);
  });

  it('restores the form and button at once on a failure and keeps the error on the line', async () => {
    const { runDialogSave } = await loadMessages();
    const { button, line, form } = saveParts();
    line.textContent = 'An older error.';

    const saved = await runDialogSave({ form, button, line, request: () => Promise.resolve({ ok: false, error: 'Not allowed' }) });

    expect(saved).toBe(false);
    expect(form.inert).toBe(false);
    expect(button.textContent).toBe('Save');
    expect(button.disabled).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(line.textContent).toBe('Not allowed');
    expect(line.dataset.tone).toBe('error');
  });

  it('shows a warning answer on the line in place of the button confirmation', async () => {
    const { runDialogSave } = await loadMessages();
    const { button, line, form } = saveParts();
    const warning = 'Applied until the player restarts. settings.json was not written.';

    const saved = await runDialogSave({ form, button, line, request: () => Promise.resolve({ ok: true, warning }) });

    expect(saved).toBe(true);
    expect(button.textContent).toBe('Save');
    vi.advanceTimersByTime(60_000);
    expect(line.textContent).toBe(warning);
    expect(line.dataset.tone).toBe('warning');
  });

  it('confirms a save with no button on its line, Saving… then Saved. for its reading time', async () => {
    const { readingTimeMs, runDialogSave } = await loadMessages();
    const { line, form } = saveParts();
    const answer = deferred<unknown>();

    const saving = runDialogSave({ form, line, request: () => answer.promise });

    expect(line.textContent).toBe('Saving…');
    expect(line.dataset.tone).toBe('info');
    answer.resolve({ ok: true });
    await saving;
    expect(line.textContent).toBe('Saved.');
    expect(line.dataset.tone).toBe('success');
    vi.advanceTimersByTime(readingTimeMs('Saved.') + FADE_MS);
    expect(line.textContent).toBe('');
  });

  it('skips the Saved state for a form that closes on success', async () => {
    const { runDialogSave } = await loadMessages();
    const { button, line, form } = saveParts();

    const saved = await runDialogSave({ form, button, line, request: () => Promise.resolve({ ok: true }), confirm: false });

    expect(saved).toBe(true);
    expect(button.textContent).toBe('Save');
    expect(button.disabled).toBe(false);
    expect(line.textContent).toBe('');
  });

  it('releases the form and names the failure when the request throws', async () => {
    const { runDialogSave } = await loadMessages();
    const { button, line, form } = saveParts();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const saved = await runDialogSave({ form, button, line, request: () => Promise.reject(new Error('boom')) });

    expect(saved).toBe(false);
    expect(form.inert).toBe(false);
    expect(button.textContent).toBe('Save');
    expect(line.textContent).toBe(FAILED_TEXT);
  });

  it('ends a Saved hold before a second save, so the label never sticks on Saved', async () => {
    const { runDialogSave } = await loadMessages();
    const { button, line, form } = saveParts();
    const ok = (): Promise<unknown> => Promise.resolve({ ok: true });

    await runDialogSave({ form, button, line, request: ok });
    vi.advanceTimersByTime(500);
    const second = runDialogSave({ form, button, line, request: ok });
    expect(button.textContent).toBe('Saving…');
    await second;
    vi.advanceTimersByTime(SAVED_HOLD_MS);

    expect(button.textContent).toBe('Save');
    expect(button.disabled).toBe(false);
  });

  it('gives focus back to the control the inert form took it from', async () => {
    const { runDialogSave } = await loadMessages();
    const { button, input, line, form } = saveParts();
    documentStub.activeElement = input;

    await runDialogSave({
      form,
      button,
      line,
      request: () => {
        documentStub.activeElement = documentStub.body;
        return Promise.resolve({ ok: false, error: 'Not allowed' });
      },
    });

    expect(input.focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});
