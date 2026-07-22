# WiFi Map

A read-only NIP-5D napplet for browsing Wifistr kind `38787` WiFi hotspot events
on a sandbox-safe bundled map.

```bash
pnpm --filter wifi-map dev
pnpm --filter wifi-map verify
pnpm --filter wifi-map test:conformance
```

The napplet reads Nostr events through `NAP-OUTBOX`, stores only viewport state
through `NAP-STORAGE`, and optionally opens coordinate links through `NAP-LINK`.
It does not create, edit, or publish WiFi events in v1.
