#!/usr/bin/env node
// Launcher for @napplet/cli.
//
// @napplet/cli is a Deno tool published to JSR. This launcher is linked into the
// root workspace as the `napplet` bin, so scripts can call e.g. `napplet
// conformance` / `napplet deploy` without depending on the napplet/ submodule.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Use pnpm's installed version rather than an unversioned JSR URL, which can
// resolve to an older release in Deno's independent registry cache.
const cliPath = fileURLToPath(import.meta.resolve('@napplet/cli/cli'));

// Permissions mirror @napplet/cli's own shebang (read/write/run/env/net) — enough
// for conformance, discover, debug, deploy, and keys.
const result = spawnSync(
  'deno',
  [
    'run',
    '--no-config',
    '--no-lock',
    '--node-modules-dir=manual',
    '--allow-read',
    '--allow-write',
    '--allow-run',
    '--allow-env',
    '--allow-net',
    cliPath,
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit' },
);

if (result.error) {
  if (result.error.code === 'ENOENT') {
    console.error(
      'napplet: Deno is required to run @napplet/cli — install it from https://deno.com',
    );
    process.exit(127);
  }
  throw result.error;
}
process.exit(result.status ?? 0);
