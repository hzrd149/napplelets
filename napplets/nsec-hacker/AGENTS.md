# Nsec Hacker — napplet

Part of the [napplelets](../../README.md) monorepo. Repo-wide agent guidance and
the shared NIP-5D authoring context live at the root:

- [`../../AGENTS.md`](../../AGENTS.md) — boundaries, workflow, verification
- [`../../docs/`](../../docs) — NIP-5D, boundaries, design patterns, NAP proposals
- [`../../.agents/skills/`](../../.agents/skills) — napplet design, build, and verification

This package is the napplet side of the shell boundary only. Do not add shell or
host code, direct `fetch`/`WebSocket`/storage, `window.nostr`, or an app-owned
`@napplet/shim` import here. The runtime injects `window.napplet` before app code.

## Rules specific to this napplet

**It generates throwaway secp256k1 keys client-side, for a joke.** That is
allowed because the keys are ephemeral, random, never the user's, and never used.
Read the header comment in `src/lib/keys.ts` and the "About the keys" section of
`README.md` before touching anything key-related, and keep both accurate.

Never add, to this package:

- signing, encryption, or publishing of any kind;
- persistence of key material anywhere, including NAP-STORAGE;
- import of a user-supplied nsec, or any flow that accepts one;
- a rigged or forced "win" in production code. The `granted` path is exercised
  by stubbing the sandbox RNG from a test harness, not by a shipped toggle.

**Import discipline:** only `nostr-tools/pure` and `nostr-tools/nip19`. The
package root pulls in relay and pool modules that reference `WebSocket`, and
conformance statically scans the built bundle, so even a dead reference fails
the build.

**Test boundary:** `src/lib/` is pure and unit-tested; `src/ui/` and
`src/main.ts` own the DOM and GSAP and carry no unit tests. Pure logic that is
worth asserting — the reel's column fitting, for instance — belongs in
`src/lib/`, not next to the animation code.
