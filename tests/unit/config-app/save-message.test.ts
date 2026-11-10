/**
 * Navidrome MCP Server - Settings save message tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import { firstSaveSteps, laterSaveMessage } from '../../../src/config-app/save-message.js';
import type { SettingsFile } from '../../../src/config/store.js';
import { makeTestConfig } from '../../helpers/test-config.js';

const SAVED_TO = 'Settings saved to /tmp/settings.json.';
const MCP_RESTART = 'The MCP server applies these changes after it restarts. A stdio server restarts with its MCP client.';
const PLAYER_RESTART =
  "The Jukebox Remote applies these changes after Shut down player in the player's gear menu and a new start. " +
  'A new start is the next play from the AI, a restart of the MCP client, or `navidrome-mcp jukebox`.';
const ADMIN_PASSWORD_LINE = 'A new admin password applies to a running player within about 10 seconds and signs out every admin session.';

const STORED: SettingsFile = {
  navidrome: { url: 'http://h:4533', username: 'u', password: 'secret' },
  transport: { type: 'stdio' },
  library: { defaultLibraryIds: [1] },
  features: { radio: true, lyrics: false },
  playback: { transcodeFormat: 'mp3' },
  webui: { enabled: true, port: 8808, auth: { mode: 'password', adminPasswordHash: 'stored-hash' } },
  jukebox: { guestQueueLimit: 3 },
  advanced: { debug: false },
};

const BOTH = `${SAVED_TO} ${MCP_RESTART} ${PLAYER_RESTART}`;

function messageFor(stored: SettingsFile, saved: SettingsFile, adminPasswordChanged = false): string {
  return laterSaveMessage(SAVED_TO, { storedFile: stored, storedSettings: stored, saved, adminPasswordChanged, clearedStoreNotice: false });
}

describe('laterSaveMessage', () => {
  it.each<[string, SettingsFile, string]>([
    ['navidrome', { navidrome: { ...STORED.navidrome, url: 'http://other:4533' } }, BOTH],
    ['library', { library: { defaultLibraryIds: [2] } }, BOTH],
    ['features', { features: { radio: false, lyrics: false } }, BOTH],
    ['playback', { playback: { transcodeFormat: 'opus' } }, BOTH],
    ['advanced', { advanced: { debug: true } }, BOTH],
    ['transport', { transport: { type: 'http' } }, `${SAVED_TO} ${MCP_RESTART}`],
    ['webui.port', { webui: { ...STORED.webui, port: 9000 } }, `${SAVED_TO} ${PLAYER_RESTART}`],
    ['jukebox', { jukebox: { guestQueueLimit: 5 } }, `${SAVED_TO} ${PLAYER_RESTART}`],
    ['webui.enabled', { webui: { ...STORED.webui, enabled: false } }, BOTH],
  ])('names the restarts a %s change needs', (_section, change, expected) => {
    expect(messageFor(STORED, { ...STORED, ...change })).toBe(expected);
  });

  it('says there is nothing to save when no value changed', () => {
    expect(messageFor(STORED, structuredClone(STORED))).toBe('No changes to save.');
  });

  it('reports the write and names no restart when the save only cleared a store notice, such as a quoted number', () => {
    const message = laterSaveMessage(SAVED_TO, { storedFile: STORED, storedSettings: STORED, saved: STORED, adminPasswordChanged: false, clearedStoreNotice: true });

    expect(message).toBe(SAVED_TO);
  });

  it('reports the write and names no restart when the save only pruned an empty stored value', () => {
    const withEmpty: SettingsFile = { ...STORED, features: { ...STORED.features, lastFmApiKey: '' }, playback: { ...STORED.playback, mpvPath: null } };

    expect(messageFor(withEmpty, STORED)).toBe(SAVED_TO);
  });

  it('reports the write and names no restart when the save only normalized a stored value', () => {
    const legacyTheme = { ...STORED, webui: { ...STORED.webui, theme: 'system' } } as SettingsFile;

    const message = laterSaveMessage(SAVED_TO, { storedFile: legacyTheme, storedSettings: STORED, saved: STORED, adminPasswordChanged: false, clearedStoreNotice: false });

    expect(message).toBe(SAVED_TO);
  });

  it('leaves out the restart that the next steps already name', () => {
    const saved: SettingsFile = { ...STORED, navidrome: { ...STORED.navidrome, password: 'new' } };

    const message = laterSaveMessage(SAVED_TO, { storedFile: STORED, storedSettings: STORED, saved, adminPasswordChanged: false, clearedStoreNotice: false }, 'mcp');

    expect(message).toBe(`${SAVED_TO} ${PLAYER_RESTART}`);
  });

  it('names only the live-apply lines for a new admin password hash', () => {
    const saved: SettingsFile = { ...STORED, webui: { ...STORED.webui, auth: { mode: 'password', adminPasswordHash: 'new-hash' } } };

    const message = messageFor(STORED, saved, true);

    expect(message).toContain(ADMIN_PASSWORD_LINE);
    expect(message).not.toContain(MCP_RESTART);
    expect(message).not.toContain(PLAYER_RESTART);
  });

  it('names the player restart and the admin password lines for a new password with a new Access', () => {
    const saved: SettingsFile = { ...STORED, webui: { ...STORED.webui, auth: { mode: 'jukebox', adminPasswordHash: 'new-hash' } } };

    const message = messageFor(STORED, saved, true);

    expect(message.startsWith(`${SAVED_TO} ${PLAYER_RESTART} ${ADMIN_PASSWORD_LINE}`)).toBe(true);
  });

  it('names no restart for a change only to a key no process reads', () => {
    expect(messageFor(STORED, { ...STORED, notes: 'kept by hand' })).toBe(SAVED_TO);
  });
});

describe('firstSaveSteps', () => {
  const webui = makeTestConfig().webui;

  it('asks for an AI app restart and links the saved port and scheme', () => {
    const steps = firstSaveSteps('mcp-setup', { ...webui, port: 9911, tls: { certPath: '/c.pem', keyPath: '/k.pem' } }, null);

    expect(steps).toEqual([
      { text: 'Quit your AI app fully and open it again.' },
      { text: 'The Jukebox Remote runs after your AI app restarts. It needs mpv. Open it at', url: 'https://127.0.0.1:9911/admin' },
    ]);
  });

  it('says the Jukebox Remote is starting when its setup mode started it, and that the page closes', () => {
    expect(firstSaveSteps('jukebox-setup', webui, { mode: 'started', url: 'http://127.0.0.1:8808' })).toEqual([
      { text: 'The Jukebox Remote is starting.' },
      { text: 'It needs mpv to play music. Open it at', url: 'http://127.0.0.1:8808/admin' },
      { text: "This page closes now. To change settings later, use All settings in the player's gear menu." },
    ]);
  });

  it('links the running player at its own scheme when setup mode found another player on the port', () => {
    expect(firstSaveSteps('jukebox-setup', webui, { mode: 'attached', url: 'https://127.0.0.1:8808' })).toEqual([
      { text: 'A Jukebox Remote already runs on this port. It did not read these settings.' },
      { text: PLAYER_RESTART },
      { text: 'Open it at', url: 'https://127.0.0.1:8808/admin' },
      { text: "This page closes now. To change settings later, use All settings in the player's gear menu." },
    ]);
  });

  it('adds the player restart on the page a running player serves', () => {
    expect(firstSaveSteps('jukebox-settings', { ...webui, enabled: false }, null)).toEqual([
      { text: 'Quit your AI app fully and open it again.' },
      { text: PLAYER_RESTART },
      { text: 'Open it again at', url: 'http://127.0.0.1:8808/admin' },
    ]);
  });

  it('leaves out the address when the MCP server will not start the Jukebox Remote', () => {
    expect(firstSaveSteps('settings-command', { ...webui, enabled: false }, null)).toEqual([{ text: 'Quit your AI app fully and open it again.' }]);
  });

  it('keeps the address for a direct launch, which ignores webui.enabled', () => {
    expect(firstSaveSteps('jukebox-setup', { ...webui, enabled: false }, { mode: 'started', url: 'http://127.0.0.1:8808' })[1]?.url).toBe('http://127.0.0.1:8808/admin');
  });
});
