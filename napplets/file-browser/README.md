# File Browser

A NIP-5D napplet in the [napplelets](../../README.md) monorepo.

Browse runtime-visible virtual roots, preview safe text and image files, create
folders or empty text files, and rename, move, or permanently delete selected
entries. All access uses NAP-FS virtual paths; the shell owns host filesystem
access and authorization.

```bash
pnpm --filter file-browser dev               # local dev server
pnpm --filter file-browser verify            # type-check + single-file build
pnpm --filter file-browser test:conformance  # NAP conformance check
```

The runtime injects `window.napplet`; app code uses `@napplet/sdk` for shell
services. For current Kehto/Paja compatibility, `vite.config.ts` declares every
used NAP because the host derives injected grants from that list; degradable paths
still use injected property presence and fallbacks.

Shared authoring context lives at the repo root: [`../../docs/`](../../docs).
See [`../../AGENTS.md`](../../AGENTS.md) before changing protocol-facing behavior.
