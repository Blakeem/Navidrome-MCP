#!/usr/bin/env node
/**
 * Copies static frontend assets into the compiled tsc output. tsc itself only
 * ever moves .ts/.js files, so without this hop the production servers would
 * not be able to find their HTML/CSS/JS after `pnpm build`.
 *
 * Covers both the player web UI (src/webui/public) and the settings app
 * (src/config-app/public).
 *
 * Idempotent. Safe to run repeatedly; cpSync with recursive: true overwrites.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');

const bundles = [
  ['src/webui/public', 'dist/webui/public'],
  ['src/config-app/public', 'dist/config-app/public'],
];

for (const [srcRel, destRel] of bundles) {
  const src = join(projectRoot, srcRel);
  const dest = join(projectRoot, destRel);
  if (!existsSync(src)) {
    console.error(`[build-webui] source not found: ${src}`);
    process.exit(1);
  }
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`[build-webui] copied ${src} -> ${dest}`);
}
