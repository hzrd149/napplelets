# A test napplet — napplet

Part of the [napplelets](../../README.md) monorepo. Repo-wide agent guidance and
the shared NIP-5D authoring context live at the root:

- [`../../AGENTS.md`](../../AGENTS.md) — boundaries, workflow, verification
- [`../../docs/`](../../docs) — NIP-5D, boundaries, design patterns, NAP proposals
- [`../../.codex/skills/`](../../.codex/skills) — napplet-author, napplet-verify

This package is the napplet side of the shell boundary only. Do not add shell or
host code, direct `fetch`/`WebSocket`/storage, or `window.nostr` here.
