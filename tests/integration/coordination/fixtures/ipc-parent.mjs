// Test harness: mimics the MCP server spawning the web player as an IPC child.
// Spawns `dist/web/main.js` with an `ipc` channel (exactly as src/web/spawn.ts
// does), then stays alive until killed. Killing this harness closes the IPC
// channel, so the web child receives `disconnect` — which is what we assert on
// (stop-with-parent when persist off, survive when persist on).
//
// argv: <distWebMain> <storePath>
import { spawn } from 'node:child_process';

const [distWebMain, storePath] = process.argv.slice(2);

const child = spawn(process.execPath, [distWebMain], {
  stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  env: { ...process.env, NAVIDROME_CONFIG_PATH: storePath, NAVIDROME_WEB_AUTO_OPEN: '0' },
});
child.unref();

// Keep the harness (and the IPC channel) alive until we're told to exit.
const keepAlive = setInterval(() => {}, 1 << 30);
const die = () => {
  clearInterval(keepAlive);
  process.exit(0);
};
process.on('SIGTERM', die);
process.on('SIGINT', die);
