# Hashtree

A read-only file explorer for Blossom hashtrees, in the
[napplelets](../../README.md) monorepo.

Paste an `htree://` URI, an `nhash`, an `naddr`, or a bare root hash and browse
the folder structure. Manifests, folders and file chunks are fetched only as you
open them; every blob is verified against its SHA-256 before it is used.

There is deliberately no inbound-intent handling. NAP-INTENT's inbound envelopes
are `invoke.result`, `available.result`, `handlers.result` and `changed` — the
protocol has no way to deliver a payload to a handler, and NAP-INC is for
napplet-to-napplet messaging, not a substitute for one. So this napplet declares
no `archetypes` rather than advertising a role it cannot service.

Implements the four pending Blossom drafts:

| BUD | Covered here |
| --- | --- |
| [15](https://github.com/hzrd149/blossom/pull/104) | `chk-v1` decryption (HKDF-SHA256 + AES-256-GCM, zero nonce), public keys only |
| [16](https://github.com/hzrd149/blossom/pull/105) | MessagePack directory manifests (`t = 2`) |
| [17](https://github.com/hzrd149/blossom/pull/106) | Chunked file manifests (`t = 1`) and directory fanout (`t = 3`) |
| [18](https://github.com/hzrd149/blossom/pull/107) | `htree://` references, `nhash` TLV, kind `30064` mutable roots |

**These specs are unmerged drafts and may change.** Decoding is strict so a
format shift fails loudly rather than rendering something wrong, and the four
published test vectors are asserted byte-for-byte in `src/lib/*.test.ts`.

Known gaps, by design: link-private (`encryptedKey` XOR a link key) and
owner-private (NIP-44 `selfEncryptedKey`) roots are detected and explained but not
opened. Kind `30064` is not registered in NIP-01. Where BUD-18 and the reference
implementation disagree, the implementation wins — the `k` key is read from the
URI fragment and never sent to a server, and equal `created_at` ties break on the
lowest event id per NIP-01.

## Opening a file

A `blob:` object URL made here has an opaque origin, so the shell cannot resolve
one. The four exits are therefore:

- **Preview** in-napplet — the only path that works for chunked or encrypted files.
- **Open in browser** via NAP-LINK, using the real `https://<server>/<hash>` URL.
  Only exists for a single unencrypted blob; the UI says so when it does not.
- **Save…** via NAP-FS `pickSaveFile` + `write` — works for anything.
- **NAP-MEDIA** registers a transport session while audio or video plays. It is
  session control, not a viewer.

```bash
pnpm --filter hashtree dev               # bare vite dev server
pnpm dev hashtree                        # Kehto Paja runtime with live NAP adapters
pnpm --filter hashtree verify            # tests + type-check + single-file build
pnpm --filter hashtree test:conformance  # NAP conformance check
```

The runtime injects `window.napplet`; app code uses `@napplet/sdk` for shell
services. For current Kehto/Paja compatibility, `vite.config.ts` declares every
used NAP because the host derives injected grants from that list. Only
NAP-RESOURCE is genuinely essential — `src/lib/nap.ts` classifies the rest as
degradable and the UI reports what is missing.

Shared authoring context lives at the repo root: [`../../docs/`](../../docs).
See [`../../AGENTS.md`](../../AGENTS.md) before changing protocol-facing behavior.
