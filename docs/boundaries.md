# Napplet Boundaries

Napplets run in a restrictive iframe and delegate privileged work to the shell.
The template should stay on the napplet side of that line.

## Napplet Owns

- UI state and rendering.
- User gestures inside the iframe.
- Calls into runtime-injected `window.napplet` through `@napplet/sdk`.
- Feature detection with injected domain property presence.
- Subscription cleanup for outbox, relay-local escape hatches, identity, config,
  keys, media, notify, and INC listeners.
- Graceful fallback when a shell does not implement a requested NAP.

## Shell Owns

- Relay pool access.
- Signing and encryption.
- User identity and signer state.
- Storage persistence and quota.
- External byte fetching through NAP-RESOURCE.
- Virtual filesystem mounts, host-path isolation, authorization, and backing
  storage through NAP-FS.
- Settings UI for NAP-CONFIG.
- Injection of the granted `window.napplet.<domain>` objects before app scripts.

(NAP-CONNECT direct-network grants and NAP-CLASS security-class assignment are
currently deferred on the NAPs track — not part of the active surface.)

## Forbidden In Napplet Code

- HTML `<form>` elements and form submission APIs. Napplet interactions must
  use explicit input and button event handlers.
- Direct signer access or NIP-07 assumptions.
- Direct host DOM access.
- `localStorage` or `sessionStorage` for durable user data.
- Service worker registration.
- Cookie access.
- Unchecked direct network access.
- Shell policy decisions such as ACL, CSP, resource allowlists, or consent
  persistence.

## Allowed Patterns

- `import { outbox, storage, identity } from '@napplet/sdk';` for named helpers.
- `if (window.napplet?.resource) { ... }` before using optional domains.
- `relay.subscribe(..., { relay: groupRelay })` only for explicit relay-local
  semantics that OUTBOX cannot express.
- `storage.setItem()` for durable key-value app state.
- `resource.bytes()` for external read-only bytes.
- `fs.info()` / `fs.list()` / `fs.read()` and mutation helpers for
  policy-bound virtual paths; never infer or expose host paths.
