# Nostr Bubbles

A NIP-5D napplet that turns live Nostr activity from popular relays or the
current user's one-hop contacts into bouncing profile-image bubbles.

The napplet uses `@napplelets/theme-hypr` for shell-aware theme tokens and stays
on the napplet side of the boundary:

- `NAP-IDENTITY` loads the current public key and follows.
- `NAP-OUTBOX` queries and subscribes to kinds `1`, `7`, `9735`, and `8333` from
  those follows, batched by author, when contacts mode is selected.
- `NAP-RELAY` subscribes to the default popular relays from nostr-tv-bubbles when
  contacts mode is not selected.
- `NAP-RESOURCE` resolves external profile images into object URLs.
- `NAP-STORAGE` saves the self-contained drawer settings for source mode,
  density, zaps, reactions, and batch size.

It does not use `window.nostr`, relay pools, direct `fetch`, WebSockets,
browser storage, or `nostr-social-graph`.

```bash
pnpm --filter nostr-bubbles dev               # local dev server
pnpm --filter nostr-bubbles verify            # tests + type-check + single-file build
pnpm --filter nostr-bubbles test:conformance  # NAP conformance check
```

The runtime injects `window.napplet`; app code uses `@napplet/sdk` for shell
services. For current Kehto/Paja compatibility, `vite.config.ts` declares every
used NAP because the host derives injected grants from that list; degradable paths
still use injected property presence and fallbacks.

Shared authoring context lives at the repo root: [`../../docs/`](../../docs).
See [`../../AGENTS.md`](../../AGENTS.md) before changing protocol-facing behavior.
