// Points every test file at a throwaway settings.json, so the suite never touches the real store.
// The seed copies the real credentials, so the temp store is deleted once its file finishes.

import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import { buildFormSeed } from '../../src/config/env-settings.js';
import { writeSettings, type SettingsFile } from '../../src/config/store.js';

// A worker that reruns this file would otherwise seed from its own redirected temp store.
const seedCache = globalThis as { navidromeTestSeed?: SettingsFile };
seedCache.navidromeTestSeed ??= buildFormSeed();

const storePath = join(tmpdir(), `navidrome-mcp-test-${process.pid}.json`);
process.env['NAVIDROME_CONFIG_PATH'] = storePath;
writeSettings(seedCache.navidromeTestSeed);

afterAll(() => {
  rmSync(storePath, { force: true });
});
