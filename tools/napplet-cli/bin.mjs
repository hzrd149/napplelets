#!/usr/bin/env node
// Launcher for @napplet/cli.
//
// @napplet/cli is a Deno tool (no Node bin) that lives in the `napplet/` git
// submodule. Running it straight from source means napplets always exercise the
// latest submodule CLI. This launcher is linked into every napplet as the
// `napplet` bin (via a workspace devDependency), so package scripts can call
// e.g. `napplet conformance` / `napplet deploy` and it runs in the napplet's own
// working directory.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// import.meta.url resolves to this real file even when invoked through the
// node_modules/.bin symlink, so the submodule path is stable regardless of which
// napplet runs it.
const cli = fileURLToPath(new URL('../../napplet/packages/cli/src/cli.ts', import.meta.url));

if (!existsSync(cli)) {
  console.error(
    `napplet: @napplet/cli source not found at ${cli}.\n` +
      'Ensure the napplet/ git submodule is initialized: git submodule update --init.',
  );
  process.exit(1);
}

// Permissions mirror @napplet/cli's own shebang (read/write/run/env/net) — enough
// for conformance, discover, debug, deploy, and keys.
const result = spawnSync(
  'deno',
  [
    'run',
    '--allow-read',
    '--allow-write',
    '--allow-run',
    '--allow-env',
    '--allow-net',
    cli,
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
