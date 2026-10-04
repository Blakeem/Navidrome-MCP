/**
 * Navidrome MCP Server - Visualizer analysis filter
 * Copyright (C) 2025
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * The mpv audio filter behind the web remote's visualizer. The main path passes the audio through
 * untouched in any channel layout. A side path measures a mono copy in log-spaced bands and prints
 * each measurement to the FFmpeg log, which mpv forwards to IPC clients that request log messages.
 */

import { spawn } from 'node:child_process';
import { MPV_VISUALIZER_VALIDATE_RETRY_MS, MPV_VISUALIZER_VALIDATE_TIMEOUT_MS } from '../../constants/timeouts.js';

export const VISUALIZER_FILTER_LABEL = 'navidrome-viz';
export const VISUALIZER_BAND_COUNT = 16;

const LOWEST_BAND_HZ = 40;
const HIGHEST_BAND_HZ = 16000;
const BAND_STEP = (HIGHEST_BAND_HZ / LOWEST_BAND_HZ) ** (1 / (VISUALIZER_BAND_COUNT - 1));
// Each band spans one step, so neighbors meet without a gap.
const BAND_WIDTH_OCTAVES = Math.log2(BAND_STEP).toFixed(3);
// About 23 ms at the analysis rate, which tested at 43 distinct updates per second.
const MEASUREMENT_SAMPLES = 1024;
// One fixed rate keeps the top band below Nyquist for a 22.05 kHz stream, where a bandpass biquad turns
// unstable. A list of rates instead failed FFmpeg's format negotiation at the band merge.
const ANALYSIS_SAMPLE_RATE = 44100;

export const VISUALIZER_BAND_CENTERS_HZ: readonly number[] = Array.from(
  { length: VISUALIZER_BAND_COUNT },
  (_, i) => Math.round(LOWEST_BAND_HZ * BAND_STEP ** i),
);

/**
 * `build` names the mpv and FFmpeg versions that passed, so a running mpv of another build is never trusted.
 * `retry` marks a run that timed out or failed to start, which says nothing about the filter itself.
 */
export type VisualizerValidation = { ok: true; build: string } | { ok: false; reason: string; retry: boolean };

type VisualizerAction = 'install' | 'remove' | 'defer' | 'none';

/** How a run ended. `failure` is set when it timed out or never started, and then `code` means nothing. */
interface MpvRun {
  code: number | null;
  output: string;
  failure: string | null;
}

const VISUALIZER_GRAPH = buildVisualizerGraph();
const VALIDATION_ARGS: readonly string[] = [
  '--no-config',
  '--load-scripts=no',
  '--msg-level=all=error',
  '--ao=null',
  '--ao-null-untimed',
  '--vo=null',
  `--af=${visualizerFilterSpec()}`,
  'av://lavfi:anullsrc=r=44100:cl=stereo:d=0.2',
];
const validations = new Map<string, Promise<VisualizerValidation>>();
const settledValidations = new Map<string, VisualizerValidation>();

function buildVisualizerGraph(): string {
  const splitOutputs = VISUALIZER_BAND_CENTERS_HZ.map((_, i) => `[split${i}]`).join('');
  const bandFilters = VISUALIZER_BAND_CENTERS_HZ
    .map((hz, i) => `[split${i}]bandpass=f=${hz}:width_type=o:w=${BAND_WIDTH_OCTAVES}[band${i}];`)
    .join('');
  const bandInputs = VISUALIZER_BAND_CENTERS_HZ.map((_, i) => `[band${i}]`).join('');
  return [
    'asplit=2[main][analysis];',
    `[analysis]aformat=sample_rates=${ANALYSIS_SAMPLE_RATE}:channel_layouts=mono,`,
    `asplit=${VISUALIZER_BAND_COUNT}${splitOutputs};`,
    bandFilters,
    `${bandInputs}amerge=inputs=${VISUALIZER_BAND_COUNT},`,
    `asetnsamples=n=${MEASUREMENT_SAMPLES}:p=0,`,
    'astats=metadata=1:reset=1:measure_perchannel=RMS_level:measure_overall=none,',
    'ametadata=mode=print,anullsink;',
    '[main]anull',
  ].join('');
}

/** The `af add` argument. mpv's %length% quoting carries the graph's brackets and commas verbatim. */
export function visualizerFilterSpec(): string {
  return `@${VISUALIZER_FILTER_LABEL}:lavfi=graph=%${VISUALIZER_GRAPH.length}%${VISUALIZER_GRAPH}`;
}

