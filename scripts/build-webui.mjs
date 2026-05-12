#!/usr/bin/env node
/**
 * Copies the web UI static assets (src/webui/public) into the compiled
 * tsc output (dist/webui/public). tsc itself only ever moves .ts/.js files,
 * so without this hop the production server would not be able to find the
 * frontend after `pnpm build`.
 *
 * Idempotent. Safe to run repeatedly; cpSync with recursive: true overwrites.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');
const src = join(projectRoot, 'src', 'webui', 'public');
const dest = join(projectRoot, 'dist', 'webui', 'public');

if (!existsSync(src)) {
  console.error(`[build-webui] source not found: ${src}`);
  process.exit(1);
}

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`[build-webui] copied ${src} -> ${dest}`);
