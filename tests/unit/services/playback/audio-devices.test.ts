import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MPV_AUDIO_DEVICE_PROBE_TIMEOUT_MS } from '../../../../src/constants/timeouts.js';
import type { MpvRun } from '../../../../src/services/playback/mpv-run.js';

const runMpvMock = vi.hoisted(() => vi.fn());
vi.mock('../../../../src/services/playback/mpv-run.js', () => ({ runMpv: runMpvMock }));

import {
  audioDeviceDriver,
  findReplacementDevice,
  filterToOneDriver,
  parseAudioDeviceHelp,
  parseAudioDeviceList,
  probeAudioDevices,
  resolveSavedDevice,
  type AudioDevice,
} from '../../../../src/services/playback/audio-devices.js';

const WINDOWS_HELP_LINES = [
  'List of detected audio devices:',
  "  'auto' (Autoselect device)",
  "  'wasapi/{2d948da5-7f24-4c77-8553-5c67cb36d700}' (Speakers (Sound BlasterX Katana))",
  "  'wasapi/{d5ce34f8-c4b7-47c0-8009-5922029a8ccb}' (Gigabyte M32U (NVIDIA High Definition Audio))",
  "  'wasapi/{eaab5d22-d8be-4da8-a5dc-fb590928bd85}' (Speakers (Realtek(R) Audio))",
  "  'openal' (Default (openal))",
];

const AUTO: AudioDevice = { id: 'auto', name: 'System default' };
const KATANA: AudioDevice = { id: 'wasapi/{2d948da5-7f24-4c77-8553-5c67cb36d700}', name: 'Speakers (Sound BlasterX Katana)' };
const MONITOR: AudioDevice = { id: 'wasapi/{d5ce34f8-c4b7-47c0-8009-5922029a8ccb}', name: 'Gigabyte M32U (NVIDIA High Definition Audio)' };
const REALTEK: AudioDevice = { id: 'wasapi/{eaab5d22-d8be-4da8-a5dc-fb590928bd85}', name: 'Speakers (Realtek(R) Audio)' };
const OPENAL: AudioDevice = { id: 'openal', name: 'Default (openal)' };
const WINDOWS_DEVICES: AudioDevice[] = [AUTO, KATANA, MONITOR, REALTEK, OPENAL];

function mpvRun(overrides: Partial<MpvRun>): MpvRun {
  return { code: 0, output: '', failure: null, ...overrides };
}

describe('parseAudioDeviceHelp', () => {
  it('parses the Windows device list with nested parentheses in the names', () => {
    expect(parseAudioDeviceHelp(WINDOWS_HELP_LINES.join('\n'))).toEqual(WINDOWS_DEVICES);
  });

  it('accepts CRLF line ends', () => {
    expect(parseAudioDeviceHelp(`${WINDOWS_HELP_LINES.join('\r\n')}\r\n`)).toEqual(WINDOWS_DEVICES);
  });

  it('parses PipeWire and ALSA lines and skips a malformed line', () => {
    const output = [
      'List of detected audio devices:',
      "  'pipewire/bluez_output.F4_4E_FD_00_11_22.1' (JBL Flip 6)",
      "  'alsa/sysdefault:CARD=Headphones' (bcm2835 Headphones, bcm2835 Headphones/Default Audio Device)",
      "  'broken-line' without a name",
    ].join('\n');
    expect(parseAudioDeviceHelp(output)).toEqual([
      { id: 'pipewire/bluez_output.F4_4E_FD_00_11_22.1', name: 'JBL Flip 6' },
      { id: 'alsa/sysdefault:CARD=Headphones', name: 'bcm2835 Headphones, bcm2835 Headphones/Default Audio Device' },
    ]);
  });
});

describe('parseAudioDeviceList', () => {
  it('maps mpv name to id and description to name', () => {
    expect(parseAudioDeviceList([
      { name: 'auto', description: 'Autoselect device' },
      { name: KATANA.id, description: KATANA.name },
    ])).toEqual([AUTO, KATANA]);
  });

  it('uses the id as the name when the description is missing or not a string', () => {
    expect(parseAudioDeviceList([{ name: 'openal' }, { name: 'pulse', description: 7 }])).toEqual([
      { id: 'openal', name: 'openal' },
      { id: 'pulse', name: 'pulse' },
    ]);
  });

  it('skips junk entries and a value that is not an array', () => {
    expect(parseAudioDeviceList([null, 'auto', 5, { name: '' }, { name: 3 }, { description: 'x' }])).toEqual([]);
    expect(parseAudioDeviceList({ name: 'auto' })).toEqual([]);
    expect(parseAudioDeviceList(undefined)).toEqual([]);
  });
});

describe('audioDeviceDriver', () => {
  it.each([
    [KATANA.id, 'wasapi'],
    ['openal', 'openal'],
    ['pipewire/bluez_output.F4_4E_FD_00_11_22.1', 'pipewire'],
    ['alsa/sysdefault:CARD=Headphones', 'alsa'],
    ['auto', 'auto'],
  ])('returns the driver of %s', (id, driver) => {
    expect(audioDeviceDriver(id)).toBe(driver);
  });
});

