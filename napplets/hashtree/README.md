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

## Where blobs are fetched from

BUD-18 gives `htree://` no server hint, so the candidate servers are assembled
here, best guess first, and every one is tried in turn until a blob verifies:

1. **Your own BUD-03 list** — kind `10063` for the pubkey NAP-IDENTITY reports.
   These are the servers you already mirror to, so they are the likeliest to hold
   what you browse. Skipped when no user is connected, when the shell withholds
   NAP-IDENTITY, or when the "Use my own server list" setting is off — the list
   is not even queried in that last case.
2. **The configured servers** — the fallback for a user who publishes no list.
3. **The tree author's BUD-03 list** — for a mutable (`naddr`/npub) root only.

Duplicates collapse to their earliest position, and a server that serves a
verified blob is promoted for later fetches while a failing one is demoted. Only
the hash is ever sent: a `k` decryption key never reaches a server.

## Inspector

**Inspect** in the header swaps the browser for a debug view of whatever you are
looking at — the selected file, or the directory you are in. It needs no extra
NAP domain: everything shown is already known to the blob layer.

**Structure** is the tree as stored, not as browsed. The browser has to hide the
real shape — BUD-17 requires readers to flatten `t = 3` fanout nodes and never
expose their internal links, and a chunked file is presented as a file — so the
inspector deliberately undoes both: fanout nodes appear as nodes, files as their
chunk lists, links in manifest order rather than sorted for display. Each row
carries its type (`blob`/`file`/`directory`/`fanout`), hash, size, a lock when
the link is encrypted, and, inside a file manifest, the plaintext offset its
bytes start at — the prefix sum BUD-17 stores no field for. Expanding a row
fetches exactly that one manifest; leaf blobs are described from their link and
never fetched. A manifest that will not decode shows its error in place, which is
the case worth debugging.

**Fetches** is the log the blob layer used to throw away: per request, whether it
came from the network, the cache, or was coalesced onto an identical request
already in flight; which server answered; bytes, milliseconds, and every server
rejected on the way, with why — a wrong-hash response reads differently from a
timeout. Recording is always on and bounded to the last 300 events, so opening
the inspector explains what already happened rather than starting from empty.
"Only this hash" narrows it to the node in view.

Nothing in here widens the boundary: hashes and server URLs are already public,
and a `k` key is reported only as "encrypted", never printed.

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
