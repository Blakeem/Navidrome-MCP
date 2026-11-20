/**
 * Navidrome MCP Server - Jukebox Remote fake notice document
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// The page module tests read the notice messages.js builds, so the notice's DOM shape is read in one place.

export interface Shown {
  text: string;
  tone: string | undefined;
}

interface NoticeNode {
  className: string;
  textContent: string;
  hidden: boolean;
  dataset: Record<string, string>;
  children: NoticeNode[];
  setAttribute: () => void;
  removeAttribute: () => void;
  addEventListener: () => void;
  append: (...nodes: NoticeNode[]) => void;
  appendChild: (node: NoticeNode) => void;
}

interface NoticeLike {
  className?: unknown;
  hidden?: unknown;
  dataset: Record<string, string>;
  children: readonly { textContent: string }[];
}

/** What the notice among `created` shows, read as what a user sees. */
export function readNotice(created: readonly NoticeLike[]): Shown {
  const box = created.find((el) => el.className === 'notice');
  if (box === undefined || box.hidden === true) return { text: '', tone: undefined };
  return { text: box.children[0]?.textContent ?? '', tone: box.dataset['tone'] };
}

function noticeNode(): NoticeNode {
  const el: NoticeNode = {
    className: '',
    textContent: '',
    hidden: false,
    dataset: {},
    children: [],
    setAttribute: () => undefined,
    removeAttribute: () => undefined,
    addEventListener: () => undefined,
    append: (...nodes) => { el.children.push(...nodes); },
    appendChild: (child) => { el.children.push(child); },
  };
  return el;
}

/** The document parts messages.js builds its notice from, and a reader of what the notice shows. */
export function noticeDocument(): {
  parts: { body: NoticeNode; createElement: () => NoticeNode; createElementNS: () => NoticeNode };
  shown: () => Shown;
} {
  const created: NoticeNode[] = [];
  const createElement = (): NoticeNode => {
    const el = noticeNode();
    created.push(el);
    return el;
  };
  return { parts: { body: noticeNode(), createElement, createElementNS: noticeNode }, shown: () => readNotice(created) };
}