describe('filterToOneDriver', () => {
  it('keeps auto and the first driver devices, dropping the other driver', () => {
    expect(filterToOneDriver(WINDOWS_DEVICES, null)).toEqual([AUTO, KATANA, MONITOR, REALTEK]);
  });

  it('keeps the preferred driver when a device has it', () => {
    expect(filterToOneDriver(WINDOWS_DEVICES, 'openal')).toEqual([AUTO, OPENAL]);
  });

  it('falls back to the first driver for an unknown preferred driver', () => {
    expect(filterToOneDriver(WINDOWS_DEVICES, 'pulse')).toEqual([AUTO, KATANA, MONITOR, REALTEK]);
  });

  it('prepends auto when the list has none', () => {
    expect(filterToOneDriver([KATANA, OPENAL], null)).toEqual([AUTO, KATANA]);
  });

  it('returns only auto for an empty list', () => {
    expect(filterToOneDriver([], 'wasapi')).toEqual([AUTO]);
  });
});

describe('probeAudioDevices', () => {
  beforeEach(() => {
    runMpvMock.mockReset();
  });

  it('runs mpv headless and parses its device list', async () => {
    runMpvMock.mockResolvedValue(mpvRun({ output: WINDOWS_HELP_LINES.join('\r\n') }));
    await expect(probeAudioDevices('/usr/bin/mpv')).resolves.toEqual(WINDOWS_DEVICES);
    expect(runMpvMock).toHaveBeenCalledWith(
      '/usr/bin/mpv',
      ['--no-config', '--audio-device=help'],
      MPV_AUDIO_DEVICE_PROBE_TIMEOUT_MS,
    );
  });

  it('rejects naming the failure when the run did not finish', async () => {
    runMpvMock.mockResolvedValue(mpvRun({ code: null, failure: 'spawn /missing/mpv ENOENT' }));
    await expect(probeAudioDevices('/missing/mpv')).rejects.toThrow('spawn /missing/mpv ENOENT');
  });

  it('rejects on a non-zero exit code', async () => {
    runMpvMock.mockResolvedValue(mpvRun({ code: 1, output: WINDOWS_HELP_LINES.join('\n') }));
    await expect(probeAudioDevices('/usr/bin/mpv')).rejects.toThrow('exited with code 1');
  });

  it('rejects when the output lists no devices', async () => {
    runMpvMock.mockResolvedValue(mpvRun({ output: 'List of detected audio devices:\n' }));
    await expect(probeAudioDevices('/usr/bin/mpv')).rejects.toThrow('listed no devices');
  });
});

describe('findReplacementDevice', () => {
  const NEW_KATANA: AudioDevice = { id: 'wasapi/{ff177090-27df-4204-a523-2b3537e634dc}', name: KATANA.name };

  it('finds the one newly listed device with the lost name and driver', () => {
    expect(findReplacementDevice(KATANA, [AUTO, NEW_KATANA, REALTEK], new Set([KATANA.id, REALTEK.id]))).toEqual(NEW_KATANA);
  });

  it('skips a device listed beside the lost one, such as a second speaker of the same model', () => {
    expect(findReplacementDevice(KATANA, [AUTO, NEW_KATANA], new Set([KATANA.id, NEW_KATANA.id]))).toBeNull();
  });

  it('returns null when two devices share the name', () => {
    const twin: AudioDevice = { id: 'wasapi/{twin}', name: KATANA.name };
    expect(findReplacementDevice(KATANA, [NEW_KATANA, twin], new Set())).toBeNull();
  });

  it('returns null for the same name under another driver', () => {
    expect(findReplacementDevice(KATANA, [{ id: 'openal/katana', name: KATANA.name }], new Set())).toBeNull();
  });

  it('never picks auto', () => {
    expect(findReplacementDevice({ id: 'wasapi/{x}', name: AUTO.name }, [AUTO], new Set())).toBeNull();
  });
});

describe('resolveSavedDevice', () => {
  const NEW_KATANA: AudioDevice = { id: 'wasapi/{ff177090-27df-4204-a523-2b3537e634dc}', name: KATANA.name };

  it('keeps a saved device that is listed under its id', () => {
    expect(resolveSavedDevice(KATANA, [AUTO, KATANA, NEW_KATANA])).toBe(KATANA);
  });

  it('moves a saved device that is listed only under a new id', () => {
    expect(resolveSavedDevice(KATANA, [AUTO, NEW_KATANA, REALTEK])).toEqual(NEW_KATANA);
  });

  it('keeps a saved device with no name, since nothing can match it', () => {
    const unnamed = { id: KATANA.id, name: null };
    expect(resolveSavedDevice(unnamed, [AUTO, NEW_KATANA])).toBe(unnamed);
  });
});
