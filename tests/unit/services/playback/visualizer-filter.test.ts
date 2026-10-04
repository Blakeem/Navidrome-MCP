import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MPV_VISUALIZER_VALIDATE_RETRY_MS,
  MPV_VISUALIZER_VALIDATE_TIMEOUT_MS,
} from '../../../../src/constants/timeouts.js';

interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
}

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

import {
  VISUALIZER_BAND_CENTERS_HZ,
  VISUALIZER_BAND_COUNT,
  VISUALIZER_FILTER_LABEL,
  decideVisualizerAction,
  hasVisualizerFilter,
  mpvBuildId,
  resetVisualizerValidationsForTests,
  settledVisualizerValidation,
  validateVisualizerFilter,
  visualizerFilterSpec,
} from '../../../../src/services/playback/visualizer-filter.js';

const VERSION_OUTPUT = [
  'mpv v0.41.0-244-gaf9c81fa1 Copyright © 2000-2026 mpv/MPlayer/mplayer2 projects',
  ' built on Mar  2 2026 00:06:26',
  'FFmpeg version: N-123099-g862338fe3',
  'FFmpeg library versions:',
  '',
].join('\r\n');
const BUILD = 'mpv v0.41.0-244-gaf9c81fa1 with FFmpeg N-123099-g862338fe3';

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

/** Each validation spawns two runs: the filter check and `mpv --version`. */
function queueRuns(): { check: FakeChild; version: FakeChild } {
  const check = fakeChild();
  const version = fakeChild();
  spawnMock.mockImplementation((_binary: string, args: string[]) => (args[0] === '--version' ? version : check));
  return { check, version };
}

function answerVersion(version: FakeChild, output = VERSION_OUTPUT): void {
  version.stdout.emit('data', Buffer.from(output));
  version.emit('close', 0);
}

function graphOf(spec: string): string {
  const match = /^@[^:]+:lavfi=graph=%(\d+)%(.*)$/s.exec(spec);
  if (match === null) throw new Error(`not a quoted lavfi spec: ${spec}`);
  return match[2] ?? '';
}

describe('visualizer filter graph', () => {
  it('spaces 16 bands on a log scale from 40 Hz to 16 kHz', () => {
    expect(VISUALIZER_BAND_CENTERS_HZ).toHaveLength(VISUALIZER_BAND_COUNT);
    expect(VISUALIZER_BAND_CENTERS_HZ[0]).toBe(40);
    expect(VISUALIZER_BAND_CENTERS_HZ.at(-1)).toBe(16000);
    const ratios = VISUALIZER_BAND_CENTERS_HZ.slice(1).map((hz, i) => hz / (VISUALIZER_BAND_CENTERS_HZ[i] ?? 1));
    for (const ratio of ratios) expect(ratio).toBeCloseTo(1.49, 1);
  });

  it('passes the main path through untouched and sends the measurements to the log and a sink', () => {
    const graph = graphOf(visualizerFilterSpec());
    expect(graph.startsWith('asplit=2[main][analysis];')).toBe(true);
    expect(graph.endsWith('[main]anull')).toBe(true);
    expect(graph.match(/bandpass=/g)).toHaveLength(VISUALIZER_BAND_COUNT);
    expect(graph).toContain(`amerge=inputs=${VISUALIZER_BAND_COUNT}`);
    expect(graph).toContain('ametadata=mode=print,anullsink;');
    expect(graph).toContain('aformat=sample_rates=44100:channel_layouts=mono');
  });

  it('quotes the graph by length in the af add argument', () => {
    const spec = visualizerFilterSpec();
    const graph = graphOf(spec);
    expect(spec).toBe(`@${VISUALIZER_FILTER_LABEL}:lavfi=graph=%${graph.length}%${graph}`);
  });
});

describe('decideVisualizerAction', () => {
  it.each([
    [{ wanted: true, installed: true, safe: false }, 'none'],
    [{ wanted: false, installed: false, safe: true }, 'none'],
    [{ wanted: true, installed: false, safe: true }, 'install'],
    [{ wanted: true, installed: false, safe: false }, 'defer'],
    [{ wanted: false, installed: true, safe: true }, 'remove'],
    [{ wanted: false, installed: true, safe: false }, 'defer'],
  ] as const)('%o -> %s', (state, action) => {
    expect(decideVisualizerAction(state)).toBe(action);
  });
});

