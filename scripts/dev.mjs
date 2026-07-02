#!/usr/bin/env node
// Launch one napplet's Vite dev server for local development.
//
//   pnpm dev [name]            # Vite dev server (fast UI iteration, no host shell)
//
// `name` is optional when the workspace has exactly one napplet. There is no host
// shell in this workspace — SDK calls that need a host won't resolve under bare
// `pnpm dev`; use `pnpm test:conformance` to exercise a napplet in a real
// `allow-scripts` iframe with a conformance harness.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nappletsDir = join(root, 'napplets');

const args = process.argv.slice(2);
const name = args.find((arg) => !arg.startsWith('-'));

const napplets = existsSync(nappletsDir)
  ? readdirSync(nappletsDir).filter((d) => existsSync(join(nappletsDir, d, 'package.json')))
  : [];

let target = name;
if (!target) {
  if (napplets.length === 1) {
    target = napplets[0];
  } else if (napplets.length === 0) {
    console.error('No napplets yet. Scaffold one: pnpm new <name>');
    process.exit(1);
  } else {
    console.error('Multiple napplets — pick one: pnpm dev <name>');
    console.error(napplets.map((n) => `  ${n}`).join('\n'));
    process.exit(1);
  }
}

if (!napplets.includes(target)) {
  console.error(`No napplet "napplets/${target}". Available: ${napplets.join(', ') || '(none)'}`);
  process.exit(1);
}

const result = spawnSync('pnpm', ['--filter', target, 'dev'], { stdio: 'inherit', cwd: root });
process.exit(result.status ?? 0);
