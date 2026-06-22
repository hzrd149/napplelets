# napplelets — Agent Guide

This is a **monorepo of NIP-5D napplets**. Each package under `napplets/` is one
small, framework-light, single-purpose napplet on the napplet side of the shell
boundary. Keep each napplet small; the host shell composes many of them.

## Repo shape

- `napplets/<name>/` — one napplet per directory (a pnpm workspace package).
- `templates/napplet/` — the canonical starter. `pnpm new <name>` copies it.
- `docs/` — shared, repo-wide NIP-5D authoring context (single source of truth).
- `.codex/skills/` — `napplet-author` and `napplet-verify` skills.
- `tsconfig.base.json` — every napplet's `tsconfig.json` extends this.

## Adding a napplet

```bash
pnpm new <name>     # scaffolds napplets/<name> from templates/napplet
pnpm install        # link the new workspace package
```

Do **not** hand-roll a napplet directory; scaffold from the template so the
single-file build, shim import, and conformance wiring stay correct.

## Before editing napplet behavior

1. Read `docs/context-map.md`.
2. Read `docs/boundaries.md` and `docs/design-patterns.md` for the surface you
   are changing; check `docs/package-surfaces.md` for the right import.
3. If changing protocol assumptions, verify against `docs/nip-5d.md`.
4. If a change seems to need a new NAP name, message domain, or numbered wire
   format, read `docs/new-nap-proposals.md` first.

## Hard boundaries (all napplets)

- Do not add shell/host implementation code to a napplet package.
- Do not access signer keys, relay pools, cookies, service workers, or host DOM
  directly. No `window.nostr`.
- Do not use `localStorage`/`sessionStorage` for durable state — use
  `@napplet/sdk` storage helpers.
- Do not use direct `fetch`, `WebSocket`, or `EventSource`. NAP-CONNECT is
  deferred; use `resource.bytes()` for read-only external bytes.
- Import `@napplet/shim` once at the entry point before any SDK call.
- Do not invent app-local NAP names, numbers, or envelope domains.

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
