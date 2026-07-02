# napplelets — Agent Guide

This is the single source of truth for both `AGENTS.md` and Claude Code
(`CLAUDE.md` is a symlink to this file).

This is a **monorepo of NIP-5D napplets**. Each package under `napplets/` is one
small, framework-light, single-purpose napplet on the napplet side of the shell
boundary. Keep each napplet small; the host shell composes many of them.

`docs/` is the authoritative authoring context — read `docs/context-map.md`
first to find the smallest set of docs that covers a change.

## What this is

A pnpm monorepo of small **NIP-5D napplets** — sandboxed Nostr web applets. Each
napplet runs inside an `allow-scripts` iframe (loaded via `iframe.srcdoc`, opaque
origin, no `allow-same-origin`) and delegates all privileged work (signing,
relays, storage, external bytes) to a host _shell_ over the NIP-5D JSON-envelope
postMessage wire format. One package per napplet under `napplets/`; the shell
itself is **not** in this repo — only the napplet side of the boundary.

## Repo shape

- `napplets/<name>/` — one napplet per directory (a pnpm workspace package).
- `docs/` — shared, repo-wide NIP-5D authoring context (single source of truth).
- `.codex/skills/` — `napplet-author` and `napplet-verify` skills.
- `scripts/new-napplet.mjs` — scaffolder (+ `scripts/lib/adopt.mjs`).
- `tsconfig.base.json` — every napplet's `tsconfig.json` extends this.
- `pnpm-workspace.yaml` — workspace = `napplets/*`.

## Commands

Workspace-wide (run from root):

```bash
pnpm install              # link all workspace packages (also builds deps via `prepare`)
pnpm dev [name]           # vite dev server for one napplet
pnpm build                # build napplets + their deps in order (Turbo)
pnpm verify               # type-check + build (Turbo)
pnpm type-check           # strict TS across the napplets (Turbo)
pnpm discover             # `napplet discover --all` — list built napplets
pnpm test:conformance     # build, then `napplet conformance --all`
pnpm deploy               # build, then `napplet deploy --all`
pnpm debug                # `napplet debug --all` — read-only deploy/plan diagnostics
```

