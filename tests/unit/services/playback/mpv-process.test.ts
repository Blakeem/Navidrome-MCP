/**
 * Navidrome MCP Server - mpv-process unit tests
 * Copyright (C) 2025
 *
 * Covers production-hardening changes from docs/review/02 batch C:
 *   - M1: socket path prefers XDG_RUNTIME_DIR when set
 *   - mpv binary resolution rejects directories and the mpv.com wrapper
 *
 * The real mpv binary is exercised by tests/integration/playback/.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { withPlatform } from '../../../helpers/platform.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn() };
});

const { spawn } = await import('node:child_process');
const { logger } = await import('../../../../src/utils/logger.js');
const { getDefaultIpcPath, resolveMpvBinary, spawnMpv } = await import('../../../../src/services/playback/mpv-process.js');

interface MockableProcess {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe('getDefaultIpcPath', () => {
  let originalXdg: string | undefined;
  let originalUser: string | undefined;
  let originalUsername: string | undefined;

  beforeEach(() => {
    originalXdg = process.env['XDG_RUNTIME_DIR'];
    originalUser = process.env['USER'];
    originalUsername = process.env['USERNAME'];
    delete process.env['XDG_RUNTIME_DIR'];
  });

  afterEach(() => {
    restoreEnv('XDG_RUNTIME_DIR', originalXdg);
    restoreEnv('USER', originalUser);
    restoreEnv('USERNAME', originalUsername);
  });

  it('uses /tmp/... when XDG_RUNTIME_DIR is unset', async () => {
    const path = await withPlatform('linux', () => getDefaultIpcPath());
    expect(path).toMatch(/^\/tmp\/navidrome-mcp-mpv-.*\.sock$/);
  });

  it('uses /tmp/... when XDG_RUNTIME_DIR is empty / whitespace', async () => {
    process.env['XDG_RUNTIME_DIR'] = '   ';
    const path = await withPlatform('linux', () => getDefaultIpcPath());
    expect(path).toMatch(/^\/tmp\/navidrome-mcp-mpv-.*\.sock$/);
  });

  it('uses XDG_RUNTIME_DIR when set on POSIX', async () => {
    process.env['XDG_RUNTIME_DIR'] = '/run/user/1000';
    const path = await withPlatform('linux', () => getDefaultIpcPath());
    expect(path).toMatch(/^\/run\/user\/1000\/navidrome-mcp-mpv-.*\.sock$/);
  });

  it('strips trailing slashes from XDG_RUNTIME_DIR', async () => {
    process.env['XDG_RUNTIME_DIR'] = '/run/user/1000///';
    const path = await withPlatform('linux', () => getDefaultIpcPath());
    expect(path).toMatch(/^\/run\/user\/1000\/navidrome-mcp-mpv-.*\.sock$/);
    expect(path).not.toContain('//navidrome-mcp');
  });

  it('returns a stable path between calls (no race on env reads)', async () => {
    process.env['XDG_RUNTIME_DIR'] = '/run/user/1000';
    const [first, second] = await withPlatform('linux', () => [getDefaultIpcPath(), getDefaultIpcPath()]);
    expect(first).toBe(second);
  });

  it('names a per-user Windows pipe with USERNAME sanitized', async () => {
    process.env['USERNAME'] = 'a b.c';
    const path = await withPlatform('win32', () => getDefaultIpcPath());
    expect(path).toBe('\\\\.\\pipe\\navidrome-mcp-mpv-a_b_c');
  });

  it('sanitizes USER into the socket name when getuid is unavailable', async () => {
    const originalGetuid = Object.getOwnPropertyDescriptor(process, 'getuid');
    Object.defineProperty(process, 'getuid', { value: undefined, configurable: true, writable: true });
    process.env['USER'] = '../x';
    try {
      const path = await withPlatform('linux', () => getDefaultIpcPath());
      expect(path).toBe('/tmp/navidrome-mcp-mpv-___x.sock');
    } finally {
      if (originalGetuid !== undefined) Object.defineProperty(process, 'getuid', originalGetuid);
      else delete (process as { getuid?: unknown }).getuid;
    }
  });
});

describe('spawnMpv', () => {
  it('guards the child against an unhandled error event', () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    const onSpy = vi.spyOn(child, 'on');
    vi.mocked(spawn).mockReturnValue(child as never);
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    try {
      spawnMpv('/fake/mpv', '/tmp/fake.sock');

      expect(onSpy).toHaveBeenCalledWith('error', expect.any(Function));
      expect(() => child.emit('error', new Error('ENOENT'))).not.toThrow();
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe('resolveMpvBinary', () => {
  let tempDir: string;
  let originalPath: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'mpv-resolve-'));
    originalPath = process.env['PATH'];
  });

  afterEach(() => {
    if (originalPath !== undefined) {
      process.env['PATH'] = originalPath;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('rejects a configured path that is a directory', () => {
    expect(resolveMpvBinary(tempDir)).toBeNull();
  });

  it('accepts a configured path that is a file', () => {
    const binary = join(tempDir, 'mpv.exe');
    writeFileSync(binary, '', { mode: 0o755 });
    expect(resolveMpvBinary(binary)).toBe(binary);
  });

  it('auto-detects mpv.exe on a Windows PATH and never the mpv.com wrapper', () => {
    if ((process as MockableProcess).platform !== 'win32') return;
    writeFileSync(join(tempDir, 'mpv.com'), '');
    writeFileSync(join(tempDir, 'mpv.exe'), '');
    process.env['PATH'] = ['', `"${tempDir}"`].join(delimiter);
    expect(resolveMpvBinary(null)).toBe(join(tempDir, 'mpv.exe'));
  });

  it('returns null on a Windows PATH without mpv.exe', () => {
    if ((process as MockableProcess).platform !== 'win32') return;
    writeFileSync(join(tempDir, 'mpv.com'), '');
    process.env['PATH'] = tempDir;
    expect(resolveMpvBinary(null)).toBeNull();
  });
});
