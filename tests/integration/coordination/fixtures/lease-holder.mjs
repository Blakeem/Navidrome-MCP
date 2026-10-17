// Stands in for a second MCP server that finds the running player and holds a lease on it.
// Killing this harness closes the lease socket.
//
// argv: <distWebMain> <storePath>
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [distWebMain, storePath] = process.argv.slice(2);

process.env.NAVIDROME_CONFIG_PATH = storePath;
delete process.env.NAVIDROME_DEV;

const store = JSON.parse(readFileSync(storePath, 'utf8'));
const port = store.webui?.port;
const host = store.webui?.host ?? '127.0.0.1';

const { ensureWebForPlayback } = await import(pathToFileURL(join(dirname(distWebMain), 'spawn.js')).href);
const status = await ensureWebForPlayback({ features: { playback: true }, webui: { enabled: true, port, host } });
if (status !== 'running') process.exit(1);
process.stdout.write('lease-held\n');

// The lease socket is unref'd, so this interval is what keeps the harness alive.
const keepAlive = setInterval(() => {}, 1 << 30);
const die = () => {
  clearInterval(keepAlive);
  process.exit(0);
};
process.on('SIGTERM', die);
process.on('SIGINT', die);
