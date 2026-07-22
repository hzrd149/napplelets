# Article Highlights

A NIP-5D napplet for reading a NIP-23 article from an `naddr` and publishing
NIP-84 highlights from selected article text.

```bash
pnpm --filter artcl-hl dev               # local dev server
pnpm --filter artcl-hl verify            # type-check + single-file build
pnpm --filter artcl-hl test:conformance  # NAP conformance check
```

The runtime injects `window.napplet`; app code uses `@napplet/sdk` for shell
services. Nostr reads and highlight publishes go through NAP-OUTBOX. Highlight
templates are created with Applesauce `HighlightFactory` and then handed to the
shell for signing and fanout.
