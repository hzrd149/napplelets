# Nsec Hacker

A NIP-5D napplet in the [napplelets](../../README.md) monorepo.

Press one button. A matrix slot machine spins for ten seconds while the napplet
genuinely brute-forces random nostr secret keys, streaming each guessed npub
past you and comparing it against yours. It loses. It then stacks its closest
guess against your real npub, character by character, so you can see exactly how
badly it lost — usually two or three accidental matches out of fifty-eight —
tells you `ACCESS DENIED`, and invites you to try again.

It is a toy. That is the whole design.

```bash
pnpm --filter nsec-hacker dev               # local dev server on 127.0.0.1:3012
pnpm --filter nsec-hacker verify            # unit tests + type-check + single-file build
pnpm --filter nsec-hacker test:conformance  # NAP conformance check
pnpm dev nsec-hacker                        # Kehto Paja dev shell, with a real identity
```

## About the keys

**This napplet generates secret keys. None of them is ever yours, and none of
them is ever used for anything.**

The repo's boundaries and the napplet design skills say a napplet must never
handle a raw private key. That rule is about _the user's_ key and about
app-owned signing, and this napplet does neither. Concretely, every key it makes
is:

- generated locally from `crypto.getRandomValues`, inside the sandboxed frame;
- random, and never derived from anything you own;
- never persisted — the napplet declares no `storage`, uses no browser storage,
  and writes no config;
- never published, never sent anywhere, never handed to a signer;
- never used to sign or encrypt anything;
- discarded when the run ends.

The napplet reads your **public** key through NAP-IDENTITY, which is read-only
by design, and compares throwaway guesses against it. It declares exactly one
NAP domain (`identity`), so it has no manifest route to a signer, a relay, or
the network at all. The sandbox enforces this; these notes only make it
findable. See the header comment in `src/lib/keys.ts`.

The secret key is rendered on screen in exactly one place: the `ACCESS GRANTED`
screen, which requires an actual 1-in-2^256 collision. The code path is real and
tested; it has never been reached.

## What is real and what is theatre

The spectacle is fake. The numbers are not.

- **Real** — the keys, the derivations, the `KEYS` counter, the `RATE` in keys
  per second, and `BEST`, which is the longest hex prefix any guess has actually
  shared with your pubkey. The npub streaming under the reel is the encoded
  pubkey of the key just tried, refreshed about fifteen times a second. The
  glyphs in the reel are characters from genuine candidate pubkeys, and the reel
  locks to the real final candidate. The end-of-run diff is a true positional
  comparison: bech32 is base32, so unrelated keys agree at roughly one position
  in thirty-two, and the handful of green characters you see are exactly that
  coincidence and nothing more. The shared `npub1` prefix is excluded from the
  score rather than counted as five free matches.
- **Theatre** — the CRT scanlines, the matrix rain, the status lines
  ("Narrowing keyspace..."), and the ten-second duration. A run is time-bounded,
  not work-bounded, so a slower device honestly reports fewer keys rather than
  taking longer.

Typical throughput is roughly 2,500–3,000 keys per second, so a run tries around
25,000 keys. At that rate, exhausting the keyspace takes appreciably longer than
the age of the universe.

## Design notes

**Mining runs on the main thread**, time-sliced to about 5 ms per frame from
`gsap.ticker`, with the rest of the frame left to the animation. A Web Worker
would be faster, but a napplet loads from an opaque origin where blob-URL
workers are unreliable, and a separate worker chunk would break the mandatory
single-file build. Driving mining from the GSAP ticker also means a backgrounded
tab pauses the run and its clock together, so the reported hashrate stays
correct.

**The theme is standalone**, not `@napplelets/theme-dsui`. The repo default is
DSUI; a phosphor-green CRT was a deliberate, requested exception, because a
terminal that follows the host's accent colour is not a terminal. Consequently
the napplet declares no `theme` domain either.

**It has no settings.** The ten seconds are the joke's rhythm rather than a
preference, so there is no `configSchema` and no `config` domain.

**Signed out is a supported state**, not an error. With no identity connected
the run still happens and the counters are still real; the result shows the
guess on its own and says there was no target to compare against, rather than
drawing a diff against nothing.

## Layout

The napplet is a full-bleed terminal that fills whatever frame the shell gives
it — no page header, no card, no window chrome. The reel builds all 64 columns
once and _hides_ the surplus when the frame is narrow, so a resize mid-run never
tears down a live timeline. Below roughly 17rem the caption goes and the
readouts collapse to two columns; the button and counters stay reachable down to
a 240×200 tile. `prefers-reduced-motion` drops the rain and the scanlines and
shortens the run, while leaving the mining and every number untouched.

Shared authoring context lives at the repo root: [`../../docs/`](../../docs).
See [`../../AGENTS.md`](../../AGENTS.md) before changing protocol-facing behavior.
