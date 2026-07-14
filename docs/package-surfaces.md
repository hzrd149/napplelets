# Package Surfaces

## Runtime Packages

If no package exposes the named interface or wire format you need, do not add a
new private message domain in this app. Read `docs/new-nap-proposals.md` and
propose protocol-level work in `https://github.com/napplet/naps` only when the
guardrails are met.

### `@napplet/shim`

Runtime-side injected-global installer. Napplet application code does not import
or depend on this package. Runtime implementers use it to install the granted
`window.napplet.<domain>` objects before any napplet script runs.

### `@napplet/sdk`

Named helpers for napplet app code.

```ts
import { outbox, storage, identity, config, resource } from '@napplet/sdk';
```

Use this for app calls. It wraps runtime-injected domains at call time and
re-exports types and constants. Prefer OUTBOX or a higher-level social domain
for normal Nostr work; RELAY is the low-level relay-local escape hatch.

### `@napplet/nap`

Domain-specific subpaths. Use these when you need granular imports.

```ts
import { relaySubscribe } from '@napplet/nap/relay/sdk';
import type { ResourceBytesMessage } from '@napplet/nap/resource/types';
```

Do not import from the `@napplet/nap` root. Import a domain subpath.

## Build Package

### `@napplet/vite-plugin`

Vite plugin for single-file builds and a local manifest/hash workflow.

```ts
import { nip5aManifest } from '@napplet/vite-plugin';
```

Set `artifactMode: 'single-file'` for the NIP-5D artifact shape. The plugin can
write a local `.nip5a-manifest.json` when `VITE_DEV_PRIVKEY_HEX` is set. Declare
every used domain through `requires` because current Kehto/Paja hosts derive the
injected grant from it; this is a runtime compatibility constraint. Presence-gate
degradable paths as a robustness fallback.

Production relay publishing is intentionally outside this boilerplate.
