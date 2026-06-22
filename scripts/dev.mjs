#!/usr/bin/env node
// Launch one napplet for local development.
//
//   pnpm dev [name]            # Vite dev server (fast UI iteration, no host shell)
//   pnpm shell [name]          # run inside the Kehto `paja` host shell
//
// `name` is optional when the workspace has exactly one napplet. The shell mode
// runs each napplet's own `shell` script, which launches `kehto paja` wrapping
// the napplet's Vite dev server.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nappletsDir = join(root, 'napplets');

const args = process.argv.slice(2);
const shellMode = args.includes('--shell');
const name = args.find((arg) => !arg.startsWith('-'));
const verb = shellMode ? 'shell' : 'dev';

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
    console.error(`Multiple napplets — pick one: pnpm ${verb} <name>`);
    console.error(napplets.map((n) => `  ${n}`).join('\n'));
    process.exit(1);
  }
}

if (!napplets.includes(target)) {
  console.error(`No napplet "napplets/${target}". Available: ${napplets.join(', ') || '(none)'}`);
  process.exit(1);
}

const script = shellMode ? 'shell' : 'dev';
const result = spawnSync('pnpm', ['--filter', target, script], { stdio: 'inherit', cwd: root });
process.exit(result.status ?? 0);
