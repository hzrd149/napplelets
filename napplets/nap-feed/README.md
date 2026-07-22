# Napplet Feed

A NIP-5D napplet feed that shows kind-35129 named napplet manifest events from
the active user's contacts and the active user.

It reads follows through `identity.getFollows()` and reads manifests through
`outbox.query` / `outbox.subscribe`. It does not download or parse napplet
artifacts; display metadata comes from the manifest event envelope and tags.

```bash
pnpm --filter @napplelets/nap-feed dev
pnpm --filter @napplelets/nap-feed verify
pnpm --filter @napplelets/nap-feed test:conformance
```
