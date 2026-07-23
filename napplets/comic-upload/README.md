# Comic Upload

A NIP-5D napplet for publishing CBZ comic metadata events from selected local
comic archives.

```bash
pnpm --filter comic-upload dev
pnpm --filter comic-upload verify
pnpm --filter comic-upload test:conformance
```

The runtime injects `window.napplet`; app code uses `@napplet/sdk` for upload,
identity, and outbox publishing. The CBZ event shape follows
[`../../nips/cbz-comic-publication.md`](../../nips/cbz-comic-publication.md).
