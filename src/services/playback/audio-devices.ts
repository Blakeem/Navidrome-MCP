/**
 * Navidrome MCP Server - Audio output devices
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { MPV_AUDIO_DEVICE_PROBE_TIMEOUT_MS } from '../../constants/timeouts.js';
import { runMpv } from './mpv-run.js';

/** `id` is mpv's device `name` and `name` is mpv's device `description`. */
export interface AudioDevice {
  id: string;
  name: string;
}

export const AUTO_DEVICE_ID = 'auto';
// `current-ao` names mpv's null output once --audio-fallback-to-null replaced a lost output. A normal
// reload leaves the property unavailable instead.
export const NULL_AUDIO_OUTPUT = 'null';
// mpv names this entry "Autoselect device", and every surface showed both names before.
export const AUTO_DEVICE: AudioDevice = { id: AUTO_DEVICE_ID, name: 'System default' };
const PROBE_ARGS: readonly string[] = ['--no-config', '--audio-device=help'];
// mpv's ao_print_devices writes `  '<id>' (<name>)`. The name can hold parentheses, so it runs to the last `)`.
const HELP_LINE = /^\s*'(.+?)' \((.*)\)\s*$/;

function toAudioDevice(id: string, name: string): AudioDevice {
  return { id, name: id === AUTO_DEVICE_ID ? AUTO_DEVICE.name : name };
}

export function parseAudioDeviceHelp(output: string): AudioDevice[] {
  const devices: AudioDevice[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = HELP_LINE.exec(line);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    devices.push(toAudioDevice(match[1], match[2]));
  }
  return devices;
}

export function parseAudioDeviceList(value: unknown): AudioDevice[] {
  if (!Array.isArray(value)) return [];
  const devices: AudioDevice[] = [];
  for (const entry of value as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { name, description } = entry as { name?: unknown; description?: unknown };
    if (typeof name !== 'string' || name === '') continue;
    devices.push(toAudioDevice(name, typeof description === 'string' ? description : name));
  }
  return devices;
}

/**
 * Windows can re-register an output under a new id, such as when a Bluetooth device connects. An id
 * listed beside the lost one is a different output, such as a second speaker of the same model.
 */
export function findReplacementDevice(
  lost: AudioDevice,
  devices: readonly AudioDevice[],
  listedBeside: ReadonlySet<string>,
): AudioDevice | null {
  const driver = audioDeviceDriver(lost.id);
  const [match, ...others] = devices.filter((device) =>
    device.id !== AUTO_DEVICE_ID &&
    device.name === lost.name &&
    audioDeviceDriver(device.id) === driver &&
    !listedBeside.has(device.id),
  );
  return match !== undefined && others.length === 0 ? match : null;
}

/** A saved device missing under its own id is matched by name, so a re-registered output still opens. */
export function resolveSavedDevice<T extends { id: string; name: string | null }>(
  saved: T,
  devices: readonly AudioDevice[],
): T | AudioDevice {
  if (saved.name === null || devices.some((device) => device.id === saved.id)) return saved;
  return findReplacementDevice({ id: saved.id, name: saved.name }, devices, new Set()) ?? saved;
}

export function audioDeviceDriver(id: string): string {
  const slashIndex = id.indexOf('/');
  return slashIndex === -1 ? id : id.slice(0, slashIndex);
}

/**
 * mpv lists every output once per driver it was built with, such as `wasapi` and `openal` on Windows,
 * so one speaker would show several times without this.
 */
export function filterToOneDriver(devices: readonly AudioDevice[], preferredDriver: string | null): AudioDevice[] {
  const autoDevice = devices.find((device) => device.id === AUTO_DEVICE_ID) ?? AUTO_DEVICE;
  const driverDevices = devices.filter((device) => device.id !== AUTO_DEVICE_ID);
  const drivers = driverDevices.map((device) => audioDeviceDriver(device.id));
  const driver = preferredDriver !== null && drivers.includes(preferredDriver) ? preferredDriver : drivers[0];
  if (driver === undefined) return [autoDevice];
  return [autoDevice, ...driverDevices.filter((device) => audioDeviceDriver(device.id) === driver)];
}

export async function probeAudioDevices(mpvBinary: string): Promise<AudioDevice[]> {
  const run = await runMpv(mpvBinary, PROBE_ARGS, MPV_AUDIO_DEVICE_PROBE_TIMEOUT_MS);
  if (run.failure !== null) throw new Error(`mpv audio device probe failed: ${run.failure}`);
  if (run.code !== 0) throw new Error(`mpv audio device probe exited with code ${String(run.code)}`);
  const devices = parseAudioDeviceHelp(run.output);
  if (devices.length === 0) throw new Error('mpv audio device probe listed no devices');
  return devices;
}
