# napplelets

A monorepo for building many small **NIP-5D napplets** — sandboxed Nostr web
applets that run in an `allow-scripts` iframe and delegate signing, storage, and
relay access to a host shell over the NIP-5D JSON envelope wire format.

Each napplet is a self-contained workspace package under [`napplets/`](./napplets)
built with the [`@napplet`](https://napplet.run/docs/) packages. Those packages
(and shared `@hyprgate/*` libraries) are wired in from the `napplet/` and
`hyprgate/` git submodules as workspace members, so napplets build against live
submodule source. This is a development workspace — versions are intentionally
not pinned so napplets are tested against the latest resolved versions.

## Layout

```
napplelets/
├─ napplets/            # one workspace package per napplet
│  └─ test/             # example napplet (exercises every shell surface)
├─ templates/
│  └─ napplet/          # clean starter copied by `pnpm new`
├─ docs/                # shared NIP-5D authoring context (single source of truth)
├─ scripts/
│  └─ new-napplet.mjs   # scaffolder
├─ .codex/skills/       # napplet authoring + verification skills
├─ tsconfig.base.json   # shared TypeScript config every napplet extends
└─ pnpm-workspace.yaml  # workspace = napplets/*
```

## Getting started

```bash
pnpm install              # install all workspace packages
pnpm new my-napplet       # scaffold a new napplet (official @napplet/boilerplate)
pnpm dev my-napplet       # Vite dev server for one napplet
```

## Running a napplet

```bash
pnpm dev [name]      # Vite dev server — fast UI iteration
```

`name` is optional when there is exactly one napplet. `pnpm dev` is plain Vite
on **http://127.0.0.1:3001**, best for layout/styling; there is no host shell in
this workspace, so the NAP services (identity, relay, storage…) aren't present and
SDK calls won't resolve there.

To exercise a napplet against real NAP services, use conformance testing — a
pass/fail gate that boots the built napplet in a real `allow-scripts` iframe
harness: `pnpm test:conformance` (runs every napplet).

## Workspace scripts

```bash
pnpm build               # build every napplet to a single self-contained index.html
pnpm verify              # type-check + build every napplet
pnpm type-check          # strict TS check across the workspace
pnpm discover            # list every built napplet the CLI can see
pnpm test:conformance    # NAP conformance check for every napplet
pnpm deploy              # publish every napplet (needs relays/blossom/signer)
pnpm debug               # read-only deploy/discovery diagnostics
```

Testing and deploy run through **`@napplet/cli`** at the repo root in monorepo
mode: a single `.napplet/config.json` sets `discover.roots: ["napplets"]`, and the
scripts above call `napplet … --all`, treating each napplet folder as its own
deploy target (folder name = the `d` tag). The CLI is a Deno tool from the
`napplet/` submodule (run via the `napplet` launcher), so **Deno must be
installed**. Set `relays`/`blossomServers` in `.napplet/config.json` before
deploying.

Run a single napplet's own scripts with pnpm's filter:

```bash
pnpm --filter test dev
pnpm --filter test verify
```

## How a napplet works

A napplet imports `@napplet/shim` once at its entry point to install
`window.napplet`, then uses `@napplet/sdk` to ask the host shell for relay,
identity, storage, resource, config, notification, and other NAP services. The
build inlines everything into one `index.html` (via `vite-plugin-singlefile`)
because NIP-5D loads a napplet through `iframe.srcdoc` with no served origin to
fetch external assets from.

### Hard boundaries

- No direct `fetch`, `WebSocket`, `EventSource`, `localStorage`, or
  `sessionStorage`. Use the `@napplet/sdk` helpers; use `resource.bytes()` for
  read-only external bytes.
- No `window.nostr` or direct access to signer keys, relay pools, or host DOM.
- Don't invent NAP names, numbers, or envelope domains — see
  [`docs/new-nap-proposals.md`](./docs/new-nap-proposals.md).

## Authoring context

Read these before changing protocol-facing behavior. They are shared by every
napplet in the repo:

- [`docs/nip-5d.md`](./docs/nip-5d.md)
- [`docs/boundaries.md`](./docs/boundaries.md)
- [`docs/design-patterns.md`](./docs/design-patterns.md)
- [`docs/package-surfaces.md`](./docs/package-surfaces.md)
- [`docs/new-nap-proposals.md`](./docs/new-nap-proposals.md)
- [`docs/authoring-checklist.md`](./docs/authoring-checklist.md)
- [`docs/context-map.md`](./docs/context-map.md)

## References

- Napplet spec & packages — https://napplet.run/docs/
