/**
 * Navidrome MCP Server - audio device tool tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';
import { createMockClient, type MockNavidromeClient } from '../../factories/mock-client.js';

const { describeAudioDevicesMock, selectAudioDeviceMock, enqueueRadioMock, saveAudioDeviceMock } = vi.hoisted(() => ({
  describeAudioDevicesMock: vi.fn(),
  selectAudioDeviceMock: vi.fn(),
  enqueueRadioMock: vi.fn(),
  saveAudioDeviceMock: vi.fn(),
}));

vi.mock('../../../src/services/playback/playback-engine.js', () => ({
  playbackEngine: {
    describeAudioDevices: describeAudioDevicesMock,
    selectAudioDevice: selectAudioDeviceMock,
    enqueueRadio: enqueueRadioMock,
  },
}));

vi.mock('../../../src/config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/config.js')>()),
  saveAudioDevice: saveAudioDeviceMock,
}));

const { listAudioDevices, setAudioDevice } = await import('../../../src/tools/playback.js');
const { playRadioStation } = await import('../../../src/tools/radio.js');

const AUTO = { id: 'auto', name: 'Autoselect device' };
const WASAPI_SPEAKERS = { id: 'wasapi/{speakers}', name: 'Speakers (Realtek)' };
const WASAPI_KATANA = { id: 'wasapi/{katana}', name: 'Speakers (Katana)' };
const OPENAL_SPEAKERS = { id: 'openal/Speakers (Realtek)', name: 'Speakers (Realtek)' };
const ALL_DEVICES = [AUTO, OPENAL_SPEAKERS, WASAPI_SPEAKERS, WASAPI_KATANA];

function report(overrides: { selectedId?: string; output?: string | null; source?: 'player' | 'probe' } = {}) {
  return {
    selected: { id: overrides.selectedId ?? 'auto', name: null, connected: true },
    output: overrides.output ?? null,
    devices: ALL_DEVICES,
    source: overrides.source ?? 'probe',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  describeAudioDevicesMock.mockResolvedValue(report());
  selectAudioDeviceMock.mockResolvedValue(true);
  saveAudioDeviceMock.mockReturnValue(true);
});

describe('list_audio_devices', () => {
  it("narrows to the open output's driver", async () => {
    describeAudioDevicesMock.mockResolvedValueOnce(report({ output: 'wasapi', source: 'player' }));

    const result = await listAudioDevices({});

    expect(result).toEqual({
      selected: { id: 'auto', name: null, connected: true },
      output: 'wasapi',
      devices: [AUTO, WASAPI_SPEAKERS, WASAPI_KATANA],
      source: 'player',
    });
  });

  it("narrows to the selected device's driver and omits output when no output is open", async () => {
    describeAudioDevicesMock.mockResolvedValueOnce(report({ selectedId: WASAPI_KATANA.id }));

    const result = await listAudioDevices({});

    expect(result.devices).toEqual([AUTO, WASAPI_SPEAKERS, WASAPI_KATANA]);
    expect(result).not.toHaveProperty('output');
  });

  it("ignores mpv's null output and falls back to the selected device's driver", async () => {
    describeAudioDevicesMock.mockResolvedValueOnce(report({ selectedId: WASAPI_KATANA.id, output: 'null', source: 'player' }));

    const result = await listAudioDevices({});

    expect(result.devices).toEqual([AUTO, WASAPI_SPEAKERS, WASAPI_KATANA]);
    expect(result.output).toBe('null');
  });

  it('returns every driver with verbose: true', async () => {
    describeAudioDevicesMock.mockResolvedValueOnce(report({ output: 'wasapi', source: 'player' }));

    const result = await listAudioDevices({ verbose: true });

    expect(result.devices).toEqual(ALL_DEVICES);
  });
});

describe('set_audio_device', () => {
  it('rejects an empty id before reading devices', async () => {
    await expect(setAudioDevice({ id: '   ' })).rejects.toThrow(/^Tool 'set_audio_device' failed/);
    expect(describeAudioDevicesMock).not.toHaveBeenCalled();
  });

  it('rejects an unknown argument like the other playback tools', async () => {
    await expect(setAudioDevice({ id: 'auto', device: 'auto' })).rejects.toThrow(/^Tool 'set_audio_device' failed/);
    await expect(listAudioDevices({ verbos: true })).rejects.toThrow(/^Tool 'list_audio_devices' failed/);
    expect(describeAudioDevicesMock).not.toHaveBeenCalled();
  });

  it('rejects an unknown id with the one-driver choices and never selects it', async () => {
    describeAudioDevicesMock.mockResolvedValueOnce(report({ output: 'wasapi', source: 'player' }));

    await expect(setAudioDevice({ id: 'wasapi/{gone}' })).rejects.toThrow(
      "Unknown audio device id 'wasapi/{gone}'. Valid ids: auto (Autoselect device), wasapi/{speakers} (Speakers (Realtek)), wasapi/{katana} (Speakers (Katana)).",
    );
    expect(selectAudioDeviceMock).not.toHaveBeenCalled();
    expect(saveAudioDeviceMock).not.toHaveBeenCalled();
  });

  it('accepts a device from another driver than the one listed by default', async () => {
    describeAudioDevicesMock.mockResolvedValueOnce(report({ output: 'wasapi', source: 'player' }));

    const result = await setAudioDevice({ id: OPENAL_SPEAKERS.id });

    expect(selectAudioDeviceMock).toHaveBeenCalledWith(OPENAL_SPEAKERS.id);
    expect(result).toEqual({ success: true, device: OPENAL_SPEAKERS, applied: 'now', persisted: true });
  });

  it('switches a running mpv now and saves the device with its name', async () => {
    const result = await setAudioDevice({ id: WASAPI_KATANA.id });

    expect(saveAudioDeviceMock).toHaveBeenCalledWith(WASAPI_KATANA);
    expect(result).toEqual({ success: true, device: WASAPI_KATANA, applied: 'now', persisted: true });
  });

  it('saves auto as null and names it the system default', async () => {
    const result = await setAudioDevice({ id: 'auto' });

    expect(selectAudioDeviceMock).toHaveBeenCalledWith('auto');
    expect(saveAudioDeviceMock).toHaveBeenCalledWith(null);
    expect(result).toEqual({ success: true, device: { id: 'auto', name: 'System default' }, applied: 'now', persisted: true });
  });

  it('reports next-start when no mpv runs and the choice was saved', async () => {
    selectAudioDeviceMock.mockResolvedValueOnce(false);

    const result = await setAudioDevice({ id: WASAPI_KATANA.id });

    expect(result).toEqual({ success: true, device: WASAPI_KATANA, applied: 'next-start', persisted: true });
  });

  it('reports now with persisted false when mpv switched but no store saved it', async () => {
    saveAudioDeviceMock.mockReturnValueOnce(false);

    const result = await setAudioDevice({ id: WASAPI_KATANA.id });

    expect(result).toEqual({ success: true, device: WASAPI_KATANA, applied: 'now', persisted: false });
  });

  it('fails when nothing applied the choice and nothing saved it', async () => {
    selectAudioDeviceMock.mockResolvedValueOnce(false);
    saveAudioDeviceMock.mockReturnValueOnce(false);

    const result = await setAudioDevice({ id: WASAPI_KATANA.id });

    expect(result.success).toBe(false);
    expect(result).toHaveProperty('message', expect.stringMatching(/No mpv is running.*PLAYBACK_AUDIO_DEVICE/));
  });
});

describe('play_radio_station audio output reporting', () => {
  let client: MockNavidromeClient;

  beforeEach(() => {
    client = createMockClient();
    client.request.mockResolvedValue([
      { id: 'st-1', name: 'WBEZ', streamUrl: 'http://wbez.test/', homePageUrl: '', createdAt: '', updatedAt: '' },
    ]);
  });

  it('keeps success and adds paused and the message when the output is missing', async () => {
    enqueueRadioMock.mockResolvedValueOnce({ outputMissing: { id: 'auto', name: null } });

    const result = await playRadioStation(client as unknown as NavidromeClient, { stationId: 'st-1' });

    expect(result).toEqual({
      success: true,
      station: { name: 'WBEZ', streamUrl: 'http://wbez.test/' },
      paused: true,
      message: 'No audio output device is available. Connect one, then call resume.',
      code: 'output-missing',
    });
  });

  it('returns the unchanged result when the output is connected', async () => {
    enqueueRadioMock.mockResolvedValueOnce({ outputMissing: null });

    const result = await playRadioStation(client as unknown as NavidromeClient, { stationId: 'st-1' });

    expect(result).toEqual({ success: true, station: { name: 'WBEZ', streamUrl: 'http://wbez.test/' } });
  });
});
