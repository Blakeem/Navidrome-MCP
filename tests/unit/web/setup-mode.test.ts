/**
 * Navidrome MCP Server - Jukebox Remote setup mode Save handler tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it, vi } from 'vitest';
import type { StartupFailure } from '../../../src/config.js';
import { HostStartError } from '../../../src/config-app/save-message.js';
import { createSetupSaveHandler, type ConfiguredState, type PortAcquisition } from '../../../src/web/setup-mode.js';
import { makeTestConfig } from '../../helpers/test-config.js';

interface FakeOwner {
  url: string;
  auth: { launchKey: string };
}

const CONFIGURED: ConfiguredState = { configured: true, config: makeTestConfig(), source: 'store' };
const OWNER: FakeOwner = { url: 'http://127.0.0.1:8808', auth: { launchKey: 'k'.repeat(43) } };

type ConfigState = ConfiguredState | { configured: false; failure?: StartupFailure };

function handlerFor(
  acquire: (state: ConfiguredState) => Promise<PortAcquisition<FakeOwner>>,
  resolveState: () => Promise<ConfigState> = () => Promise.resolve(CONFIGURED),
) {
  const leaveSetup = vi.fn();
  const runOwner = vi.fn();
  const onSaved = createSetupSaveHandler<FakeOwner>({ resolveState, acquire, leaveSetup, runOwner });
  return { onSaved, leaveSetup, runOwner };
}

describe('createSetupSaveHandler', () => {
  it('leaves setup mode and runs the owner when the player binds the port', async () => {
    const acquire = vi.fn(() => Promise.resolve<PortAcquisition<FakeOwner>>({ mode: 'owner', owner: OWNER }));
    const { onSaved, leaveSetup, runOwner } = handlerFor(acquire);

    await expect(onSaved()).resolves.toEqual({ mode: 'started', url: 'http://127.0.0.1:8808', launchKey: OWNER.auth.launchKey });

    expect(acquire).toHaveBeenCalledExactlyOnceWith(CONFIGURED);
    expect(leaveSetup).toHaveBeenCalledOnce();
    expect(runOwner).toHaveBeenCalledExactlyOnceWith(OWNER);
  });

  it('leaves setup mode with the running player\'s own address when another player holds the port', async () => {
    const { onSaved, leaveSetup, runOwner } = handlerFor(() => Promise.resolve({ mode: 'attached', url: 'https://127.0.0.1:8808' }));

    await expect(onSaved()).resolves.toEqual({ mode: 'attached', url: 'https://127.0.0.1:8808' });

    expect(leaveSetup).toHaveBeenCalledOnce();
    expect(runOwner).not.toHaveBeenCalled();
  });

  it('stays in setup mode and names the relaunch when the spawning MCP exited', async () => {
    const { onSaved, leaveSetup, runOwner } = handlerFor(() => Promise.resolve({ mode: 'mcp-exited' }));

    const failure = onSaved();

    await expect(failure).rejects.toBeInstanceOf(HostStartError);
    await expect(failure).rejects.toThrow('Run `navidrome-mcp jukebox` to start the Jukebox Remote.');
    expect(leaveSetup).not.toHaveBeenCalled();
    expect(runOwner).not.toHaveBeenCalled();
  });

  it('keeps setup mode with the failure reason when the saved settings stay unusable', async () => {
    const acquire = vi.fn();
    const { onSaved, leaveSetup } = handlerFor(acquire, () =>
      Promise.resolve({ configured: false, failure: { reason: 'navidrome.url: Invalid URL', unreachable: false, source: 'store' } }),
    );

    await expect(onSaved()).rejects.toThrow('navidrome.url: Invalid URL');
    expect(acquire).not.toHaveBeenCalled();
    expect(leaveSetup).not.toHaveBeenCalled();
  });

  it('names the missing URL when the state is a first run', async () => {
    const { onSaved } = handlerFor(vi.fn(), () => Promise.resolve({ configured: false }));

    await expect(onSaved()).rejects.toThrow('settings.json has no usable Navidrome URL.');
  });

  it('rejects with a start failure without leaving setup mode, and the next Save starts again', async () => {
    const acquire = vi.fn<(state: ConfiguredState) => Promise<PortAcquisition<FakeOwner>>>()
      .mockRejectedValueOnce(new Error('Authentication failed: 401 Unauthorized'))
      .mockResolvedValueOnce({ mode: 'owner', owner: OWNER });
    const { onSaved, leaveSetup } = handlerFor(acquire);

    await expect(onSaved()).rejects.toThrow('Authentication failed: 401 Unauthorized');
    expect(leaveSetup).not.toHaveBeenCalled();
    await expect(onSaved()).resolves.toEqual({ mode: 'started', url: OWNER.url, launchKey: OWNER.auth.launchKey });

    expect(acquire).toHaveBeenCalledTimes(2);
  });
});
