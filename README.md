# napplelets

A monorepo for building many small **NIP-5D napplets** — sandboxed Nostr web
applets that run in an `allow-scripts` iframe and delegate signing, storage, and
relay access to a host shell over the NIP-5D JSON envelope wire format.

Each napplet is a self-contained workspace package under [`napplets/`](./napplets)
built with the published [`@napplet`](https://napplet.run/docs/) packages and the
[Kehto](https://kehto.github.io/web/docs/) runtime as the reference host.

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
pnpm dev [name]      # Vite dev server — fast UI iteration, no host shell
pnpm shell [name]    # run inside a reference host shell, with live reload
```

`name` is optional when there is exactly one napplet. `pnpm dev` is plain Vite
on **http://127.0.0.1:3001**, best for layout/styling; the shell's NAP services
(identity, relay, storage…) aren't present, so SDK calls won't resolve there.

`pnpm shell` runs the napplet inside Kehto's **paja** host shell (`kehto paja`):
a real `allow-scripts` iframe driven by the reference runtime, with simulated
identity/relay/storage so SDK calls actually resolve. Open the shell at
**http://127.0.0.1:3000** (top bar / sandboxed napplet / bottom bar); the napplet
itself is served by Vite on **3001** and live-reloads. Tune the simulation with
`kehto paja` flags or a `kehto.dev.json` (`--identity-mode`, `--relay-mode`,
`--storage-mode`, `--config-value`, …).

> **Two workarounds, both temporary** (remove when upstream fixes them):
> - `@kehto/cli` and `@kehto/paja` publish `workspace:*` dependency specs that
>   don't resolve from the registry, so `pnpm-workspace.yaml` pins every `@kehto`
>   package via `overrides`.
> - Kehto is built against `@napplet/core` 0.12–0.13 while the napplets use the
>   current SDK (0.18+). Boot works; if the in-browser NIP-5D handshake misbehaves,
>   that version skew is the first thing to check.

For protocol conformance testing (a different tool — a pass/fail gate, not an
interactive shell), use `pnpm --filter <name> test:conformance[:ui]`.

## Workspace scripts

```bash
pnpm build               # build every napplet to a single self-contained index.html
pnpm verify              # type-check + build every napplet
pnpm type-check          # strict TS check across the workspace
pnpm test:conformance    # NAP conformance check for every napplet
```

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
- Kehto reference runtime — https://kehto.github.io/web/docs/
