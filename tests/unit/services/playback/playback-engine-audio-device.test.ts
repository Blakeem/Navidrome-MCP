/**
 * Navidrome MCP Server - playback-engine audio device unit tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { MissingAudioOutput } from '../../../../src/services/playback/playback-engine.js';

interface FakeIpc {
  connect: ReturnType<typeof vi.fn>;
  isConnected: ReturnType<typeof vi.fn>;
  command: ReturnType<typeof vi.fn>;
  observeProperty: ReturnType<typeof vi.fn>;
  onPropertyChange: ReturnType<typeof vi.fn>;
  onEvent: ReturnType<typeof vi.fn>;
  onDisconnect: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  propertyHandlers: Array<(evt: { id: number; name: string; data: unknown }) => void>;
  props: Record<string, unknown>;
}

interface FakeMpv {
  props?: Record<string, unknown>;
  /** Reads of these fail, like an unavailable mpv property. */
  unreadable?: readonly string[];
  /** Writes of these fail, like a rejected set_property. */
  unwritable?: readonly string[];
}

function makeFakeIpc(mpv: FakeMpv = {}): FakeIpc {
  const props: Record<string, unknown> = { 'mpv-version': 'mpv v0.40.0', ...mpv.props };
  const propertyHandlers: FakeIpc['propertyHandlers'] = [];
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
    // eslint-disable-next-line @typescript-eslint/require-await -- mock must match async IPC command interface
    command: vi.fn(async (...args: unknown[]) => {
      const name = args[1] as string;
      if (args[0] === 'set_property' && mpv.unwritable?.includes(name) === true) throw new Error('mpv command error');
      if (args[0] !== 'get_property') return null;
      if (mpv.unreadable?.includes(name) === true) throw new Error('mpv command error: property unavailable');
      return props[name] ?? null;
    }),
    observeProperty: vi.fn().mockResolvedValue(undefined),
    onPropertyChange: vi.fn((handler: FakeIpc['propertyHandlers'][number]) => { propertyHandlers.push(handler); }),
    onEvent: vi.fn(),
    onDisconnect: vi.fn(),
    close: vi.fn(),
    propertyHandlers,
    props,
  };
}

const fakeIpcRef = vi.hoisted(() => ({ value: null as unknown }));
const probeAudioDevicesMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/services/playback/mpv-ipc.js', () => ({
  MpvIpc: vi.fn(() => fakeIpcRef.value),
}));

vi.mock('../../../../src/services/playback/mpv-process.js', () => ({
  getDefaultIpcPath: () => '/tmp/test-fake.sock',
  spawnMpv: vi.fn(() => Object.assign(new EventEmitter(), { kill: vi.fn(), unref: (): void => undefined })),
}));

vi.mock('../../../../src/services/playback/audio-devices.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  probeAudioDevices: probeAudioDevicesMock,
}));

vi.mock('node:fs', () => ({
  existsSync: () => true,
}));

vi.mock('node:fs/promises', () => ({
  unlink: vi.fn().mockResolvedValue(undefined),
}));

// Nothing listens on the socket, so the stale-socket probe lets a spawn go ahead.
vi.mock('node:net', () => ({
  createConnection: vi.fn(() => {
    const sock = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() });
    setImmediate(() => sock.emit('error', new Error('ECONNREFUSED')));
    return sock;
  }),
}));

const { playbackEngine } = await import('../../../../src/services/playback/playback-engine.js');
const { MpvIpc } = await import('../../../../src/services/playback/mpv-ipc.js');
const { spawnMpv } = await import('../../../../src/services/playback/mpv-process.js');
const { logger } = await import('../../../../src/utils/logger.js');

const baseConfig = {
  navidromeUrl: 'http://navidrome.test',
  navidromeUsername: 'user',
  navidromePassword: 'pass',
  mpvPath: '/fake/mpv',
  playbackTranscodeFormat: 'mp3',
  playbackTranscodeBitrate: '192',
} as never;

