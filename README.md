# napplelets

A monorepo for building many small **NIP-5D napplets** — sandboxed Nostr web
applets that run in an `allow-scripts` iframe and delegate signing, storage, and
relay access to a host shell over the NIP-5D JSON envelope wire format.

Each napplet is a self-contained workspace package under [`napplets/`](./napplets)
built with the [`@napplet`](https://napplet.run/docs/) packages. Those packages
are dual-published to npm and JSR; this workspace consumes the npm-facing
`@napplet/*` names. Versions are intentionally not overridden so napplets are
tested against the latest resolved compatible releases.

## Layout

```
napplelets/
├─ napplets/            # one workspace package per napplet
│  └─ good-morning/     # current napplet package
├─ docs/                # shared NIP-5D authoring context (single source of truth)
├─ scripts/
│  ├─ new-napplet.mjs   # official-generator wrapper
│  └─ lib/adopt.mjs     # monorepo adoption + stale-template sanitizer
├─ tools/napplet-cli/   # Deno launcher for the root CLI
├─ .agents/skills/      # napplet design, build, port, and verification skills
├─ tsconfig.base.json   # shared TypeScript config every napplet extends
└─ pnpm-workspace.yaml  # workspace = napplets/*
```

## Getting started

```bash
pnpm install              # install all workspace packages
pnpm new my-napplet       # scaffold a new napplet (official @napplet/boilerplate)
pnpm dev my-napplet       # Paja dev runtime + Vite HMR for one napplet
```

## Running a napplet

```bash
pnpm dev [name]      # Paja dev runtime + live Vite HMR
```

`name` is optional when there is exactly one napplet; with several, `pnpm dev`
prompts you to pick one. It boots the **Kehto Paja** dev runtime on
**http://127.0.0.1:5197** and loads the napplet from its live Vite server (on
**http://127.0.0.1:5173** by default; override with `--port <p>`). Paja provides
dev adapters for the NAP surface (identity, relay/outbox, storage, config,
resource, theme, notify, …) and a local dev signer, so SDK calls resolve — and
because the napplet is loaded from Vite, editing source **hot-reloads** the
running napplet. Extra flags are forwarded to `kehto paja` to simulate the shell
(e.g. `pnpm dev my-napplet --theme light`); see `pnpm exec kehto paja --help`.

For bare Vite with no runtime (pure layout/styling iteration), use
`pnpm --filter <name> dev`.

`pnpm dev` uses `iframe.src` for HMR, which is a dev convenience — **not** the
production loading model. To exercise a napplet the way a real shell loads it,
use conformance testing — a pass/fail gate that boots the built single-file
napplet in a real `allow-scripts` iframe harness: `pnpm test:conformance` (runs
every napplet).

## Workspace scripts

```bash
pnpm build               # build every napplet to a single self-contained index.html
pnpm test                # scaffolder regression + package unit tests
pnpm verify              # test + type-check + build every napplet
pnpm type-check          # strict TS check across the workspace
pnpm discover            # list every built napplet the CLI can see
pnpm test:conformance    # NAP conformance check for every napplet
pnpm login               # store an nsec/nbunksec in the OS keychain as the signing key
pnpm deploy              # publish every napplet (needs relays/blossom + a signer)
pnpm debug               # read-only deploy/discovery diagnostics
```

Testing and deploy run through **`@napplet/cli`** at the repo root in monorepo
mode: a single `.napplet/config.json` sets `discover.roots: ["napplets"]`, and the
scripts above call `napplet … --all`, treating each napplet folder as its own
deploy target (folder name = the `d` tag). The CLI is a Deno tool from JSR (run
via the `napplet` launcher), so **Deno must be installed**. Set
`relays`/`blossomServers` in `.napplet/config.json` before deploying.

### Publishing all napplets

Publishing signs each napplet's manifest and uploads its files. Log in once — the
secret is stored in your OS keychain and referenced from `.napplet/config.json`,
so subsequent deploys need no secret on the command line:

```bash
pnpm login               # paste an nsec or nbunksec (Ctrl-D to end)
pnpm deploy              # builds, then signs + publishes every napplet
```

`pnpm login` accepts `nsec1…`, `nbunksec1…` (a NIP-46 bunker connection), or
64-char hex. Prefer not to persist a key? Sign per-run instead with
`pnpm deploy -- --prompt-sec` or `pnpm deploy -- --sec <secret>`. Manage stored
keys with `pnpm keys list` / `pnpm keys doctor` / `pnpm logout`.

Run a single napplet's own scripts with pnpm's filter:

```bash
pnpm --filter @napplelets/good-morning dev
pnpm --filter @napplelets/good-morning verify
pnpm --filter @napplelets/good-morning test:conformance
```

## How a napplet works

The host runtime injects the granted `window.napplet.<domain>` objects before
application scripts run. Napplet code uses `@napplet/sdk` for typed calls and
checks injected domain properties only for optional-feature availability; it
does not import `@napplet/shim`. `@napplet/vite-plugin` inlines the build into one
`index.html` because NIP-5D loads a napplet through `iframe.srcdoc` with no
served origin from which to fetch external assets.

### Hard boundaries

- No direct `fetch`, `WebSocket`, `EventSource`, `localStorage`, or
  `sessionStorage`. Use the `@napplet/sdk` helpers; use `resource.bytes()` for
  read-only external bytes.
- No `window.nostr` or direct access to signer keys, relay pools, or host DOM.
- No app-owned `@napplet/shim` dependency or import.
- For current Kehto/Paja compatibility, manifest `requires` lists every domain
  the app uses because the host derives injected grants from it; degradable
  domains must still be presence-gated with a usable fallback.
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
