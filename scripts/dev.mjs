#!/usr/bin/env node
// Launch one napplet inside the Paja development runtime with live Vite HMR.
//
//   pnpm dev [name] [--port <p>] [-- <paja flags>]
//
// This boots two things together and wires them up:
//   1. the napplet's own Vite dev server (fast UI iteration, real HMR), and
//   2. Kehto Paja (`kehto paja`) — a single-window runtime that hosts the napplet
//      in a real Kehto iframe with dev adapters for the whole NAP surface
//      (relay/outbox, storage, identity, keys, config, resource, theme, notify,
//      media, upload, intent, cvm, inc), a local dev signer, and a message log.
//
// Paja loads the napplet by `iframe.src = <the live Vite URL>` (not the built
// single-file srcdoc), so Vite's HMR is preserved untouched. Editing napplet
// source hot-updates the running napplet with the host services live.
//
// `name` is optional: with exactly one napplet it's picked automatically, and with
// several the script prompts interactively (when run in a TTY). Extra flags after
// the napplet name (e.g. `--theme light`, `--identity-mode fixed`) are forwarded
// to `kehto paja` to simulate the shell environment — run `pnpm exec kehto paja
// --help` to see them. `pnpm test:conformance` remains the real gate: it loads the
// built single-file napplet in a real `allow-scripts` iframe.
//
// For bare Vite with no host runtime, use `pnpm --filter <name> dev`.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nappletsDir = join(root, 'napplets');

// The Vite dev port for the napplet. We force it (`--strictPort`) so we can hand
// the exact URL to Paja's `--target-url`, instead of guessing which port Vite
// chose. Override with `--port <p>` or the NAPPLET_DEV_PORT env var.
const DEFAULT_DEV_PORT = 5173;

// Split args into: the napplet name (first bare arg), our own `--port <p>`, and
// everything else — which is forwarded verbatim to `kehto paja`.
const argv = process.argv.slice(2);
let name;
let devPort = Number(process.env.NAPPLET_DEV_PORT) || DEFAULT_DEV_PORT;
const pajaArgs = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--port' || arg === '-p') {
    devPort = Number(argv[++i]);
  } else if (arg.startsWith('--port=')) {
    devPort = Number(arg.slice('--port='.length));
  } else if (!arg.startsWith('-') && name === undefined) {
    name = arg;
  } else {
    pajaArgs.push(arg);
  }
}

if (!Number.isInteger(devPort) || devPort <= 0) {
  console.error(`Invalid --port: ${devPort}`);
  process.exit(1);
}

const napplets = existsSync(nappletsDir)
  ? readdirSync(nappletsDir).filter((d) => existsSync(join(nappletsDir, d, 'package.json')))
  : [];

// Prompt the user to pick one of the available napplets. Returns the chosen name.
async function promptForNapplet() {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    console.error('Which napplet do you want to run?');
    napplets.forEach((n, i) => console.error(`  ${i + 1}) ${n}`));
    while (true) {
      const answer = (await rl.question('> ')).trim();
      if (!answer) continue;
      // Accept either the list number or the napplet name.
      const byIndex = Number.parseInt(answer, 10);
      if (Number.isInteger(byIndex) && byIndex >= 1 && byIndex <= napplets.length) {
        return napplets[byIndex - 1];
      }
      if (napplets.includes(answer)) return answer;
      console.error(`Not a valid choice: ${answer}`);
    }
  } finally {
    rl.close();
  }
}

let target = name;
if (!target) {
  if (napplets.length === 1) {
    target = napplets[0];
  } else if (napplets.length === 0) {
    console.error('No napplets yet. Scaffold one: pnpm new <name>');
    process.exit(1);
  } else if (stdin.isTTY) {
    target = await promptForNapplet();
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

const targetUrl = `http://127.0.0.1:${devPort}`;

// `kehto paja --target-url <url> [flags] -- <framework command>`: Paja spawns the
// framework command, waits for <url>, then hosts it in the runtime iframe. We pin
// Vite to the same host/port so the URL is known up front. Run through `pnpm exec`
// so the root-installed `kehto` bin resolves without a global install.
const args = [
  'exec',
  'kehto',
  'paja',
  '--target-url',
  targetUrl,
  ...pajaArgs,
  '--',
  'pnpm',
  '--filter',
  target,
  'exec',
  'vite',
  '--host',
  '127.0.0.1',
  '--port',
  String(devPort),
  '--strictPort',
];

console.error(`Starting Paja + Vite for "${target}" — napplet dev server on ${targetUrl}`);
const result = spawnSync('pnpm', args, { stdio: 'inherit', cwd: root });
process.exit(result.status ?? 0);
