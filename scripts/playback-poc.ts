/**
 * Playback POC — standalone proof of concept for mpv-driven local audio.
 *
 * Run:
 *   pnpm tsx scripts/playback-poc.ts
 *
 * What it does:
 *   1. Loads NAVIDROME_URL/USERNAME/PASSWORD from .env
 *   2. Authenticates against Navidrome (Subsonic /rest/ping)
 *   3. Picks the first 3 songs from a broad search
 *   4. Spawns headless mpv with a JSON-IPC server (Unix socket / Windows pipe)
 *   5. Connects, observes properties (playlist-pos, time-pos, pause, idle-active)
 *   6. Loads the 3 songs into mpv's playlist
 *   7. Runs a scripted demo: play -> seek -> pause -> resume -> skip -> volume -> exit
 *
 * No code from the MCP server is imported. This is intentionally self-contained
 * so we can validate the mpv-IPC layer in isolation before adopting it.
 *
 * Requires: mpv installed and on PATH.
 *   Linux:   sudo apt install mpv
 *   Windows: winget install mpv  (or scoop install mpv)
 *   macOS:   brew install mpv
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection, type Socket } from 'node:net';
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { config as loadEnv } from 'dotenv';

loadEnv();

const NAVIDROME_URL = mustEnv('NAVIDROME_URL').replace(/\/$/, '');
const NAVIDROME_USERNAME = mustEnv('NAVIDROME_USERNAME');
const NAVIDROME_PASSWORD = mustEnv('NAVIDROME_PASSWORD');

const TRANSCODE_FORMAT = 'mp3';
const TRANSCODE_BITRATE = '192';

const IPC_PATH = process.platform === 'win32'
  ? `\\\\.\\pipe\\navidrome-mcp-poc-${process.pid}`
  : `/tmp/navidrome-mcp-poc-${process.pid}.sock`;

// ---------- helpers ----------

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

function log(section: string, msg: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] ${section.padEnd(8)} ${msg}`);
}

// ---------- Navidrome (Subsonic) helpers ----------

function subsonicUrl(endpoint: string, params: Record<string, string> = {}): string {
  const qs = new URLSearchParams({
    u: NAVIDROME_USERNAME,
    p: NAVIDROME_PASSWORD,
    v: '1.16.1',
    c: 'navidrome-mcp-poc',
    f: 'json',
    ...params,
  });
  return `${NAVIDROME_URL}/rest${endpoint}?${qs.toString()}`;
}

interface SubsonicSong {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  duration?: number;
}

async function pickTestSongs(count: number): Promise<SubsonicSong[]> {
  // search3 is the modern endpoint; an empty query with songCount returns recent songs
  const res = await fetch(subsonicUrl('/search3', {
    query: '""',
    songCount: String(count),
    artistCount: '0',
    albumCount: '0',
  }));
  if (!res.ok) throw new Error(`Navidrome search failed: HTTP ${res.status}`);
  const data = await res.json() as {
    'subsonic-response'?: {
      status?: string;
      searchResult3?: { song?: SubsonicSong[] };
      error?: { message?: string };
    };
  };
  const body = data['subsonic-response'];
  if (body?.status !== 'ok') {
    throw new Error(`Subsonic error: ${body?.error?.message ?? 'unknown'}`);
  }
  const songs = body.searchResult3?.song ?? [];
  if (songs.length === 0) throw new Error('No songs returned from search');
  return songs.slice(0, count);
}

function streamUrl(songId: string): string {
  return subsonicUrl('/stream', {
    id: songId,
    format: TRANSCODE_FORMAT,
    maxBitRate: TRANSCODE_BITRATE,
  });
}

// ---------- mpv IPC client ----------

type IpcResponse = { request_id: number; error: string; data?: unknown };
type IpcEvent = { event: string; [k: string]: unknown };
type Pending = { resolve: (data: unknown) => void; reject: (e: Error) => void };

class MpvIpc {
  private socket!: Socket;
  private buffer = '';
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private eventHandlers: ((event: IpcEvent) => void)[] = [];

  async connect(path: string, retries = 30): Promise<void> {
    for (let i = 0; i < retries; i++) {
      try {
        await this.tryConnect(path);
        return;
      } catch {
        await sleep(100);
      }
    }
    throw new Error(`Could not connect to mpv IPC at ${path}`);
  }

  private tryConnect(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = createConnection({ path });
      sock.once('connect', () => {
        this.socket = sock;
        sock.on('data', (chunk) => this.onData(chunk.toString('utf8')));
        sock.on('error', (e) => log('IPC', `socket error: ${e.message}`));
        resolve();
      });
      sock.once('error', reject);
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let msg: IpcResponse | IpcEvent;
      try {
        msg = JSON.parse(line);
      } catch {
        log('IPC', `non-JSON line: ${line}`);
        continue;
      }
      if ('request_id' in msg && this.pending.has(msg.request_id)) {
        const p = this.pending.get(msg.request_id)!;
        this.pending.delete(msg.request_id);
        if (msg.error === 'success') p.resolve(msg.data);
        else p.reject(new Error(`mpv error: ${msg.error}`));
      } else if ('event' in msg) {
        for (const h of this.eventHandlers) h(msg);
      }
    }
  }

  command(...args: (string | number | boolean)[]): Promise<unknown> {
    const id = this.nextId++;
    const payload = JSON.stringify({ command: args, request_id: id }) + '\n';
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.write(payload);
    });
  }

  onEvent(handler: (event: IpcEvent) => void): void {
    this.eventHandlers.push(handler);
  }

  close(): void {
    this.socket?.end();
  }
}

// ---------- mpv process ----------

function spawnMpv(): ChildProcess {
  const args = [
    '--idle=yes',
    '--no-video',
    '--no-terminal',
    '--no-config',
    '--load-scripts=no',
    '--gapless-audio=yes',
    '--prefetch-playlist=yes',
    `--input-ipc-server=${IPC_PATH}`,
    '--volume=80',
  ];
  const proc = spawn('mpv', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => log('mpv-out', d.toString().trim()));
  proc.stderr?.on('data', (d) => log('mpv-err', d.toString().trim()));
  proc.on('exit', (code, signal) => log('mpv', `exited code=${code} signal=${signal}`));
  return proc;
}

// ---------- demo sequence ----------

async function main(): Promise<void> {
  log('boot', `IPC path: ${IPC_PATH}`);

  log('boot', 'fetching test songs from Navidrome...');
  const songs = await pickTestSongs(3);
  songs.forEach((s, i) => log('songs', `${i}: ${s.artist ?? '?'} — ${s.title} (${s.duration ?? '?'}s) [${s.id}]`));

  log('boot', 'spawning mpv...');
  const proc = spawnMpv();
  proc.on('error', (e) => {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      console.error('\nmpv not found on PATH. Install it:');
      console.error('  Linux:   sudo apt install mpv');
      console.error('  Windows: winget install mpv');
      console.error('  macOS:   brew install mpv\n');
      process.exit(1);
    }
    throw e;
  });

  const ipc = new MpvIpc();
  await ipc.connect(IPC_PATH);
  log('boot', 'IPC connected');

  ipc.onEvent((evt) => {
    if (evt.event === 'property-change') {
      log('property', `${String(evt['name'])} = ${JSON.stringify(evt['data'])}`);
    } else {
      log('event', `${evt.event}${evt['reason'] ? ` (${String(evt['reason'])})` : ''}`);
    }
  });

  await ipc.command('observe_property', 1, 'playlist-pos');
  await ipc.command('observe_property', 2, 'pause');
  await ipc.command('observe_property', 3, 'idle-active');
  await ipc.command('observe_property', 4, 'media-title');
  // time-pos updates a lot; skip observing in POC to keep log readable

  log('demo', 'loading 3 songs into playlist...');
  await ipc.command('loadfile', streamUrl(songs[0]!.id), 'replace');
  await ipc.command('loadfile', streamUrl(songs[1]!.id), 'append');
  await ipc.command('loadfile', streamUrl(songs[2]!.id), 'append');

  await sleep(8000);

  log('demo', 'reading time-pos directly...');
  const t = await ipc.command('get_property', 'time-pos');
  log('demo', `time-pos = ${t}s`);

  log('demo', 'seek +30s...');
  await ipc.command('seek', 30, 'relative');
  await sleep(3000);

  log('demo', 'pause');
  await ipc.command('set_property', 'pause', true);
  await sleep(2000);

  log('demo', 'resume');
  await ipc.command('set_property', 'pause', false);
  await sleep(3000);

  log('demo', 'skip to next track');
  await ipc.command('playlist-next');
  await sleep(5000);

  log('demo', 'volume to 40');
  await ipc.command('set_property', 'volume', 40);
  await sleep(2000);

  log('demo', 'reading current playlist...');
  const playlist = await ipc.command('get_property', 'playlist');
  log('demo', `playlist length: ${Array.isArray(playlist) ? playlist.length : '?'}`);

  log('demo', 'clearing and exiting');
  await ipc.command('playlist-clear');
  await ipc.command('quit');

  ipc.close();
  await sleep(500);
  if (process.platform !== 'win32' && existsSync(IPC_PATH)) {
    await unlink(IPC_PATH).catch(() => undefined);
  }
  log('boot', 'done');
}

main().catch((e) => {
  console.error('POC failed:', e);
  process.exit(1);
});
