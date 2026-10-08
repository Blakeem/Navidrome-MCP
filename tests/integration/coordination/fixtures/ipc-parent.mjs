// Test harness: stands in for the MCP server by running the real spawnWebChild
// (through ensureWebForPlayback in dist/web/spawn.js) instead of mirroring its
// spawn options. Killing this harness closes the IPC channel, so the web child
// receives `disconnect`, which is what we assert on (stop-with-parent when
// persist off, survive when persist on).
//
// argv: <distWebMain> <storePath> [exit-after-spawn]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [distWebMain, storePath, mode] = process.argv.slice(2);

process.env.NAVIDROME_CONFIG_PATH = storePath;
process.env.NAVIDROME_WEB_AUTO_OPEN = '0';
// NAVIDROME_DEV would switch the launch target from dist/web/main.js to the TS source.
delete process.env.NAVIDROME_DEV;

const store = JSON.parse(readFileSync(storePath, 'utf8'));
const port = store.webui?.port;
const host = store.webui?.host ?? '127.0.0.1';

const { ensureWebForPlayback } = await import(pathToFileURL(join(dirname(distWebMain), 'spawn.js')).href);
const status = await ensureWebForPlayback({ features: { playback: true }, webui: { enabled: true, port, host } });
if (status !== 'spawned') process.exit(1);
// Lets a test exit the parent before the child installs its 'disconnect' listener.
if (mode === 'exit-after-spawn') process.exit(0);

// Keep the harness (and the IPC channel) alive until we're told to exit.
const keepAlive = setInterval(() => {}, 1 << 30);
const die = () => {
  clearInterval(keepAlive);
  process.exit(0);
};
process.on('SIGTERM', die);
process.on('SIGINT', die);