/** Names a build from the `mpv-version` and `ffmpeg-version` a running mpv reports. */
export function mpvBuildId(mpvVersion: unknown, ffmpegVersion: unknown): string | null {
  if (typeof mpvVersion !== 'string' || typeof ffmpegVersion !== 'string') return null;
  if (mpvVersion === '' || ffmpegVersion === '') return null;
  return `${mpvVersion} with FFmpeg ${ffmpegVersion}`;
}

/**
 * mpv accepts a broken filter while idle and then fails every track, so a filter reaches the shared
 * mpv only after a headless run of the same binary plays a fraction of a second through it.
 */
export function validateVisualizerFilter(mpvBinary: string | null): Promise<VisualizerValidation> {
  if (mpvBinary === null) return Promise.resolve({ ok: false, reason: 'no mpv binary is configured', retry: false });
  const cached = validations.get(mpvBinary);
  if (cached !== undefined) return cached;
  const validation = runValidation(mpvBinary).then((result) => {
    settledValidations.set(mpvBinary, result);
    if (!result.ok && result.retry) forgetValidationLater(mpvBinary, validation);
    return result;
  });
  validations.set(mpvBinary, validation);
  return validation;
}

/** Lets a caller that must not wait tell a finished check from one still running. */
export function settledVisualizerValidation(mpvBinary: string | null): VisualizerValidation | undefined {
  return mpvBinary === null ? undefined : settledValidations.get(mpvBinary);
}

// The identity check keeps a reset or a newer run from being dropped by an older run's timer.
function forgetValidationLater(mpvBinary: string, validation: Promise<VisualizerValidation>): void {
  const timer = setTimeout(() => {
    if (validations.get(mpvBinary) !== validation) return;
    validations.delete(mpvBinary);
    settledValidations.delete(mpvBinary);
  }, MPV_VISUALIZER_VALIDATE_RETRY_MS);
  timer.unref();
}

async function runValidation(mpvBinary: string): Promise<VisualizerValidation> {
  const [check, version] = await Promise.all([runMpv(mpvBinary, VALIDATION_ARGS), runMpv(mpvBinary, ['--version'])]);
  const failure = check.failure ?? version.failure;
  if (failure !== null) return { ok: false, reason: failure, retry: true };
  if (check.code !== 0) {
    const firstLine = check.output.trim().split(/\r?\n/)[0] ?? '';
    return { ok: false, reason: firstLine || `mpv exited with code ${String(check.code)}`, retry: false };
  }
  const build = parseVersionOutput(version.output);
  if (build === null) return { ok: false, reason: 'mpv --version did not name its mpv and FFmpeg versions', retry: false };
  return { ok: true, build };
}

// The first line opens with the `mpv-version` property's value, and a later line carries `ffmpeg-version`'s.
function parseVersionOutput(output: string): string | null {
  const lines = output.split(/\r?\n/);
  const mpvVersion = /^(mpv \S+)/.exec(lines[0] ?? '')?.[1];
  const ffmpegVersion = lines.map((line) => /^FFmpeg version: (\S+)/.exec(line)?.[1]).find((match) => match !== undefined);
  return mpvBuildId(mpvVersion, ffmpegVersion);
}

function runMpv(mpvBinary: string, args: readonly string[]): Promise<MpvRun> {
  return new Promise((resolve) => {
    let output = '';
    const child = spawn(mpvBinary, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: null, output, failure: `mpv did not finish in ${MPV_VISUALIZER_VALIDATE_TIMEOUT_MS} ms` });
    }, MPV_VISUALIZER_VALIDATE_TIMEOUT_MS);
    const collect = (chunk: Buffer): void => { output += chunk.toString('utf8'); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: null, output, failure: err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output, failure: null });
    });
  });
}

/**
 * A filter change mid-track can drop about 40 ms of audio, so a change waits for mpv to be idle,
 * paused or starting a new file.
 */
export function decideVisualizerAction(state: { wanted: boolean; installed: boolean; safe: boolean }): VisualizerAction {
  if (state.wanted === state.installed) return 'none';
  if (!state.safe) return 'defer';
  return state.wanted ? 'install' : 'remove';
}

/**
 * Whether mpv's `af` list holds a working visualizer filter. mpv disables a filter whose graph fails to
 * configure for a track and keeps playing, so a disabled entry counts as missing and gets re-added.
 */
export function hasVisualizerFilter(filters: unknown): boolean {
  return Array.isArray(filters) && filters.some((filter: unknown) => {
    if (typeof filter !== 'object' || filter === null) return false;
    const entry = filter as { label?: unknown; enabled?: unknown };
    return entry.label === VISUALIZER_FILTER_LABEL && entry.enabled !== false;
  });
}

export function resetVisualizerValidationsForTests(): void {
  validations.clear();
  settledValidations.clear();
}