const SPEAKER = { id: 'wasapi/{speaker}', name: 'Speakers' };
const HEADSET = { id: 'wasapi/{headset}', name: 'Headset' };
const AUTO_ENTRY = { name: 'auto', description: 'Autoselect device' };
const AUTO_DEVICE = { id: 'auto', name: 'System default' };
const SPEAKER_LIST = [AUTO_ENTRY, { name: SPEAKER.id, description: SPEAKER.name }];
const PLAYING = { pause: false, 'idle-active': false };

function useIpc(mpv: FakeMpv): FakeIpc {
  const ipc = makeFakeIpc(mpv);
  fakeIpcRef.value = ipc;
  return ipc;
}

/** Makes the attach fail, so a call that only attaches finds no mpv. */
function noMpvRunning(): void {
  const ipc = makeFakeIpc();
  ipc.connect.mockRejectedValue(new Error('ENOENT'));
  fakeIpcRef.value = ipc;
}

/** One attach that fails, then a spawn whose connect succeeds. */
function queueSpawnPath(mpv: FakeMpv): FakeIpc {
  const attachFake = makeFakeIpc();
  attachFake.connect.mockRejectedValue(new Error('ENOENT'));
  const spawnFake = makeFakeIpc(mpv);
  vi.mocked(MpvIpc)
    .mockImplementationOnce(() => attachFake as never)
    .mockImplementationOnce(() => spawnFake as never);
  return spawnFake;
}

function emitProperty(ipc: FakeIpc, name: string, data: unknown): void {
  for (const handler of ipc.propertyHandlers) handler({ id: 0, name, data });
}

/** Changes the value live reads see, then emits it, like mpv does. */
function changeProperty(ipc: FakeIpc, name: string, data: unknown): void {
  ipc.props[name] = data;
  emitProperty(ipc, name, data);
}

/** Lets a handler's unawaited IPC round trips settle. */
function flush(): Promise<void> {
  return new Promise((resolve) => { setImmediate(resolve); });
}

function mutatingCommands(ipc: FakeIpc): string[] {
  return ipc.command.mock.calls
    .filter((call) => call[0] !== 'get_property')
    .map((call) => (call[0] === 'set_property' ? `set ${String(call[1])} ${String(call[2])}` : String(call[0])));
}

function pauseWrites(ipc: FakeIpc): number {
  return mutatingCommands(ipc).filter((command) => command === 'set pause true').length;
}

async function attachTo(mpv: FakeMpv): Promise<FakeIpc> {
  const ipc = useIpc(mpv);
  await playbackEngine.ensureRunning();
  ipc.command.mockClear();
  return ipc;
}

beforeEach(() => {
  fakeIpcRef.value = makeFakeIpc();
  playbackEngine.configure(baseConfig);
});

afterEach(() => {
  playbackEngine.shutdown();
  playbackEngine.setAudioDeviceSource(() => null);
  vi.clearAllMocks();
});

