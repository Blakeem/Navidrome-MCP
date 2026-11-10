/**
 * Navidrome MCP Server - Settings save messages
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { isDeepStrictEqual } from 'node:util';
import type { Config } from '../config.js';
import { pruneEmptyValues } from '../config/settings-file-checks.js';
import { SettingsFileSchema, type SettingsFile } from '../config/store.js';
import { loopbackUrl } from '../webui/network.js';
import { adminPageUrl } from '../webui/page-paths.js';
import { isTlsEnabled } from '../webui/tls.js';

/** The process that serves the settings page, which decides the first Save's next step. */
export type SettingsPageHost = 'mcp-setup' | 'jukebox-setup' | 'jukebox-settings' | 'settings-command';

/**
 * How a host that waits on a Save took over: it owns the player port, or another player already does.
 * The url is the player's base address, which for another player can differ from the saved scheme.
 */
export interface SaveTakeover {
  mode: 'started' | 'attached';
  url: string;
}

/** A host start failure that no settings change fixes, so the page shows its message as the remedy. */
export class HostStartError extends Error {}

interface NextStep {
  text: string;
  /** The page shows it as a link after the text. */
  url?: string;
}

type Restart = 'mcp' | 'player';
type Section = keyof typeof SettingsFileSchema.shape;

// The player's main() also runs createRuntime and reads advanced.debug, so the first five sections restart both processes.
const RESTARTS_BY_SECTION: Readonly<Record<Section, readonly Restart[]>> = {
  navidrome: ['mcp', 'player'],
  library: ['mcp', 'player'],
  features: ['mcp', 'player'],
  playback: ['mcp', 'player'],
  advanced: ['mcp', 'player'],
  transport: ['mcp'],
  webui: ['player'],
  jukebox: ['player'],
};

const RESTART_LINES: Readonly<Record<Restart, string>> = {
  mcp: 'The MCP server applies these changes after it restarts. A stdio server restarts with its MCP client.',
  player:
    "The Jukebox Remote applies these changes after Shut down player in the player's gear menu and a new start. " +
    'A new start is the next play from the AI, a restart of the MCP client, or `navidrome-mcp jukebox`.',
};

const ADMIN_PASSWORD_RULES = [
  'A new admin password applies to a running player within about 10 seconds and signs out every admin session.',
  'This holds when the player runs from settings.json and Access already uses a password.',
  'A change of Access, or a player started from environment variables, needs a restart.',
] as const;

const NO_CHANGES_MESSAGE = 'No changes to save.';

export interface SaveChange {
  /** settings.json as read before this save. */
  storedFile: SettingsFile;
  /** storedFile with the normalizations the save applies, which the runtime already reads the same way. */
  storedSettings: SettingsFile;
  saved: SettingsFile;
  adminPasswordChanged: boolean;
  /** True when the save cleared a store notice, such as a quoted number the store read as a number. */
  clearedStoreNotice: boolean;
}

/**
 * Names only the restarts the changed sections need, leaving out one that the next steps already
 * name. writeSettings prunes empty values, and the runtime reads an empty value as an absent one.
 */
export function laterSaveMessage(savedTo: string, change: SaveChange, namedInNextSteps: Restart | null = null): string {
  const { storedFile, storedSettings, saved, adminPasswordChanged, clearedStoreNotice } = change;
  // storedFile holds coerced values, so only the cleared notice shows that a save fixed a hand-edit slip.
  // A save that dropped an empty value differs from storedFile, so it reports the write too.
  if (!clearedStoreNotice && isDeepStrictEqual(storedFile, pruned(saved))) return NO_CHANGES_MESSAGE;
  const restarts = restartsFor(pruned(withoutAdminHash(storedSettings)), pruned(withoutAdminHash(saved)));
  const lines = (['mcp', 'player'] as const)
    .filter((restart) => restarts.has(restart) && restart !== namedInNextSteps)
    .map((restart) => RESTART_LINES[restart]);
  return [savedTo, ...lines, ...(adminPasswordChanged ? ADMIN_PASSWORD_RULES : [])].join(' ');
}

function restartsFor(before: SettingsFile, after: SettingsFile): Set<Restart> {
  const restarts = new Set<Restart>();
  for (const [section, needed] of Object.entries(RESTARTS_BY_SECTION)) {
    if (isDeepStrictEqual(before[section], after[section])) continue;
    for (const restart of needed) restarts.add(restart);
  }
  // The MCP server reads webui.enabled at startup to decide whether it starts the player.
  if (before.webui?.enabled !== after.webui?.enabled) restarts.add('mcp');
  return restarts;
}

/** A new admin password has its own live-apply lines, so its hash alone names no restart. */
function withoutAdminHash(settings: SettingsFile): SettingsFile {
  const auth = settings.webui?.auth;
  if (auth === undefined || auth === null) return settings;
  return { ...settings, webui: { ...settings.webui, auth: { ...auth, adminPasswordHash: undefined } } };
}

function pruned(settings: SettingsFile): SettingsFile {
  return pruneEmptyValues(SettingsFileSchema, settings) as SettingsFile;
}

const PAGE_CLOSED_STEP: NextStep = {
  text: "This page closes now. To change settings later, use All settings in the player's gear menu.",
};

/**
 * Replaces every restart line after a Save over a store that gave no usable config or a Save a host took over.
 * In MCP setup mode over a usable store it replaces only the MCP restart line, since a running player may have read that store.
 * A host that took over gives the player's address. Otherwise the address comes from the saved port and TLS paths, not the defaults.
 */
export function firstSaveSteps(host: SettingsPageHost, webui: Config['webui'], takeover: SaveTakeover | null): NextStep[] {
  const url = adminPageUrl(takeover?.url ?? loopbackUrl(webui.port, isTlsEnabled(webui.tls)));
  if (takeover?.mode === 'started') {
    return [{ text: 'The Jukebox Remote is starting.' }, { text: 'It needs mpv to play music. Open it at', url }, PAGE_CLOSED_STEP];
  }
  if (takeover?.mode === 'attached') {
    return [
      { text: 'A Jukebox Remote already runs on this port. It did not read these settings.' },
      { text: RESTART_LINES.player },
      { text: 'Open it at', url },
      PAGE_CLOSED_STEP,
    ];
  }
  const restartAiApp: NextStep = { text: 'Quit your AI app fully and open it again.' };
  // A player that serves this page over a store with no usable config runs from environment variables, and an AI app restart may not stop it.
  if (host === 'jukebox-settings') return [restartAiApp, { text: RESTART_LINES.player }, { text: 'Open it again at', url }];
  // The MCP server starts the player only when webui.enabled is on.
  if (!webui.enabled) return [restartAiApp];
  return [restartAiApp, { text: 'The Jukebox Remote runs after your AI app restarts. It needs mpv. Open it at', url }];
}
