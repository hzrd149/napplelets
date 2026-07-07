#!/usr/bin/env node
// Launcher for @napplet/cli.
//
// @napplet/cli is a Deno tool published to JSR. This launcher is linked into the
// root workspace as the `napplet` bin, so scripts can call e.g. `napplet
// conformance` / `napplet deploy` without depending on the napplet/ submodule.
import { spawnSync } from 'node:child_process';

// Permissions mirror @napplet/cli's own shebang (read/write/run/env/net) — enough
// for conformance, discover, debug, deploy, and keys.
const result = spawnSync(
  'deno',
  [
    'run',
    '--no-lock',
    '--minimum-dependency-age=0',
    '--node-modules-dir=auto',
    '--allow-read',
    '--allow-write',
    '--allow-run',
    '--allow-env',
    '--allow-net',
    'jsr:@napplet/cli/cli',
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
