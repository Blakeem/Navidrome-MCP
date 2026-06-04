/**
 * Global test setup: provision a temporary settings.json store.
 *
 * Runtime config now comes exclusively from settings.json (env is no longer a
 * config source). To keep the suite hermetic, this setup file — registered in
 * `vitest.config.ts` `setupFiles`, so it runs before every test file — points
 * `NAVIDROME_CONFIG_PATH` at a throwaway temp file and writes a store seeded
 * from the developer's existing env/.env (or the inline env that `test:ci`
 * injects). The real `~/.config/navidrome-mcp/settings.json` is never touched.
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFormSeed } from '../../src/config/seed.js';
import { writeSettings } from '../../src/config/store.js';

// Build the seed BEFORE redirecting the store path, so it reads the developer's
// real canonical settings.json if present, otherwise falls back to the inline
// env (test:ci) or a legacy .env. This keeps the suite working whether config
// lives in a real store, in env, or in .env.
const seed = buildFormSeed();

// A per-process temp store so parallel workers don't collide, and so the real
// ~/.config store is never mutated. The store helpers read NAVIDROME_CONFIG_PATH
// at call time, so setting it now (after seeding) redirects only the write.
process.env['NAVIDROME_CONFIG_PATH'] = join(tmpdir(), `navidrome-mcp-test-${process.pid}.json`);

// Live tests still skip when SKIP_INTEGRATION_TESTS is set (CI / mock-only runs).
writeSettings(seed);