The `@napplet/*` and `@hyprgate/*` packages live in the `napplet/` and `hyprgate/`
git submodules and are wired in as workspace members (see `pnpm-workspace.yaml`),
so napplets depend on them via `workspace:*` and build against live submodule
source. **Turbo** (`turbo.json`) runs build/type-check in dependency order — `pnpm
build` builds each napplet's `@napplet/*`/`@hyprgate/*` dependencies first (and
`@napplet/conformance-cli`, used by conformance). This is a development workspace:
versions are deliberately **not** pinned or overridden, so napplets are tested
against the real latest resolved versions. There is **no host shell** — exercise
napplets with `pnpm test:conformance`; `pnpm dev` is bare Vite for UI iteration
(SDK calls needing a host won't resolve).

**`@napplet/cli` drives testing/deploy from the repo root, in monorepo mode.** It
is a Deno tool in the `napplet/` submodule with no Node bin, so `tools/napplet-cli`
exposes it as the `napplet` launcher (a root `workspace:*` devDependency) that runs
the submodule CLI source via Deno — **Deno must be installed**. A single root
`.napplet/config.json` sets `discover.roots: ["napplets"]`; the `--all` commands
treat every built napplet folder as its own deploy target (folder name = the
named-site `d` tag, so it must match `^[a-z0-9-]{1,13}$`). Add `relays` and
`blossomServers` to the root `.napplet/config.json` before `pnpm deploy`. Napplets
themselves carry no `.napplet` config or CLI scripts — only `dev`/`build`/
`type-check`/`verify`.

Per-napplet (use pnpm's filter; `<name>` is the dir under `napplets/`):

```bash
pnpm --filter <name> dev                # vite dev server (127.0.0.1)
pnpm --filter <name> verify             # type-check + single-file build
```

There is no unit-test runner; **`test:conformance` is the real test gate**. It
loads the built single-file napplet in a real `allow-scripts` iframe and fails on
a malformed envelope, manifest problem, boot failure, or forbidden-global
reference (`fetch`/`WebSocket`/`localStorage`/`window.nostr`, etc.).

## Adding a napplet

```bash
pnpm new <name> ["Display Title"]   # then: pnpm install
```

Always scaffold — never hand-roll a package — so the single-file build, shim
import, and conformance wiring stay correct. Note the mechanism (the README's
`templates/napplet/` is stale; that directory does not exist): `scripts/new-napplet.mjs`
shells out to `npx @napplet/boilerplate` then runs `scripts/lib/adopt.mjs`, which
strips the generator's per-package copies of `docs/`, `.codex/`, and `LICENSE`
(those live **once at the repo root**) and repoints the new package's `tsconfig.json`
and `AGENTS.md`/`README.md` at the root.

## Before editing napplet behavior

1. Read `docs/context-map.md`.
2. Read `docs/boundaries.md` and `docs/design-patterns.md` for the surface you
   are changing; check `docs/package-surfaces.md` for the right import.
3. If changing protocol assumptions, verify against `docs/nip-5d.md`.
4. If a change seems to need a new NAP name, message domain, or numbered wire
   format, read `docs/new-nap-proposals.md` first.

## Architecture essentials

- **Three packages define the surface** (see `docs/package-surfaces.md`):
  `@napplet/shim` (import once at the entry point as a side effect — installs
  `window.napplet`), `@napplet/sdk` (named helpers: `relay`, `storage`,
  `identity`, `config`, `resource`, `notify`, …; reads `window.napplet` at call
  time), and `@napplet/vite-plugin` (`nip5aManifest`). Granular needs use
  `@napplet/nap/<domain>/sdk` — never import the `@napplet/nap` root.

- **Single-file build is mandatory.** `vite.config.ts` uses `viteSingleFile()` to
  inline all JS/CSS into one `index.html` (the srcdoc iframe has no origin to
  fetch external assets from), and `nip5aManifest({ nappletType, requires, configSchema })`
  to content-address it. The `requires` array declares which NAPs the napplet uses.

- **Manifest aggregate hash:** the built artifact, the `requires` list, and the
  config schema all feed the NIP-5A aggregate hash. Changing any of them changes
  the napplet's identity (and thus storage scoping) — treat such changes as
  intentional.

- **Config** is declared as a JSON Schema (in `vite.config.ts`'s `configSchema`
  and/or `config.schema.json`) with `x-napplet-*` annotations; read at runtime
  via `config.get()` / `config.subscribe()`. Secret fields use
  `x-napplet-secret: true` and no `default`.

- **TS config:** every package's `tsconfig.json` extends root `tsconfig.base.json`
  (strict, `noUnusedLocals`/`noUnusedParameters`, `verbatimModuleSyntax`,
  bundler resolution, `noEmit`).

## Hard boundaries (all napplets; enforced by conformance — full list in `docs/boundaries.md`)

- Do not add shell/host implementation code to a napplet package.
- Do not access signer keys, relay pools, cookies, service workers, or host DOM
  directly. No `window.nostr`.
- Do not use `localStorage`/`sessionStorage` for durable state — use
  `@napplet/sdk` storage helpers.
- Do not use direct `fetch`, `WebSocket`, or `EventSource`. NAP-CONNECT
  (direct network) and NAP-CLASS are **deferred**; use `resource.bytes()` for
  read-only external bytes and do not depend on the deferred surfaces.
- Import `@napplet/shim` once at the entry point before any SDK call.
- Do not invent app-local NAP names, numbers, or envelope domains. If a feature
  seems to need one, apply `docs/new-nap-proposals.md` and propose it upstream at
  `github.com/napplet/naps` first.

## Verification

Run per-napplet (filter) or across the whole workspace:

```bash
pnpm --filter <name> verify          # type-check + build one napplet
pnpm --filter <name> test:conformance # NAP conformance for one napplet
pnpm verify                          # whole workspace
pnpm test:conformance                # whole workspace
```

`test:conformance` loads the built napplet in a real `allow-scripts` iframe and
fails on a malformed envelope, manifest problem, boot failure, or
forbidden-global reference.

## When protocol behavior is in question

`docs/nip-5d.md` points to the pinned NIP-5D source — this repo holds no
normative protocol text. Treat the pinned spec and current `@napplet` package
source as more authoritative than assumptions; the upstream SDK is alpha.