describe('audio device at spawn', () => {
  it('writes the saved device to the spawned mpv', async () => {
    playbackEngine.setAudioDeviceSource(() => HEADSET);
    const spawnFake = queueSpawnPath({ props: { 'idle-active': true } });

    await playbackEngine.ensureRunning();

    expect(spawnMpv).toHaveBeenCalledTimes(1);
    expect(spawnFake.command).toHaveBeenCalledWith('set_property', 'audio-device', HEADSET.id);
  });

  it('writes no device when none is saved', async () => {
    const spawnFake = queueSpawnPath({ props: { 'idle-active': true } });

    await playbackEngine.ensureRunning();

    expect(mutatingCommands(spawnFake).some((command) => command.startsWith('set audio-device'))).toBe(false);
  });

  it('still connects when the device write rejects', async () => {
    playbackEngine.setAudioDeviceSource(() => HEADSET);
    queueSpawnPath({ props: { 'idle-active': true }, unwritable: ['audio-device'] });
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    try {
      await expect(playbackEngine.ensureRunning()).resolves.toBeUndefined();
      expect(playbackEngine.isRunning()).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('writes no device to an mpv it attaches to', async () => {
    playbackEngine.setAudioDeviceSource(() => HEADSET);
    const ipc = useIpc({ props: { 'idle-active': true } });

    await playbackEngine.ensureRunning();

    expect(spawnMpv).not.toHaveBeenCalled();
    expect(ipc.command).not.toHaveBeenCalledWith('set_property', 'audio-device', HEADSET.id);
  });

  it('writes and saves the re-registered id of a saved device missing under its own id', async () => {
    const moved = { id: 'wasapi/{headset-new}', name: HEADSET.name };
    const save = vi.fn(() => true);
    playbackEngine.setAudioDeviceSource(() => HEADSET, { save });
    const spawnFake = queueSpawnPath({
      props: { 'idle-active': true, 'audio-device-list': [AUTO_ENTRY, { name: moved.id, description: moved.name }] },
    });

    await playbackEngine.ensureRunning();

    expect(spawnFake.command).toHaveBeenCalledWith('set_property', 'audio-device', moved.id);
    expect(spawnFake.command).not.toHaveBeenCalledWith('set_property', 'audio-device', HEADSET.id);
    expect(save).toHaveBeenCalledWith(moved);
  });

  it('still writes the saved id when the device list read fails', async () => {
    playbackEngine.setAudioDeviceSource(() => HEADSET);
    const spawnFake = queueSpawnPath({ props: { 'idle-active': true }, unreadable: ['audio-device-list'] });

    await playbackEngine.ensureRunning();

    expect(spawnFake.command).toHaveBeenCalledWith('set_property', 'audio-device', HEADSET.id);
  });

  it('treats a throwing source as no device', async () => {
    playbackEngine.setAudioDeviceSource(() => { throw new Error('store unreadable'); });
    const spawnFake = queueSpawnPath({ props: { 'idle-active': true } });

    await playbackEngine.ensureRunning();

    expect(mutatingCommands(spawnFake).some((command) => command.startsWith('set audio-device'))).toBe(false);
  });
});

describe('pause on a lost audio output', () => {
  const speakerPlaying = { ...PLAYING, 'audio-device': SPEAKER.id, 'audio-device-list': SPEAKER_LIST, 'current-ao': 'wasapi' };

  it('pauses when mpv falls back to the null output while playing', async () => {
    const ipc = await attachTo({ props: speakerPlaying });

    emitProperty(ipc, 'current-ao', 'null');

    expect(ipc.command).toHaveBeenCalledWith('set_property', 'pause', true);
  });

  it('pauses when the device list drops the selected device', async () => {
    const ipc = await attachTo({ props: speakerPlaying });

    emitProperty(ipc, 'audio-device-list', [AUTO_ENTRY]);

    expect(pauseWrites(ipc)).toBe(1);
  });

  it('does not pause while mpv reloads the output', async () => {
    const ipc = await attachTo({ props: speakerPlaying });

    emitProperty(ipc, 'current-ao', null);
    emitProperty(ipc, 'current-ao', undefined);

    expect(pauseWrites(ipc)).toBe(0);
  });

  it('does not pause when idle', async () => {
    const ipc = await attachTo({ props: { ...speakerPlaying, 'idle-active': true } });

    emitProperty(ipc, 'current-ao', 'null');

    expect(pauseWrites(ipc)).toBe(0);
  });

  it('does not pause when already paused', async () => {
    const ipc = await attachTo({ props: { ...speakerPlaying, pause: true } });

    emitProperty(ipc, 'current-ao', 'null');

    expect(pauseWrites(ipc)).toBe(0);
  });

  it('does not pause when the selection is auto and the list changes', async () => {
    const ipc = await attachTo({ props: { ...speakerPlaying, 'audio-device': 'auto' } });

    emitProperty(ipc, 'audio-device-list', [AUTO_ENTRY]);

    expect(pauseWrites(ipc)).toBe(0);
  });

  it('logs the loss once, naming the device', async () => {
    const ipc = await attachTo({ props: { ...speakerPlaying, pause: true } });
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);

    try {
      emitProperty(ipc, 'current-ao', 'null');
      emitProperty(ipc, 'audio-device-list', SPEAKER_LIST);

      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining(SPEAKER.name));
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('pauses when playback starts over an output lost while paused', async () => {
    const ipc = await attachTo({ props: { ...speakerPlaying, pause: true, 'current-ao': 'null' } });

    emitProperty(ipc, 'current-ao', 'null');
    await flush();
    expect(pauseWrites(ipc)).toBe(0);

    emitProperty(ipc, 'pause', false);
    await flush();

    expect(pauseWrites(ipc)).toBe(1);
  });

  it('pauses when a file loads unpaused over an output lost while idle', async () => {
    const ipc = await attachTo({ props: { ...speakerPlaying, 'idle-active': true, 'current-ao': 'null' } });

    emitProperty(ipc, 'idle-active', false);
    await flush();

    expect(pauseWrites(ipc)).toBe(1);
  });

  it('does not pause a start when the live output is a real driver', async () => {
    const ipc = await attachTo({ props: { ...speakerPlaying, pause: true } });

    emitProperty(ipc, 'current-ao', 'null');
    emitProperty(ipc, 'pause', false);
    await flush();

    expect(ipc.command).toHaveBeenCalledWith('get_property', 'current-ao');
    expect(pauseWrites(ipc)).toBe(0);
  });
});

describe('audio device re-registered under a new id', () => {
  const KATANA = { id: 'wasapi/{katana-old}', name: 'Speakers (Katana)' };
  const KATANA_NEW = { id: 'wasapi/{katana-new}', name: KATANA.name };
  const entry = (device: { id: string; name: string }): { name: string; description: string } =>
    ({ name: device.id, description: device.name });
  const BEFORE = [AUTO_ENTRY, entry(KATANA), entry(SPEAKER)];
  const GAP = [AUTO_ENTRY, entry(SPEAKER)];
  const AFTER = [AUTO_ENTRY, entry(SPEAKER), entry(KATANA_NEW)];

  /** Plays on the old Katana id, then Windows drops it, as mpv reports the change. */
  async function playThenLoseKatana(): Promise<FakeIpc> {
    const ipc = await attachTo({ props: { ...PLAYING, 'audio-device': KATANA.id, 'audio-device-list': BEFORE, 'current-ao': 'wasapi' } });
    changeProperty(ipc, 'audio-device-list', BEFORE);
    changeProperty(ipc, 'audio-device-list', GAP);
    changeProperty(ipc, 'pause', true);
    changeProperty(ipc, 'current-ao', 'null');
    return ipc;
  }

  /** mpv echoes the engine's device write, with the output still on null until it re-opens. */
  async function echoDeviceWrite(ipc: FakeIpc, id: string): Promise<void> {
    await flush();
    changeProperty(ipc, 'audio-device', id);
    await flush();
  }

  it('adopts the new id, saves it, and resumes the pause the loss caused', async () => {
    const save = vi.fn(() => true);
    playbackEngine.setAudioDeviceSource(() => KATANA, { save });
    const ipc = await playThenLoseKatana();

    changeProperty(ipc, 'audio-device-list', AFTER);
    await echoDeviceWrite(ipc, KATANA_NEW.id);

    const commands = mutatingCommands(ipc);
    expect(commands.filter((command) => command === 'set pause true')).toHaveLength(1);
    expect(commands).toContain(`set audio-device ${KATANA_NEW.id}`);
    expect(commands.at(-1)).toBe('set pause false');
    expect(save).toHaveBeenCalledWith(KATANA_NEW);
  });

  it('adopts the new id but stays paused after the resume window', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    try {
      const ipc = await playThenLoseKatana();
      nowSpy.mockReturnValue(1_000 + 5_001);

      changeProperty(ipc, 'audio-device-list', AFTER);
      await echoDeviceWrite(ipc, KATANA_NEW.id);

      expect(mutatingCommands(ipc)).toContain(`set audio-device ${KATANA_NEW.id}`);
      expect(mutatingCommands(ipc)).not.toContain('set pause false');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('does not adopt a same-named device that was listed beside the lost one', async () => {
    const save = vi.fn(() => true);
    playbackEngine.setAudioDeviceSource(() => KATANA, { save });
    const ipc = await attachTo({ props: { ...PLAYING, 'audio-device': KATANA.id, 'audio-device-list': BEFORE, 'current-ao': 'wasapi' } });
    changeProperty(ipc, 'audio-device-list', [...BEFORE, entry(KATANA_NEW)]);

    changeProperty(ipc, 'audio-device-list', AFTER);
    await flush();

    expect(mutatingCommands(ipc)).toEqual(['set pause true']);
    expect(save).not.toHaveBeenCalled();
  });

  it('does not adopt a same-named device that left the list before the lost one did', async () => {
    const save = vi.fn(() => true);
    playbackEngine.setAudioDeviceSource(() => KATANA, { save });
    const ipc = await attachTo({ props: { ...PLAYING, 'audio-device': KATANA.id, 'audio-device-list': BEFORE, 'current-ao': 'wasapi' } });
    changeProperty(ipc, 'audio-device-list', [...BEFORE, entry(KATANA_NEW)]);
    changeProperty(ipc, 'audio-device-list', BEFORE);
    changeProperty(ipc, 'audio-device-list', GAP);
    changeProperty(ipc, 'pause', true);

    changeProperty(ipc, 'audio-device-list', AFTER);
    await flush();

    expect(mutatingCommands(ipc)).toEqual(['set pause true']);
    expect(save).not.toHaveBeenCalled();
  });

  it('pauses like a plain loss when the write of the new id fails', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      const ipc = await attachTo({
        props: { ...PLAYING, 'audio-device': KATANA.id, 'audio-device-list': BEFORE, 'current-ao': 'wasapi' },
        unwritable: ['audio-device'],
      });
      changeProperty(ipc, 'audio-device-list', BEFORE);

      changeProperty(ipc, 'audio-device-list', AFTER);
      await flush();

      expect(mutatingCommands(ipc)).toEqual([`set audio-device ${KATANA_NEW.id}`, 'set pause true']);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not save a new id for a device that is not the saved choice', async () => {
    const save = vi.fn(() => true);
    playbackEngine.setAudioDeviceSource(() => SPEAKER, { save });
    const ipc = await playThenLoseKatana();

    changeProperty(ipc, 'audio-device-list', AFTER);
    await flush();

    expect(mutatingCommands(ipc)).toContain(`set audio-device ${KATANA_NEW.id}`);
    expect(save).not.toHaveBeenCalled();
  });
});

describe('returned audio device', () => {
  const GAP = [AUTO_ENTRY];

  async function playThenLoseSpeaker(): Promise<FakeIpc> {
    const ipc = await attachTo({ props: { ...PLAYING, 'audio-device': SPEAKER.id, 'audio-device-list': SPEAKER_LIST, 'current-ao': 'wasapi' } });
    changeProperty(ipc, 'audio-device-list', GAP);
    changeProperty(ipc, 'pause', true);
    changeProperty(ipc, 'current-ao', 'null');
    return ipc;
  }

  it('re-opens the output of a device back after the resume window and stays paused', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    try {
      const ipc = await playThenLoseSpeaker();
      nowSpy.mockReturnValue(1_000 + 5_001);
      ipc.command.mockClear();

      changeProperty(ipc, 'audio-device-list', SPEAKER_LIST);
      await flush();

      expect(mutatingCommands(ipc)).toEqual(['set audio-device auto', `set audio-device ${SPEAKER.id}`]);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('re-opens and resumes a device back within the resume window', async () => {
    const ipc = await playThenLoseSpeaker();
    ipc.command.mockClear();

    changeProperty(ipc, 'audio-device-list', SPEAKER_LIST);
    await flush();

    expect(mutatingCommands(ipc)).toEqual(['set audio-device auto', `set audio-device ${SPEAKER.id}`, 'set pause false']);
  });

  it('does not resume when the user switches to another device', async () => {
    const ipc = await playThenLoseSpeaker();
    ipc.props['audio-device-list'] = [...SPEAKER_LIST, { name: HEADSET.id, description: HEADSET.name }];
    ipc.props['current-ao'] = 'wasapi';
    ipc.command.mockClear();

    changeProperty(ipc, 'audio-device', HEADSET.id);
    await flush();

    expect(mutatingCommands(ipc)).not.toContain('set pause false');
  });

  it('does not resume after playback was resumed by someone else', async () => {
    const ipc = await playThenLoseSpeaker();
    changeProperty(ipc, 'pause', false);
    changeProperty(ipc, 'pause', true);
    ipc.command.mockClear();

    changeProperty(ipc, 'audio-device-list', SPEAKER_LIST);
    await flush();

    expect(mutatingCommands(ipc)).not.toContain('set pause false');
  });
});

describe('audio output check before playback starts', () => {
  const headsetMissing = { 'audio-device': HEADSET.id, 'audio-device-list': SPEAKER_LIST, 'current-ao': 'null' };
  const missingHeadset: MissingAudioOutput = { id: HEADSET.id, name: HEADSET.name };

  it('keeps a replace paused on a missing device and reports it', async () => {
    playbackEngine.setAudioDeviceSource(() => HEADSET);
    const ipc = await attachTo({ props: headsetMissing });

    const result = await playbackEngine.enqueue(['song-1', 'song-2'], 'replace');

    const commands = mutatingCommands(ipc);
    expect(result).toEqual({ demoted: false, outputMissing: missingHeadset });
    expect(commands.indexOf('set pause true')).toBeGreaterThanOrEqual(0);
    expect(commands.indexOf('set pause true')).toBeLessThan(commands.indexOf('loadfile'));
    expect(commands).not.toContain('set pause false');
  });

  it('names a missing device null when the saved device is another one', async () => {
    const ipc = await attachTo({ props: headsetMissing });

    const result = await playbackEngine.enqueue(['song-1'], 'replace');

    expect(result.outputMissing).toEqual({ id: HEADSET.id, name: null });
    expect(mutatingCommands(ipc)).not.toContain('set pause false');
  });

  it('re-opens a listed device on the null output through auto before loading', async () => {
    const ipc = await attachTo({ props: { 'audio-device': SPEAKER.id, 'audio-device-list': SPEAKER_LIST, 'current-ao': 'null' } });

    const result = await playbackEngine.enqueue(['song-1'], 'replace');

    expect(result).toEqual({ demoted: false, outputMissing: null });
    expect(mutatingCommands(ipc)).toEqual([
      'set audio-device auto',
      `set audio-device ${SPEAKER.id}`,
      'playlist-clear',
      'loadfile',
      'set pause false',
    ]);
  });

  it('reloads auto on the null output when mpv lists another device', async () => {
    const ipc = await attachTo({ props: { 'audio-device': 'auto', 'audio-device-list': SPEAKER_LIST, 'current-ao': 'null' } });

    const result = await playbackEngine.enqueue(['song-1'], 'replace');

    expect(result.outputMissing).toBeNull();
    expect(mutatingCommands(ipc).slice(0, 2)).toEqual(['ao-reload', 'playlist-clear']);
  });

  it('reports auto missing on the null output when mpv lists no device', async () => {
    const ipc = await attachTo({ props: { 'audio-device': 'auto', 'audio-device-list': [AUTO_ENTRY], 'current-ao': 'null' } });

    const result = await playbackEngine.enqueue(['song-1'], 'replace');

    expect(result.outputMissing).toEqual({ id: 'auto', name: null });
    expect(mutatingCommands(ipc)).not.toContain('ao-reload');
    expect(mutatingCommands(ipc)).not.toContain('set pause false');
  });

  it('reports a device whose re-open fails', async () => {
    playbackEngine.setAudioDeviceSource(() => SPEAKER);
    const ipc = await attachTo({
      props: { 'audio-device': SPEAKER.id, 'audio-device-list': SPEAKER_LIST, 'current-ao': 'null' },
      unwritable: ['audio-device'],
    });

    const result = await playbackEngine.enqueue(['song-1'], 'replace');

    expect(result.outputMissing).toEqual(SPEAKER);
    expect(mutatingCommands(ipc)).not.toContain('set pause false');
  });

  it('leaves the replace sequence unchanged when the output is present', async () => {
    const ipc = await attachTo({ props: { 'audio-device': SPEAKER.id, 'audio-device-list': SPEAKER_LIST, 'current-ao': 'wasapi' } });

    const result = await playbackEngine.enqueue(['song-1', 'song-2'], 'replace');

    expect(result).toEqual({ demoted: false, outputMissing: null });
    expect(mutatingCommands(ipc)).toEqual(['playlist-clear', 'loadfile', 'loadfile', 'set pause false']);
  });

  it('counts a rejected current-ao read as no open output, not a loss', async () => {
    const ipc = await attachTo({ props: { 'audio-device': 'auto', 'audio-device-list': SPEAKER_LIST }, unreadable: ['current-ao'] });

    const result = await playbackEngine.resume();

    expect(result).toEqual({ outputMissing: null });
    expect(mutatingCommands(ipc)).toEqual(['set pause false']);
  });

  it('keeps a radio load paused on a missing device and reports it', async () => {
    playbackEngine.setAudioDeviceSource(() => HEADSET);
    const ipc = await attachTo({ props: headsetMissing });

    const result = await playbackEngine.enqueueRadio('http://radio.test/live', 'station-1');

    const commands = mutatingCommands(ipc);
    expect(result).toEqual({ outputMissing: missingHeadset });
    expect(commands.indexOf('set pause true')).toBeLessThan(commands.indexOf('loadfile'));
    expect(commands).not.toContain('set pause false');
  });

  it('pauses before the jump on a missing device and reports it', async () => {
    playbackEngine.setAudioDeviceSource(() => HEADSET);
    const ipc = await attachTo({ props: headsetMissing });

    const result = await playbackEngine.jumpToQueueEntry(2);

    expect(result).toEqual({ outputMissing: missingHeadset });
    expect(mutatingCommands(ipc)).toEqual(['set pause true', 'set playlist-pos 2']);
  });

  it('resumes without unpausing on a missing device and reports it', async () => {
    playbackEngine.setAudioDeviceSource(() => HEADSET);
    const ipc = await attachTo({ props: headsetMissing });

    const result = await playbackEngine.resume();

    expect(result).toEqual({ outputMissing: missingHeadset });
    expect(mutatingCommands(ipc)).toEqual([]);
  });

  it('unpauses a jump and a resume when the output is present', async () => {
    const ipc = await attachTo({ props: { 'audio-device': SPEAKER.id, 'audio-device-list': SPEAKER_LIST, 'current-ao': 'wasapi' } });

    const jump = await playbackEngine.jumpToQueueEntry(1);
    const resume = await playbackEngine.resume();

    expect(jump).toEqual({ outputMissing: null });
    expect(resume).toEqual({ outputMissing: null });
    expect(mutatingCommands(ipc)).toEqual(['set playlist-pos 1', 'set pause false', 'set pause false']);
  });
});

describe('getStatus audio output', () => {
  it('reports null for both fields when mpv is not running', () => {
    const status = playbackEngine.getStatus();

    expect(status.audioDevice).toBeNull();
    expect(status.audioOutputLost).toBeNull();
  });

  it('reports the cached device and whether its output is lost', async () => {
    playbackEngine.setAudioDeviceSource(() => SPEAKER);
    const ipc = await attachTo({
      props: { ...PLAYING, 'audio-device': SPEAKER.id, 'audio-device-list': SPEAKER_LIST, 'current-ao': 'wasapi' },
    });
    const connected = playbackEngine.getStatus();

    emitProperty(ipc, 'audio-device-list', [AUTO_ENTRY]);
    const dropped = playbackEngine.getStatus();
    emitProperty(ipc, 'audio-device-list', SPEAKER_LIST);
    emitProperty(ipc, 'current-ao', 'null');
    const nullOutput = playbackEngine.getStatus();

    expect(connected).toMatchObject({ audioDevice: { ...SPEAKER, connected: true }, audioOutputLost: false });
    expect(dropped).toMatchObject({ audioDevice: { ...SPEAKER, connected: false }, audioOutputLost: true });
    expect(nullOutput).toMatchObject({ audioDevice: { ...SPEAKER, connected: true }, audioOutputLost: true });
  });

  it('reports auto with its listed name when mpv holds no device value', async () => {
    await attachTo({ props: { 'audio-device-list': SPEAKER_LIST } });

    expect(playbackEngine.getStatus()).toMatchObject({
      audioDevice: { ...AUTO_DEVICE, connected: true },
      audioOutputLost: false,
    });
  });
});

describe('describeAudioDevices', () => {
  it('reads the live values of a running mpv', async () => {
    useIpc({ props: { 'audio-device': SPEAKER.id, 'audio-device-list': SPEAKER_LIST, 'current-ao': 'wasapi' } });

    const report = await playbackEngine.describeAudioDevices();

    expect(report).toEqual({
      selected: { ...SPEAKER, connected: true },
      output: 'wasapi',
      devices: [AUTO_DEVICE, SPEAKER],
      source: 'player',
    });
    expect(probeAudioDevicesMock).not.toHaveBeenCalled();
  });

  it('reports a null output when the live current-ao read rejects', async () => {
    useIpc({ props: { 'audio-device': 'auto', 'audio-device-list': SPEAKER_LIST }, unreadable: ['current-ao'] });

    const report = await playbackEngine.describeAudioDevices();

    expect(report.output).toBeNull();
  });

  it('probes the binary without spawning mpv when none runs', async () => {
    playbackEngine.setAudioDeviceSource(() => HEADSET);
    noMpvRunning();
    probeAudioDevicesMock.mockResolvedValue([AUTO_DEVICE, SPEAKER]);

    const report = await playbackEngine.describeAudioDevices();

    expect(report).toEqual({
      selected: { ...HEADSET, connected: false },
      output: null,
      devices: [AUTO_DEVICE, SPEAKER],
      source: 'probe',
    });
    expect(probeAudioDevicesMock).toHaveBeenCalledWith('/fake/mpv');
    expect(spawnMpv).not.toHaveBeenCalled();
  });

  it('selects auto in a probe when no device is saved', async () => {
    noMpvRunning();
    probeAudioDevicesMock.mockResolvedValue([AUTO_DEVICE]);

    const report = await playbackEngine.describeAudioDevices();

    expect(report.selected).toEqual({ ...AUTO_DEVICE, connected: true });
  });

  it('reports a saved device by its re-registered id in a probe', async () => {
    const moved = { id: 'wasapi/{headset-new}', name: HEADSET.name };
    playbackEngine.setAudioDeviceSource(() => HEADSET);
    noMpvRunning();
    probeAudioDevicesMock.mockResolvedValue([AUTO_DEVICE, SPEAKER, moved]);

    const report = await playbackEngine.describeAudioDevices();

    expect(report.selected).toEqual({ ...moved, connected: true });
  });

  it('rejects without an mpv binary when none runs', async () => {
    playbackEngine.configure({ ...(baseConfig as object), mpvPath: null } as never);
    noMpvRunning();

    await expect(playbackEngine.describeAudioDevices()).rejects.toThrow(/missing mpv binary/);
    expect(probeAudioDevicesMock).not.toHaveBeenCalled();
  });
});

describe('selectAudioDevice', () => {
  it('returns false without spawning when no mpv runs', async () => {
    noMpvRunning();

    await expect(playbackEngine.selectAudioDevice(SPEAKER.id)).resolves.toBe(false);
    expect(spawnMpv).not.toHaveBeenCalled();
  });

  it('writes the id to a running mpv and leaves the pause state alone', async () => {
    const ipc = useIpc({ props: { 'audio-device': 'auto', 'audio-device-list': SPEAKER_LIST, 'current-ao': 'wasapi' } });

    await expect(playbackEngine.selectAudioDevice(SPEAKER.id)).resolves.toBe(true);

    expect(mutatingCommands(ipc)).toEqual([`set audio-device ${SPEAKER.id}`]);
  });

  it('re-opens the output when the id is unchanged and the output is lost', async () => {
    const ipc = useIpc({ props: { 'audio-device': SPEAKER.id, 'audio-device-list': SPEAKER_LIST, 'current-ao': 'null' } });

    await expect(playbackEngine.selectAudioDevice(SPEAKER.id)).resolves.toBe(true);

    expect(mutatingCommands(ipc)).toEqual(['set audio-device auto', `set audio-device ${SPEAKER.id}`]);
  });
});
