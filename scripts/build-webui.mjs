#!/usr/bin/env node
// tsc emits only compiled .ts output, so the static web assets need this copy into dist/.
// Each destination is cleared first, so a file removed from its source also leaves dist/.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
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
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`[build-webui] copied ${src} -> ${dest}`);
}
