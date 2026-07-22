# Napplet Feed — napplet

Part of the [napplelets](../../README.md) monorepo. Repo-wide agent guidance and
the shared NIP-5D authoring context live at the root:

- [`../../AGENTS.md`](../../AGENTS.md) — boundaries, workflow, verification
- [`../../docs/`](../../docs) — NIP-5D, boundaries, design patterns, NAP proposals
- [`../../.agents/skills/`](../../.agents/skills) — napplet design, build, and verification

This package is the napplet side of the shell boundary only. Do not add shell or
host code, direct `fetch`/`WebSocket`/storage, `window.nostr`, or an app-owned
`@napplet/shim` import here. The runtime injects `window.napplet` before app code.
