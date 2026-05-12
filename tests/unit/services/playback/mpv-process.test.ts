/**
 * Navidrome MCP Server - mpv-process unit tests
 * Copyright (C) 2025
 *
 * Covers production-hardening changes from docs/review/02 batch C:
 *   - M1: socket path prefers XDG_RUNTIME_DIR when set
 *   - M6: attachLineLogger caps the partial-line buffer at 64KB
 *
 * The real mpv binary is exercised by tests/integration/playback/.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const { getDefaultIpcPath, spawnMpv } = await import('../../../../src/services/playback/mpv-process.js');

interface MockableProcess {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
}

describe('getDefaultIpcPath', () => {
  let originalXdg: string | undefined;
  let originalUser: string | undefined;

  beforeEach(() => {
    originalXdg = process.env['XDG_RUNTIME_DIR'];
    originalUser = process.env['USER'];
    delete process.env['XDG_RUNTIME_DIR'];
  });

  afterEach(() => {
    if (originalXdg !== undefined) {
      process.env['XDG_RUNTIME_DIR'] = originalXdg;
    } else {
      delete process.env['XDG_RUNTIME_DIR'];
    }
    if (originalUser !== undefined) {
      process.env['USER'] = originalUser;
    }
  });

  it('uses /tmp/... when XDG_RUNTIME_DIR is unset', () => {
    delete process.env['XDG_RUNTIME_DIR'];
    const path = getDefaultIpcPath();
    if ((process as MockableProcess).platform === 'win32') {
      // Windows path is independent of XDG; just sanity-check the prefix.
      expect(path).toContain('\\\\.\\pipe\\navidrome-mcp-mpv-');
      return;
    }
    expect(path).toMatch(/^\/tmp\/navidrome-mcp-mpv-.*\.sock$/);
  });

  it('uses /tmp/... when XDG_RUNTIME_DIR is empty / whitespace', () => {
    process.env['XDG_RUNTIME_DIR'] = '   ';
    const path = getDefaultIpcPath();
    if ((process as MockableProcess).platform === 'win32') return;
    expect(path).toMatch(/^\/tmp\/navidrome-mcp-mpv-.*\.sock$/);
  });

  it('uses XDG_RUNTIME_DIR when set on POSIX', () => {
    if ((process as MockableProcess).platform === 'win32') return;
    process.env['XDG_RUNTIME_DIR'] = '/run/user/1000';
    const path = getDefaultIpcPath();
    expect(path).toMatch(/^\/run\/user\/1000\/navidrome-mcp-mpv-.*\.sock$/);
  });

  it('strips trailing slashes from XDG_RUNTIME_DIR', () => {
    if ((process as MockableProcess).platform === 'win32') return;
    process.env['XDG_RUNTIME_DIR'] = '/run/user/1000///';
    const path = getDefaultIpcPath();
    expect(path).toMatch(/^\/run\/user\/1000\/navidrome-mcp-mpv-.*\.sock$/);
    expect(path).not.toContain('//navidrome-mcp');
  });

  it('returns a stable path between calls (no race on env reads)', () => {
    if ((process as MockableProcess).platform === 'win32') return;
    process.env['XDG_RUNTIME_DIR'] = '/run/user/1000';
    expect(getDefaultIpcPath()).toBe(getDefaultIpcPath());
  });
});

// ---------- attachLineLogger buffer cap (M6) ----------

interface FakeChild {
  stdout: EventEmitter;
  stderr: EventEmitter;
  on: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  unref: ReturnType<typeof vi.fn>;
}

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

const { spawn: mockedSpawn } = await import('node:child_process');

describe('attachLineLogger buffer cap (M6)', () => {
  let child: FakeChild;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const stdout = new EventEmitter();
    (stdout as unknown as { setEncoding: () => void }).setEncoding = (): void => undefined;
    const stderr = new EventEmitter();
    (stderr as unknown as { setEncoding: () => void }).setEncoding = (): void => undefined;
    child = {
      stdout,
      stderr,
      on: vi.fn(),
      kill: vi.fn(),
      unref: vi.fn(),
    };
    (mockedSpawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(child);

    const loggerMod = await import('../../../../src/utils/logger.js');
    warnSpy = vi.spyOn(loggerMod.logger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('drops the buffer and logs once when partial line exceeds 64KB', () => {
    spawnMpv('/fake/mpv', '/tmp/fake.sock');
    // Push 70KB of data with no newline. Should trigger the cap exactly once.
    const chunk = 'x'.repeat(70 * 1024);
    child.stdout.emit('data', chunk);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warnArg = warnSpy.mock.calls[0]?.[0] as string;
    expect(warnArg).toContain('mpv:stdout');
    expect(warnArg).toContain('truncated');
    expect(warnArg).toContain('65536');
  });

  it('does not warn for normal line-delimited output', () => {
    spawnMpv('/fake/mpv', '/tmp/fake.sock');
    child.stdout.emit('data', 'line one\nline two\n');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('continues forwarding new lines after a buffer cap event', () => {
    spawnMpv('/fake/mpv', '/tmp/fake.sock');
    // Cap once
    child.stdout.emit('data', 'x'.repeat(70 * 1024));
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // Subsequent normal output is processed without further warnings
    child.stdout.emit('data', 'short\n');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('caps stderr buffer independently from stdout', () => {
    spawnMpv('/fake/mpv', '/tmp/fake.sock');
    child.stderr.emit('data', 'y'.repeat(70 * 1024));
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warnArg = warnSpy.mock.calls[0]?.[0] as string;
    expect(warnArg).toContain('mpv:stderr');
  });
});
