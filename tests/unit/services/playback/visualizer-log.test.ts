import { describe, expect, it } from 'vitest';
import { VISUALIZER_BAND_COUNT } from '../../../../src/services/playback/visualizer-filter.js';
import { VisualizerLogParser } from '../../../../src/services/playback/visualizer-log.js';

// Shaped like the lines mpv 0.41 forwarded from the filter: one frame line, then one line per band.
function frameLines(frame: number, ptsTime: string, levels: readonly string[], filter = 'Parsed_ametadata_40'): Array<{ prefix: string; text: string }> {
  return [
    { prefix: 'ffmpeg', text: `${filter}: frame:${String(frame).padEnd(4)} pts:${frame * 1024}     pts_time:${ptsTime}\n` },
    ...levels.map((level, i) => ({ prefix: 'ffmpeg', text: `${filter}: lavfi.astats.${i + 1}.RMS_level=${level}\n` })),
  ];
}

const LEVELS = Array.from({ length: VISUALIZER_BAND_COUNT }, (_, i) => (-20 - i).toFixed(6));

function feed(parser: VisualizerLogParser, lines: Array<{ prefix: string; text: string }>): unknown[] {
  return lines.map((line) => parser.push(line)).filter((record) => record !== null);
}

describe('VisualizerLogParser', () => {
  it('builds one record from a frame line and its band lines', () => {
    const records = feed(new VisualizerLogParser(), frameLines(0, '0', LEVELS));

    expect(records).toEqual([{
      segment: 1,
      ptsSeconds: 0,
      levels: Array.from({ length: VISUALIZER_BAND_COUNT }, (_, i) => -20 - i),
    }]);
  });

  it('keeps grouping when another FFmpeg line lands between the frame and its bands', () => {
    const lines = frameLines(3, '0.069660', LEVELS);
    lines.splice(4, 0, { prefix: 'ffmpeg', text: 'Parsed_amerge_19: No channel layout for input 1\n' });

    expect(feed(new VisualizerLogParser(), lines)).toHaveLength(1);
  });

  it('ignores band lines from another filter instance and astats summary lines', () => {
    const parser = new VisualizerLogParser();
    const lines = frameLines(0, '0', LEVELS);
    const stray = { prefix: 'ffmpeg', text: 'Parsed_ametadata_7: lavfi.astats.1.RMS_level=-3.0\n' };
    const summary = { prefix: 'ffmpeg', text: 'Parsed_astats_39: Channel: 1\n' };

    expect(feed(parser, [lines[0]!, stray, summary, ...lines.slice(1)])).toHaveLength(1);
  });

  it('maps -inf to the floor, clamps above 0 dB and rounds to whole decibels', () => {
    const levels = [...LEVELS];
    levels[0] = '-inf';
    levels[1] = '0.4';
    levels[2] = '-12.6';
    const [record] = feed(new VisualizerLogParser(), frameLines(0, '0', levels)) as Array<{ levels: number[] }>;

    expect(record?.levels.slice(0, 3)).toEqual([-100, 0, -13]);
  });

  it('drops a half-built record after a buffer overflow line', () => {
    const parser = new VisualizerLogParser();
    const lines = frameLines(0, '0', LEVELS);
    const overflow = { prefix: 'overflow', text: 'log message buffer overflow: 12 messages skipped\n' };

    expect(feed(parser, [...lines.slice(0, 5), overflow, ...lines.slice(5)])).toHaveLength(0);
  });

  it('drops a record whose bands never all arrive when the next frame starts', () => {
    const parser = new VisualizerLogParser();
    const records = feed(parser, [...frameLines(0, '0', LEVELS).slice(0, 9), ...frameLines(1, '0.023220', LEVELS)]);

    expect(records).toEqual([expect.objectContaining({ ptsSeconds: 0.02322 })]);
  });

  it('starts a new segment when timestamps restart, which marks a new file', () => {
    const parser = new VisualizerLogParser();
    const records = feed(parser, [
      ...frameLines(0, '0', LEVELS),
      ...frameLines(1, '0.023220', LEVELS),
      ...frameLines(0, '0', LEVELS),
      ...frameLines(5, '42.5', LEVELS),
      ...frameLines(6, '12.0', LEVELS),
    ]) as Array<{ segment: number }>;

    expect(records.map((record) => record.segment)).toEqual([1, 1, 2, 2, 3]);
  });

  it('skips a frame with no timestamp and lines that are not from FFmpeg', () => {
    const parser = new VisualizerLogParser();
    const lines = frameLines(0, 'NOPTS', LEVELS).concat({ prefix: 'cplayer', text: 'Parsed_ametadata_40: frame:1 pts:0 pts_time:0\n' });

    expect(feed(parser, lines)).toHaveLength(0);
    expect(parser.push({ prefix: 'ffmpeg', text: 42 })).toBeNull();
  });

  it('forgets a half-built record on reset', () => {
    const parser = new VisualizerLogParser();
    const lines = frameLines(0, '0', LEVELS);
    feed(parser, lines.slice(0, 4));
    parser.reset();

    expect(feed(parser, lines.slice(4))).toHaveLength(0);
  });
});
