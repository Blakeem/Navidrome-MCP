/**
 * Navidrome MCP Server - Player runtime state
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Live player flags, kept out of main.ts so the lifecycle rule is unit-testable without a server or
 * mpv. main.ts seeds each flag from config, and the admin dialogs change it at runtime.
 */

import { DEFAULT_GUEST_QUEUE_LIMIT, DEFAULT_JUKEBOX_SHARE_LINK, type JukeboxShareLink, type WebuiTheme } from '../constants/defaults.js';

let persist = false;
let theme: WebuiTheme | null = null;
let visualizer = true;
let guestQueueLimit = DEFAULT_GUEST_QUEUE_LIMIT;
let jukeboxShareLink: JukeboxShareLink = DEFAULT_JUKEBOX_SHARE_LINK;

export function setGuestQueueLimit(value: number): void {
  guestQueueLimit = value;
}

export function getGuestQueueLimit(): number {
  return guestQueueLimit;
}

export function setJukeboxShareLink(value: JukeboxShareLink): void {
  jukeboxShareLink = value;
}

export function getJukeboxShareLink(): JukeboxShareLink {
  return jukeboxShareLink;
}

export function setPersist(value: boolean): void {
  persist = value;
}

export function getPersist(): boolean {
  return persist;
}

export function setTheme(value: WebuiTheme | null): void {
  theme = value;
}

export function getTheme(): WebuiTheme | null {
  return theme;
}

export function setVisualizer(value: boolean): void {
  visualizer = value;
}

export function getVisualizer(): boolean {
  return visualizer;
}

export function shouldStopForMcpExit(state: {
  launchedByMcp: boolean;
  parentConnected: boolean;
  openLeases: number;
  persist: boolean;
}): boolean {
  return state.launchedByMcp && !state.parentConnected && state.openLeases === 0 && !state.persist;
}
