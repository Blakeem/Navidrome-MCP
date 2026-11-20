/**
 * Navidrome MCP Server - Jukebox Remote notice test
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// src/webui/public/ is outside eslint and type checking, and no DOM library runs in vitest. These
// tests give messages.js a minimal fake document, so its notice, timing and save rules run without a browser.

import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (event: FakeEvent) => void;

interface FakeEvent {
  target: FakeNode;
  stopPropagation: ReturnType<typeof vi.fn>;
}

interface FakeNode {
  tag: string;
  className: string;
  type: string;
  textContent: string;
  hidden: boolean;
  open: boolean;
  inert: boolean;
  disabled: boolean;
  isConnected: boolean;
  dataset: Record<string, string>;
  attributes: Map<string, string>;
  children: FakeNode[];
  parentElement: FakeNode | null;
  listeners: Map<string, Listener[]>;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
  append: (...nodes: FakeNode[]) => void;
  appendChild: (node: FakeNode) => void;
  replaceChildren: (...nodes: unknown[]) => void;
  contains: (node: unknown) => boolean;
  addEventListener: (type: string, listener: Listener) => void;
  focus: ReturnType<typeof vi.fn>;
  showModal: () => void;
  close: () => void;
}

interface Messages {
  readingTimeMs: (text: string) => number;
  notify: (text: string, tone: string) => void;
  clearNotice: () => void;
  announce: (text: string) => void;
  openDialog: (dialog: FakeNode) => void;
  runDialogSave: (options: {
    form: FakeNode;
    button?: FakeNode | null;
    request: () => Promise<unknown>;
    confirm?: boolean;
  }) => Promise<boolean>;
}

const FAILED_TEXT = 'That action failed. Try again.';
const FADE_MS = 150;
const SAVED_HOLD_MS = 1500;
const ANNOUNCE_DELAY_MS = 100;
const ERROR_TEXT = 'Could not save settings.';

const PUBLIC_DIR = new URL('../../../src/webui/public/', import.meta.url);
const read = (file: string): string => readFileSync(new URL(file, PUBLIC_DIR), 'utf8');

function fakeNode(tag: string, textContent = ''): FakeNode {
  const el: FakeNode = {
    tag,
    className: '',
    type: '',
    textContent,
    hidden: false,
    open: false,
    inert: false,
    disabled: false,
    isConnected: true,
    dataset: {},
    attributes: new Map(),
    children: [],
    parentElement: null,
    listeners: new Map(),
    setAttribute: (name, value) => { el.attributes.set(name, value); },
    removeAttribute: (name) => { el.attributes.delete(name); },
    append: (...nodes) => {
      for (const node of nodes) {
        const from = node.parentElement;
        if (from !== null) from.children = from.children.filter((child) => child !== node);
        node.parentElement = el;
        el.children.push(node);
      }
    },
    appendChild: (node) => el.append(node),
    replaceChildren: (...nodes) => {
      el.textContent = nodes.map((node) => (typeof node === 'string' ? node : '')).join('');
    },
    contains: (node) => node === el || el.children.some((child) => child.contains(node)),
    addEventListener: (type, listener) => { el.listeners.set(type, [...(el.listeners.get(type) ?? []), listener]); },
    focus: vi.fn(),
    // A browser fires close as a task after close(), so a test fires it with fire().
    showModal: () => { el.open = true; },
    close: () => { el.open = false; },
  };
  return el;
}

function fire(el: FakeNode, type: string, target: FakeNode = el): FakeEvent {
  const event = { target, stopPropagation: vi.fn() };
  for (const listener of el.listeners.get(type) ?? []) listener(event);
  return event;
}

let documentStub: { activeElement: unknown; body: FakeNode; createElement: (tag: string) => FakeNode; createElementNS: () => FakeNode };

async function loadMessages(): Promise<Messages> {
  vi.resetModules();
  documentStub = {
    activeElement: null,
    body: fakeNode('body'),
    createElement: (tag) => fakeNode(tag),
    createElementNS: () => fakeNode('svg'),
  };
  vi.stubGlobal('document', documentStub);
  return (await import('../../../src/webui/public/messages.js')) as unknown as Messages;
}

// The notice and the live region are built on first use, so each is whichever node holds its class.
function findByClass(className: string, root: FakeNode): FakeNode | undefined {
  if (root.className === className) return root;
  for (const child of root.children) {
    const found = findByClass(className, child);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findNotice(root: FakeNode = documentStub.body): FakeNode | undefined {
  return findByClass('notice', root);
}

function findRegion(root: FakeNode = documentStub.body): FakeNode | undefined {
  return findByClass('visually-hidden', root);
}

function notice(root?: FakeNode): { box: FakeNode; text: FakeNode; dismiss: FakeNode } {
  const box = findNotice(root);
  if (box === undefined) throw new Error('no notice was built');
  const [text, dismiss] = box.children as [FakeNode, FakeNode];
  return { box, text, dismiss };
}

function shown(root?: FakeNode): string {
  const { box, text } = notice(root);
  return box.hidden ? '' : text.textContent;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

// A dialog shaped like the page's: a <dialog> that holds one <form>.
function modalDialog(): { dialog: FakeNode; form: FakeNode } {
  const dialog = fakeNode('dialog');
  const form = fakeNode('form');
  dialog.append(form);
  return { dialog, form };
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

describe('notify', () => {
  it.each(['success', 'info'])('fades a %s out after its reading time, then clears it', async (tone) => {
    const { readingTimeMs, notify } = await loadMessages();
    const text = 'Added “Album One” to the queue.';

    notify(text, tone);
    expect(shown()).toBe(text);
    expect(notice().box.dataset.tone).toBe(tone);
    expect(notice().dismiss.hidden).toBe(true);

    vi.advanceTimersByTime(readingTimeMs(text) - 1);
    expect(shown()).toBe(text);
    expect(notice().box.dataset.leaving).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(notice().box.dataset.leaving).toBe('');
    vi.advanceTimersByTime(FADE_MS);
    expect(shown()).toBe('');
    expect(notice().box.dataset.tone).toBeUndefined();
    expect(notice().box.dataset.leaving).toBeUndefined();
  });

  it('shows a notice that arrives during the fade at full opacity', async () => {
    const { readingTimeMs, notify } = await loadMessages();

    notify('Saved.', 'success');
    vi.advanceTimersByTime(readingTimeMs('Saved.'));
    notify(ERROR_TEXT, 'error');
    vi.advanceTimersByTime(FADE_MS);

    expect(shown()).toBe(ERROR_TEXT);
    expect(notice().box.dataset.leaving).toBeUndefined();
  });

  it('clears a success at once on a tap, and keeps the tap from the page', async () => {
    const { notify } = await loadMessages();

    notify('Saved.', 'success');
    const event = fire(notice().box, 'click', notice().text);

    expect(shown()).toBe('');
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  it.each(['error', 'warning'])('keeps a %s after any reading time and a tap on its text', async (tone) => {
    const { notify } = await loadMessages();

    notify(ERROR_TEXT, tone);
    vi.advanceTimersByTime(60_000);
    fire(notice().box, 'click', notice().text);

    expect(shown()).toBe(ERROR_TEXT);
    expect(notice().box.dataset.tone).toBe(tone);
    expect(notice().dismiss.hidden).toBe(false);
  });

  it('clears an error from its Dismiss button', async () => {
    const { notify } = await loadMessages();

    notify(ERROR_TEXT, 'error');
    const { box, dismiss } = notice();

    expect(dismiss.type).toBe('button');
    expect(dismiss.attributes.get('aria-label')).toBe('Dismiss');
    fire(box, 'click', dismiss);
    expect(shown()).toBe('');
  });

  it('replaces the notice that shows, so the old clear never removes the new text', async () => {
    const { notify } = await loadMessages();

    notify('Saved.', 'success');
    vi.advanceTimersByTime(2000);
    notify(ERROR_TEXT, 'error');
    vi.advanceTimersByTime(60_000);

    expect(shown()).toBe(ERROR_TEXT);
    expect(documentStub.body.children.filter((child) => child.className === 'notice')).toHaveLength(1);
  });

  it('clears on clearNotice, the clear each writer runs at the start of its next action', async () => {
    const { clearNotice, notify } = await loadMessages();

    clearNotice();
    notify(ERROR_TEXT, 'error');
    clearNotice();

    expect(shown()).toBe('');
  });

  it('marks an error as an alert and reads no other tone from the notice', async () => {
    const { notify } = await loadMessages();

    notify(ERROR_TEXT, 'error');
    expect(notice().text.attributes.get('role')).toBe('alert');
    expect(findRegion()).toBeUndefined();
    for (const tone of ['warning', 'info', 'success']) {
      notify('Applied until the player restarts.', tone);
      expect(notice().text.attributes.has('role')).toBe(false);
    }
  });

  it.each(['warning', 'info', 'success'])('reads a %s through the polite live region after the region is cleared', async (tone) => {
    const { notify } = await loadMessages();
    const text = 'Applied until the player restarts.';

    notify(text, tone);
    const region = findRegion();
    expect(region?.attributes.get('aria-live')).toBe('polite');
    expect(region?.textContent).toBe('');
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);

    expect(region?.textContent).toBe(text);
    expect(shown()).toBe(text);
  });

  it('refuses an unknown tone', async () => {
    const { notify } = await loadMessages();

    expect(() => notify('Saved.', 'succes')).toThrow('unknown tone "succes"');
  });

  it('writes text only through textContent', () => {
    expect(read('messages.js')).not.toMatch(/innerHTML|insertAdjacentHTML/);
  });
});

describe('the notice and modal dialogs', () => {
  it('moves into an open dialog, outside its form, and back to the page once the dialog closes', async () => {
    const { notify, openDialog } = await loadMessages();
    const { dialog, form } = modalDialog();

    openDialog(dialog);
    notify(ERROR_TEXT, 'error');

    expect(notice(dialog).box.parentElement).toBe(dialog);
    expect(form.contains(notice(dialog).box)).toBe(false);
    dialog.close();
    fire(dialog, 'close');
    notify(ERROR_TEXT, 'error');
    expect(notice().box.parentElement).toBe(documentStub.body);
  });

  it('moves the live region into the open dialog with the notice, and back to the page for an announce', async () => {
    const { announce, notify, openDialog } = await loadMessages();
    const { dialog, form } = modalDialog();

    openDialog(dialog);
    notify('Saved.', 'success');
    expect(findRegion(dialog)?.parentElement).toBe(dialog);
    expect(form.contains(findRegion(dialog))).toBe(false);

    dialog.close();
    fire(dialog, 'close');
    announce('Added Levitating.');
    expect(findRegion()?.parentElement).toBe(documentStub.body);
  });

  it('goes into the dialog that opened last', async () => {
    const { notify, openDialog } = await loadMessages();
    const settings = modalDialog().dialog;
    const networkInfo = modalDialog().dialog;

    openDialog(settings);
    openDialog(networkInfo);
    notify(ERROR_TEXT, 'error');
    expect(notice(networkInfo).box.parentElement).toBe(networkInfo);

    networkInfo.close();
    fire(networkInfo, 'close');
    notify(ERROR_TEXT, 'error');
    expect(notice(settings).box.parentElement).toBe(settings);
  });

  it('clears when a dialog opens', async () => {
    const { notify, openDialog } = await loadMessages();

    notify(ERROR_TEXT, 'error');
    openDialog(modalDialog().dialog);

    expect(shown()).toBe('');
  });

  it('clears when the dialog that holds it closes', async () => {
    const { notify, openDialog } = await loadMessages();
    const { dialog } = modalDialog();

    openDialog(dialog);
    notify(ERROR_TEXT, 'error');
    dialog.close();
    fire(dialog, 'close');

    expect(shown(dialog)).toBe('');
  });

  it('keeps a notice a writer shows on the page right after close(), before the close event', async () => {
    const { notify, openDialog } = await loadMessages();
    const { dialog } = modalDialog();

    openDialog(dialog);
    dialog.close();
    notify(ERROR_TEXT, 'error');
    fire(dialog, 'close');

    expect(notice().box.parentElement).toBe(documentStub.body);
    expect(shown()).toBe(ERROR_TEXT);
  });

  it('keeps a tap on the notice from the dialog that holds it', async () => {
    const { notify, openDialog } = await loadMessages();
    const { dialog } = modalDialog();

    openDialog(dialog);
    notify(ERROR_TEXT, 'error');
    const event = fire(notice(dialog).box, 'click', notice(dialog).text);

    expect(event.stopPropagation).toHaveBeenCalled();
  });

  it('is the only module that opens a modal dialog', () => {
    const modules = readdirSync(PUBLIC_DIR, { recursive: true, encoding: 'utf8' })
      .map((file) => file.replaceAll('\\', '/'))
      .filter((file) => file.endsWith('.js') && file !== 'messages.js');
    const openers = modules.filter((file) => read(file).includes('openDialog('));

    expect(modules.length).toBeGreaterThan(0);
    for (const file of modules) expect(read(file), file).not.toContain('.showModal(');
    expect(openers).toEqual(expect.arrayContaining(['audio-device.js', 'guest-welcome.js', 'guests.js', 'jukebox.js', 'lyrics-prefs.js', 'network-info.js', 'play-dialog.js', 'settings.js']));
  });
});

describe('announce', () => {
  it('reads the text from a hidden polite live region and shows no notice', async () => {
    const { announce } = await loadMessages();

    announce('Added Levitating.');
    const region = documentStub.body.children[0] as FakeNode;
    expect(region.className).toBe('visually-hidden');
    expect(region.attributes.get('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);

    expect(region.textContent).toBe('Added Levitating.');
    expect(findNotice()).toBeUndefined();
  });

  it('reads a repeated text again through one region', async () => {
    const { announce } = await loadMessages();

    announce('Removed Levitating.');
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
    announce('Removed Levitating.');
    const region = documentStub.body.children[0] as FakeNode;

    expect(region.textContent).toBe('');
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
    expect(region.textContent).toBe('Removed Levitating.');
    expect(documentStub.body.children).toHaveLength(1);
  });
});

describe('the pages', () => {
  const ADMIN = read('index.html');
  const GUEST = read('guest.html');
  const CSS = read('styles.css');
  const REMOVED_IDS = [
    'control-status',
    'audio-device-status',
    'settings-status',
    'network-info-status',
    'play-status',
    'guest-message',
    'ban-message',
    'jukebox-guest-limit-message',
    'jukebox-message',
    'guest-name-status',
    'guest-nickname-status',
    'guest-status',
    'guest-status-bar',
  ];
  const WRITERS = [
    'audio-device.js', 'controls.js', 'guest-add.js', 'guest-name.js', 'guest-welcome.js', 'guests-list.js',
    'guests.js', 'jukebox.js', 'library-play.js', 'network-info.js', 'play-dialog.js', 'settings.js',
  ];

  it('hold no message line', () => {
    for (const page of [ADMIN, GUEST]) {
      expect(page).not.toMatch(/msg-slot|class="msg\b/);
      for (const id of REMOVED_IDS) expect(page).not.toContain(`id="${id}"`);
    }
  });

  it.each(WRITERS)('%s reports only through the notice', (file) => {
    const source = read(file);
    expect(source).not.toMatch(/showMessage|clearMessage|\bline:/);
    for (const id of REMOVED_IDS) expect(source).not.toContain(`'${id}'`);
  });

  it('style no message line or bar', () => {
    expect(CSS).not.toMatch(/\.msg\b|msg-slot|msg-lines|--msg-lines|play-status-bar|guest-status-bar|guest-name-msg|--status-bar-height/);
    expect(CSS).not.toMatch(/\.guest-page \{[^}]*padding-bottom/);
  });

  it('pins the notice to the top edge, outside the layout, above the header and the lyrics view', () => {
    const rule = /\.notice \{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    const lyricsLayer = Number(/\.lyrics-view \{[^}]*z-index: (\d+);/.exec(CSS)?.[1]);

    expect(rule).toMatch(/position: fixed;/);
    expect(rule).toMatch(/inset: 0 0 auto;/);
    expect(rule).toMatch(/max-width: 760px;/);
    expect(rule).toMatch(/env\(safe-area-inset-top\)/);
    expect(rule).toMatch(/background: var\(--surface-2\);/);
    expect(Number(/z-index: (\d+);/.exec(rule)?.[1])).toBeGreaterThan(lyricsLayer);
    expect(CSS).toMatch(/\.notice\[hidden\] \{ display: none; \}/);
  });

  it('styles the full screen QR caption by its class, so the notice text in that dialog keeps its own style', () => {
    expect(ADMIN).toContain('<p class="jukebox-fullscreen-caption">');
    expect(CSS).not.toMatch(/\.jukebox-fullscreen[^{]*\bp\b[^{]*\{/);
  });

  it('borders a warning and an error in their tone colors', () => {
    expect(CSS).toMatch(/\.notice\[data-tone="warning"\] \{ border: 1px solid var\(--warn\);/);
    expect(CSS).toMatch(/\.notice\[data-tone="error"\] \{ border: 1px solid var\(--bad\);/);
  });

  it('marks each dialog Save button to hold its width while its label changes', () => {
    for (const [page, id] of [[ADMIN, 'jukebox-guest-limit-save'], [GUEST, 'guest-nickname-save'], [GUEST, 'guest-name-save']] as const) {
      expect(page).toMatch(new RegExp(String.raw`class="primary-btn save-btn" id="${id}">Save<`));
    }
    expect(CSS).toMatch(/\.save-btn \{ min-width: [\d.]+rem; \}/);
  });

  it('turns off every notice and save transition under reduced motion', () => {
    const reduced = [...CSS.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map((match) => match[1]).join('\n');
    expect(CSS).toMatch(/\.notice \{[^}]*animation: notice-in 150ms/);
    expect(CSS).toMatch(/form\[aria-busy="true"\] \{ opacity: [\d.]+; transition: opacity/);
    expect(CSS).toMatch(/\.notice\[data-leaving\] \{ opacity: 0; transition: opacity 150ms; \}/);
    expect(reduced).toMatch(/\.notice \{ animation: none; \}/);
    expect(reduced).toMatch(/\.notice\[data-leaving\],\s*form\[aria-busy="true"\] \{ transition: none; \}/);
  });
});

describe('runDialogSave', () => {
  function saveParts() {
    const { dialog, form } = modalDialog();
    const button = fakeNode('button', 'Save');
    const input = fakeNode('input');
    form.append(button, input);
    return { dialog, button, input, form };
  }

  it('blocks the form and labels the button Saving… until the answer, then shows Saved for 1500 ms', async () => {
    const { runDialogSave } = await loadMessages();
    const { button, form } = saveParts();
    const answer = deferred<unknown>();

    const saving = runDialogSave({ form, button, request: () => answer.promise });

    expect(form.inert).toBe(true);
    expect(form.attributes.get('aria-busy')).toBe('true');
    expect(button.textContent).toBe('Saving…');
    answer.resolve({ ok: true });
    await expect(saving).resolves.toBe(true);
    expect(form.inert).toBe(false);
    expect(form.attributes.has('aria-busy')).toBe(false);
    expect(button.textContent).toBe('Saved');
    expect(button.disabled).toBe(true);
    expect(findNotice()).toBeUndefined();

    vi.advanceTimersByTime(SAVED_HOLD_MS - 1);
    expect(button.textContent).toBe('Saved');
    vi.advanceTimersByTime(1);
    expect(button.textContent).toBe('Save');
    expect(button.disabled).toBe(false);
  });

  it('clears an older notice when the save starts', async () => {
    const { notify, runDialogSave } = await loadMessages();
    const { button, form } = saveParts();
    const answer = deferred<unknown>();
    notify('An older error.', 'error');

    const saving = runDialogSave({ form, button, request: () => answer.promise });

    expect(shown()).toBe('');
    answer.resolve({ ok: true });
    await saving;
  });

  it('restores the form and button at once on a failure and keeps the error in the dialog', async () => {
    const { openDialog, runDialogSave } = await loadMessages();
    const { dialog, button, form } = saveParts();
    openDialog(dialog);

    const saved = await runDialogSave({ form, button, request: () => Promise.resolve({ ok: false, error: 'Not allowed' }) });

    expect(saved).toBe(false);
    expect(form.inert).toBe(false);
    expect(button.textContent).toBe('Save');
    expect(button.disabled).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(shown(dialog)).toBe('Not allowed');
    expect(notice(dialog).box.dataset.tone).toBe('error');
    expect(notice(dialog).box.parentElement).toBe(dialog);
  });

  it('restores the form and button on a failure the caller already reported and attaches no notice', async () => {
    const { runDialogSave } = await loadMessages();
    const { button, form } = saveParts();

    const saved = await runDialogSave({ form, button, request: () => Promise.resolve({ ok: false, error: null }) });

    expect(saved).toBe(false);
    expect(form.inert).toBe(false);
    expect(button.textContent).toBe('Save');
    expect(button.disabled).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(findNotice()).toBeUndefined();
  });

  it('shows a warning answer in place of the button confirmation', async () => {
    const { runDialogSave } = await loadMessages();
    const { button, form } = saveParts();
    const warning = 'Applied until the player restarts. settings.json was not written.';

    const saved = await runDialogSave({ form, button, request: () => Promise.resolve({ ok: true, warning }) });

    expect(saved).toBe(true);
    expect(button.textContent).toBe('Save');
    vi.advanceTimersByTime(60_000);
    expect(shown()).toBe(warning);
    expect(notice().box.dataset.tone).toBe('warning');
  });

  it('confirms a save with no button with Saved. for its reading time, and shows no Saving… text', async () => {
    const { readingTimeMs, runDialogSave } = await loadMessages();
    const { form } = saveParts();
    const answer = deferred<unknown>();

    const saving = runDialogSave({ form, request: () => answer.promise });

    expect(findNotice()).toBeUndefined();
    expect(form.attributes.get('aria-busy')).toBe('true');
    answer.resolve({ ok: true });
    await saving;
    expect(shown()).toBe('Saved.');
    expect(notice().box.dataset.tone).toBe('success');
    vi.advanceTimersByTime(readingTimeMs('Saved.') + FADE_MS);
    expect(shown()).toBe('');
  });

  it('skips the Saved state for a form that closes on success', async () => {
    const { runDialogSave } = await loadMessages();
    const { button, form } = saveParts();

    const saved = await runDialogSave({ form, button, request: () => Promise.resolve({ ok: true }), confirm: false });

    expect(saved).toBe(true);
    expect(button.textContent).toBe('Save');
    expect(button.disabled).toBe(false);
    expect(findNotice()).toBeUndefined();
  });

  it('releases the form and names the failure when the request throws', async () => {
    const { runDialogSave } = await loadMessages();
    const { button, form } = saveParts();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const saved = await runDialogSave({ form, button, request: () => Promise.reject(new Error('boom')) });

    expect(saved).toBe(false);
    expect(form.inert).toBe(false);
    expect(button.textContent).toBe('Save');
    expect(shown()).toBe(FAILED_TEXT);
  });

  it('ends a Saved hold before a second save, so the label never sticks on Saved', async () => {
    const { runDialogSave } = await loadMessages();
    const { button, form } = saveParts();
    const ok = (): Promise<unknown> => Promise.resolve({ ok: true });

    await runDialogSave({ form, button, request: ok });
    vi.advanceTimersByTime(500);
    const second = runDialogSave({ form, button, request: ok });
    expect(button.textContent).toBe('Saving…');
    await second;
    vi.advanceTimersByTime(SAVED_HOLD_MS);

    expect(button.textContent).toBe('Save');
    expect(button.disabled).toBe(false);
  });

  it('gives focus back to the control the inert form took it from', async () => {
    const { runDialogSave } = await loadMessages();
    const { button, input, form } = saveParts();
    documentStub.activeElement = input;

    await runDialogSave({
      form,
      button,
      request: () => {
        documentStub.activeElement = documentStub.body;
        return Promise.resolve({ ok: false, error: 'Not allowed' });
      },
    });

    expect(input.focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});
