/**
 * Navidrome MCP Server - settings.json hand-edit checks test
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import { coerceSlips, findUnknownKeys, pruneEmptyValues, salvageValidLeaves } from '../../../src/config/settings-file-checks.js';
import { SettingsFileSchema } from '../../../src/config/store.js';

describe('coerceSlips', () => {
  it('reads a quoted number as a number and names the key', () => {
    const { value, notices } = coerceSlips(SettingsFileSchema, { webui: { port: '8808' } });

    expect(value).toEqual({ webui: { port: 8808 } });
    expect(notices).toEqual([
      'webui.port holds the text "8808", so it is read as the number 8808. Remove the quotes to fix the file.',
    ]);
  });

  it('reads a quoted true or false as a boolean and names the key', () => {
    const { value, notices } = coerceSlips(SettingsFileSchema, { webui: { enabled: 'true', expose: 'false' } });

    expect(value).toEqual({ webui: { enabled: true, expose: false } });
    expect(notices).toEqual([
      'webui.enabled holds the text "true", so it is read as true. Remove the quotes to fix the file.',
      'webui.expose holds the text "false", so it is read as false. Remove the quotes to fix the file.',
    ]);
  });

  it('reads a numeric transcode bitrate as text and names the key', () => {
    const { value, notices } = coerceSlips(SettingsFileSchema, { playback: { transcodeBitrate: 192 } });

    expect(value).toEqual({ playback: { transcodeBitrate: '192' } });
    expect(notices).toEqual([
      'playback.transcodeBitrate holds the number 192, so it is read as the text "192". Put the value in quotes to fix the file.',
    ]);
  });

  it('reads each quoted library ID in a list as a number', () => {
    const { value, notices } = coerceSlips(SettingsFileSchema, { library: { defaultLibraryIds: ['1', 2] } });

    expect(value).toEqual({ library: { defaultLibraryIds: [1, 2] } });
    expect(notices).toHaveLength(1);
  });

  it.each([
    ['text that is no number', { webui: { port: 'abc' } }],
    ['a boolean in another case', { webui: { enabled: 'True' } }],
    ['a number in a text setting other than the bitrate', { webui: { publicUrl: 8808 } }],
  ])('leaves %s unchanged', (_label, input) => {
    expect(coerceSlips(SettingsFileSchema, input)).toEqual({ value: input, notices: [] });
  });

  it('never coerces a web remote auth value or the MCP auth token', () => {
    const input = {
      webui: { auth: { askPasswordOnThisComputer: 'true', adminPasswordHash: 5 } },
      transport: { authToken: 12345 },
    };

    expect(coerceSlips(SettingsFileSchema, input)).toEqual({ value: input, notices: [] });
  });

  it('leaves a value the schema already accepts and an unknown key untouched', () => {
    const input = { webui: { port: 8808, prot: '1' }, extra: 'x' };

    expect(coerceSlips(SettingsFileSchema, input)).toEqual({ value: input, notices: [] });
  });

  it('returns a root that is not an object as it is', () => {
    expect(coerceSlips(SettingsFileSchema, [1])).toEqual({ value: [1], notices: [] });
  });
});

describe('findUnknownKeys', () => {
  it('names an unknown key with the nearest known sibling', () => {
    expect(findUnknownKeys(SettingsFileSchema, { webui: { prot: 1 } })).toEqual([
      'webui.prot is not a setting this version knows. Did you mean webui.port?',
    ]);
  });

  it('names an unknown top-level key, and a nested one inside the auth block', () => {
    expect(findUnknownKeys(SettingsFileSchema, { navidrom: {}, webui: { auth: { mdoe: 'none' } } })).toEqual([
      'navidrom is not a setting this version knows. Did you mean navidrome?',
      'webui.auth.mdoe is not a setting this version knows. Did you mean webui.auth.mode?',
    ]);
  });

  it('offers no suggestion when no known key is within two edits', () => {
    expect(findUnknownKeys(SettingsFileSchema, { webui: { colour: 'red' } })).toEqual([
      'webui.colour is not a setting this version knows.',
    ]);
  });

  it('skips the share link contents and names an inherited name as unknown', () => {
    const input = {
      jukebox: { shareLink: { anything: 1 } },
      transport: JSON.parse('{"constructor": 1}') as unknown,
    };

    expect(findUnknownKeys(SettingsFileSchema, input)).toEqual([
      'transport.constructor is not a setting this version knows.',
    ]);
  });

  it('tells a hand-written plain-text admin password to move to the settings page', () => {
    expect(findUnknownKeys(SettingsFileSchema, { webui: { auth: { adminPassword: 'hunter2hunter2' } } })).toEqual([
      'webui.auth.adminPassword is not read from settings.json. Set the admin password on the settings page, then delete this key, since it holds the password as plain text.',
    ]);
  });
});

describe('salvageValidLeaves', () => {
  it('keeps each value that passes its own schema and each unknown key, and drops the rest', () => {
    const input = {
      navidrome: { url: 'http://h:4533', username: 7 },
      webui: { port: 'abc', expose: true, newFeature: 'on', auth: { mode: 'pasword', adminPasswordHash: '$argon2id$x' } },
      extra: 1,
    };

    expect(salvageValidLeaves(SettingsFileSchema, input)).toEqual({
      navidrome: { url: 'http://h:4533' },
      webui: { expose: true, newFeature: 'on', auth: { adminPasswordHash: '$argon2id$x' } },
      extra: 1,
    });
  });

  it('drops a __proto__ key instead of replacing the prototype', () => {
    const salvaged = salvageValidLeaves(SettingsFileSchema, JSON.parse('{"__proto__": {"polluted": true}, "extra": 1}'));

    expect(Object.getPrototypeOf(salvaged)).toBe(Object.prototype);
    expect(Object.keys(salvaged)).toEqual(['extra']);
  });

  it('drops an object that fails once its bad fields are gone', () => {
    expect(salvageValidLeaves(SettingsFileSchema, { playback: { audioDevice: { id: 5, name: 'x' } } })).toEqual({
      playback: {},
    });
  });

  it('keeps a null where the schema allows one', () => {
    expect(salvageValidLeaves(SettingsFileSchema, { webui: { tls: null } })).toEqual({ webui: { tls: null } });
  });

  it('returns an empty object for a root that is not an object', () => {
    expect(salvageValidLeaves(SettingsFileSchema, 'text')).toEqual({});
  });
});

describe('pruneEmptyValues', () => {
  it('drops null, blank text and empty lists, and each object they leave empty', () => {
    expect(pruneEmptyValues(SettingsFileSchema, {
      navidrome: { url: 'http://h:4533', password: '' },
      transport: { host: null, allowedHosts: [], authToken: '' },
      features: { lastFmApiKey: null, radio: false },
      webui: { tls: { certPath: null, keyPath: null }, auth: { adminPasswordHash: null } },
      playback: { audioDevice: null },
    })).toEqual({
      navidrome: { url: 'http://h:4533' },
      features: { radio: false },
    });
  });

  it('keeps each default-equal value, false and 0', () => {
    const settings = { webui: { port: 8808, expose: false }, jukebox: { guestQueueLimit: 0 }, library: { defaultLibraryIds: [1] } };

    expect(pruneEmptyValues(SettingsFileSchema, settings)).toEqual(settings);
  });

  it('keeps every unknown key, empty or not, at any depth', () => {
    const settings = { handAdded: null, webui: { note: '', future: {} }, newSection: { list: [] } };

    expect(pruneEmptyValues(SettingsFileSchema, settings)).toEqual(settings);
  });

  it('keeps a blank value the schema requires, so the file still parses', () => {
    const settings = { playback: { audioDevice: { id: '', name: null } } };

    const pruned = pruneEmptyValues(SettingsFileSchema, settings);

    expect(pruned).toEqual({ playback: { audioDevice: { id: '' } } });
    expect(SettingsFileSchema.safeParse(pruned).success).toBe(true);
  });

  it('keeps whitespace-only text, which is not empty', () => {
    expect(pruneEmptyValues(SettingsFileSchema, { navidrome: { username: ' ' } })).toEqual({ navidrome: { username: ' ' } });
  });

  it('never assigns a __proto__ key', () => {
    const pruned = pruneEmptyValues(SettingsFileSchema, JSON.parse('{"__proto__": {"polluted": true}, "extra": 1}') as Record<string, unknown>);

    expect(Object.getPrototypeOf(pruned)).toBe(Object.prototype);
    expect(Object.keys(pruned)).toEqual(['extra']);
  });
});
