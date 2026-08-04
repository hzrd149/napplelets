#!/usr/bin/env node
// Thin wrapper around the official @napplet/boilerplate generator that drops a
// new napplet into this monorepo's napplets/ workspace.
//
//   pnpm new <name> ["Display Title"] [-- <extra generator flags>]
//
// It is exactly `npx @napplet/boilerplate ./napplets/<name> ...` with the
// monorepo target path and sane defaults filled in. Anything after `--` is
// forwarded verbatim to the generator (e.g. --variant, --template, --force).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adoptNapplet } from './lib/adopt.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

// Split off anything after `--` to forward straight to the generator.
const passthroughIndex = argv.indexOf('--');
const ownArgs = passthroughIndex === -1 ? argv : argv.slice(0, passthroughIndex);
const passthrough = passthroughIndex === -1 ? [] : argv.slice(passthroughIndex + 1);

const [rawName, rawTitle] = ownArgs;

if (!rawName) {
  console.error('Usage: pnpm new <name> ["Display Title"] [-- <extra generator flags>]');
  process.exit(1);
}

const name = rawName.trim();
if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
  console.error(
    `Invalid napplet name "${name}". Use lowercase letters, digits, and hyphens (e.g. note-feed).`,
  );
  process.exit(1);
}

const target = join(root, 'napplets', name);
if (existsSync(target) && !passthrough.includes('--force')) {
  console.error(`napplets/${name} already exists. Pick another name or pass -- --force.`);
  process.exit(1);
}

const title =
  rawTitle?.trim() ||
  name
    .split('-')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');

// @napplet/boilerplate >=0.3 dropped --package-name/--napplet-type/--title; it
// now derives the package name from the target directory and always writes
// `nappletType: 'my-napplet'`. adoptNapplet() sets both afterwards, so the only
// flags left here are the ones the generator still understands.
// Run through `pnpm dlx`, not `npx`. @napplet/boilerplate is a scoped package
// whose single bin (`napplet-boilerplate`) does not match its name, and npx
// silently exits 0 without running it — which looked exactly like a generator
// that produced nothing. pnpm is this repo's package manager anyway.
const args = ['dlx', '@napplet/boilerplate', target, '--yes', ...passthrough];

console.log(`Scaffolding napplets/${name} with @napplet/boilerplate...`);
const result = spawnSync('pnpm', args, { stdio: 'inherit', cwd: root });

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

// npx-style silent failure is not hypothetical; fail loudly rather than letting
// adoption throw a bare ENOENT on a directory that was never created.
if (!existsSync(join(target, 'package.json'))) {
  console.error(
    `@napplet/boilerplate exited 0 but produced no napplets/${name}/package.json.\n` +
      'The generator clones its template over the network — check connectivity, then retry.',
  );
  process.exit(1);
}

// Adopt into the monorepo's DRY layout (root guidance replaces standalone copies).
await adoptNapplet(target, { name, title });

console.log('');
console.log(`Created napplets/${name} ("${title}")`);
console.log('Next steps:');
console.log('  pnpm install');
console.log(`  pnpm --filter ${name} dev`);
console.log(`  pnpm --filter ${name} verify`);
