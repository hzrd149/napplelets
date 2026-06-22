# A test napplet

A NIP-5D napplet in the [napplelets](../../README.md) monorepo.

```bash
pnpm --filter test dev               # local dev server
pnpm --filter test verify            # type-check + single-file build
pnpm --filter test test:conformance  # NAP conformance check
```

Imports `@napplet/shim` once at the entry point, then uses `@napplet/sdk` for
shell services, declaring the NAPs it uses in `vite.config.ts` (`requires`).

Shared authoring context lives at the repo root: [`../../docs/`](../../docs).
See [`../../AGENTS.md`](../../AGENTS.md) before changing protocol-facing behavior.