describe('hasVisualizerFilter', () => {
  it('finds an enabled filter with the label', () => {
    expect(hasVisualizerFilter([{ name: 'lavfi', label: VISUALIZER_FILTER_LABEL, enabled: true }])).toBe(true);
  });

  it('treats a filter mpv disabled as missing, so it gets re-added', () => {
    expect(hasVisualizerFilter([{ name: 'lavfi', label: VISUALIZER_FILTER_LABEL, enabled: false }])).toBe(false);
  });

  it('ignores other filters and an unreadable list', () => {
    expect(hasVisualizerFilter([{ name: 'lavfi', label: 'user-eq' }])).toBe(false);
    expect(hasVisualizerFilter(null)).toBe(false);
    expect(hasVisualizerFilter([null, 'x'])).toBe(false);
  });
});

describe('mpvBuildId', () => {
  it('names a build from the two version properties, and nothing from a missing one', () => {
    expect(mpvBuildId('mpv v0.41.0-244-gaf9c81fa1', 'N-123099-g862338fe3')).toBe(BUILD);
    expect(mpvBuildId('mpv v0.41.0', null)).toBeNull();
    expect(mpvBuildId('', 'n7.1')).toBeNull();
  });
});

describe('validateVisualizerFilter', () => {
  beforeEach(() => {
    resetVisualizerValidationsForTests();
    spawnMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes with the build mpv --version names, and caches the result per binary', async () => {
    const { check, version } = queueRuns();

    const first = validateVisualizerFilter('/usr/bin/mpv');
    const second = validateVisualizerFilter('/usr/bin/mpv');
    check.emit('close', 0);
    answerVersion(version);

    await expect(first).resolves.toEqual({ ok: true, build: BUILD });
    expect(second).toBe(first);
    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(settledVisualizerValidation('/usr/bin/mpv')).toEqual({ ok: true, build: BUILD });
    const checkArgs = spawnMock.mock.calls.map((call) => call[1] as string[]).find((args) => args[0] !== '--version');
    expect(checkArgs).toContain(`--af=${visualizerFilterSpec()}`);
    expect(checkArgs).toContain('--ao-null-untimed');
  });

  it('rejects with the first line mpv printed, and keeps the rejection', async () => {
    vi.useFakeTimers();
    const { check, version } = queueRuns();

    const validation = validateVisualizerFilter('/usr/bin/mpv');
    check.stderr.emit('data', Buffer.from("[ffmpeg] AVFilterGraph: No such filter: 'astats'\n[lavfi] parsing the filter graph failed\n"));
    check.emit('close', 2);
    answerVersion(version);
    await expect(validation).resolves.toEqual({ ok: false, reason: "[ffmpeg] AVFilterGraph: No such filter: 'astats'", retry: false });

    await vi.advanceTimersByTimeAsync(MPV_VISUALIZER_VALIDATE_RETRY_MS);
    expect(validateVisualizerFilter('/usr/bin/mpv')).toBe(validation);
  });

  it('rejects a build whose mpv --version names no versions', async () => {
    const { check, version } = queueRuns();

    const validation = validateVisualizerFilter('/usr/bin/mpv');
    check.emit('close', 0);
    answerVersion(version, 'something else entirely\n');

    await expect(validation).resolves.toMatchObject({ ok: false, retry: false });
  });

  it('runs again after the retry delay when the binary could not start', async () => {
    vi.useFakeTimers();
    const { check, version } = queueRuns();

    const validation = validateVisualizerFilter('/missing/mpv');
    check.emit('error', new Error('spawn /missing/mpv ENOENT'));
    version.emit('error', new Error('spawn /missing/mpv ENOENT'));
    await expect(validation).resolves.toEqual({ ok: false, reason: 'spawn /missing/mpv ENOENT', retry: true });
    expect(validateVisualizerFilter('/missing/mpv')).toBe(validation);

    await vi.advanceTimersByTimeAsync(MPV_VISUALIZER_VALIDATE_RETRY_MS);
    expect(settledVisualizerValidation('/missing/mpv')).toBeUndefined();
    queueRuns();
    expect(validateVisualizerFilter('/missing/mpv')).not.toBe(validation);
    expect(spawnMock).toHaveBeenCalledTimes(4);
  });

  it('kills a run that hangs and marks it for a retry', async () => {
    vi.useFakeTimers();
    const { check, version } = queueRuns();

    const validation = validateVisualizerFilter('/usr/bin/mpv');
    answerVersion(version);
    await vi.advanceTimersByTimeAsync(MPV_VISUALIZER_VALIDATE_TIMEOUT_MS);

    await expect(validation).resolves.toMatchObject({ ok: false, retry: true });
    expect(check.kill).toHaveBeenCalled();
  });

  it('fails without a run when no binary is configured', async () => {
    await expect(validateVisualizerFilter(null)).resolves.toEqual({ ok: false, reason: 'no mpv binary is configured', retry: false });
    expect(spawnMock).not.toHaveBeenCalled();
    expect(settledVisualizerValidation(null)).toBeUndefined();
  });
});
