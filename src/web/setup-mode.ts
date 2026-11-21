/**
 * Navidrome MCP Server - Jukebox Remote setup mode Save handler
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { resolveConfigState } from '../config.js';
import { HostStartError, type SaveTakeover } from '../config-app/save-message.js';

type ConfigState = Awaited<ReturnType<typeof resolveConfigState>>;
export type ConfiguredState = Extract<ConfigState, { configured: true }>;

/** This process owns the port, stood down for another player at `url`, or stood down because its spawning MCP exited. */
export type PortAcquisition<Owner extends { url: string }> =
  | { mode: 'owner'; owner: Owner }
  | { mode: 'attached'; url: string }
  | { mode: 'mcp-exited' };

/** The player's own address and the launch key its start made. */
type StartedOwner = { url: string; auth: { launchKey: string } };

interface SetupSaveDeps<Owner extends StartedOwner> {
  resolveState: () => Promise<ConfigState>;
  /** Builds the runtime and binds the player port, or finds another player on it. */
  acquire: (state: ConfiguredState) => Promise<PortAcquisition<Owner>>;
  /** Runs once the player owns the port or another player does, so setup mode's own shutdown triggers stop. */
  leaveSetup: () => void;
  /** Runs the rest of the start after the Save reply, so it reports its own failure. */
  runOwner: (owner: Owner) => void;
}

const NO_USABLE_URL = 'settings.json has no usable Navidrome URL.';

const MCP_EXITED_DURING_SETUP =
  'The AI app that started this Jukebox Remote has closed. Run `navidrome-mcp jukebox` to start the Jukebox Remote.';

/**
 * The settings server runs it after each Save, one Save at a time, so a shortcut launch with no
 * settings starts the player without a relaunch. A rejection keeps setup mode with its reason.
 */
export function createSetupSaveHandler<Owner extends StartedOwner>(deps: SetupSaveDeps<Owner>): () => Promise<SaveTakeover> {
  return async (): Promise<SaveTakeover> => {
    const state = await deps.resolveState();
    if (!state.configured) throw new Error(state.failure?.reason ?? NO_USABLE_URL);
    const acquired = await deps.acquire(state);
    // No settings change brings the spawning MCP back, so the reply names only the relaunch.
    if (acquired.mode === 'mcp-exited') throw new HostStartError(MCP_EXITED_DURING_SETUP);
    deps.leaveSetup();
    if (acquired.mode === 'attached') return { mode: 'attached', url: acquired.url };
    deps.runOwner(acquired.owner);
    return { mode: 'started', url: acquired.owner.url, launchKey: acquired.owner.auth.launchKey };
  };
}
