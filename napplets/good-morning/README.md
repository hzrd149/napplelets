# Good Morning napplet

A "GM" inbox napplet. It surfaces the **GM / good morning** notes posted by
the people you follow and marks the ones you have already greeted back.

Ported from the standalone GM Protocol app onto a NIP-5D napplet runtime
(sandboxed iframe, NAP-OUTBOX relay routing, local note renderer).

## What it does

1. Loads your contacts from the runtime via **NAP-IDENTITY** (`identity.getFollows()`)
   — the shell resolves your newest **kind-3** follow list; the napplet never
   fetches it over the relays itself.
2. Subscribes to your contacts' **kind-1** notes since **local midnight** and keeps
   the ones that contain a GM (see matching below). Root GMs (no `e` tag) become
   inbox rows, newest first.
3. Subscribes to **your own** kind-1 notes since midnight; a GM that carries an
   `e` tag is a GM reply. A row shows a green **✓ replied** when any of your GM
   replies e-tags that note — otherwise it shows **reply →** and counts toward
   the "to greet" badge.
4. Clicking a row emits `note:open` (NAP-04); the shell opens/focuses the
   **Note Reader** napplet where you reply inline. Avatars and names emit
   `profile:open`.
5. A **List / Gallery** toggle in the header switches the inbox between the
   default row list and a **gallery** of the day's GM images: each tile is the
   first image resource found in a GM note (inline image URL or blossom/NAP-RESOURCE
   pointer), with the note content shown as the caption/`alt` underneath. Notes
   with no image are omitted from the gallery. Clicking a tile emits the same
   `note:open` intent. Both the replied/unreplied filter and the gallery honor
   the same `visibleThreads`.

### GM matching

`containsGM` is ported verbatim from `gm-protocol/src/lib/gmDetection.ts`:

```
/(?:^|[\s.,!?;:'"\-—()\[\]{}])(gm|good\s+morning)(?=$|[\s.,!?;:'"\-—()\[\]{}])/i
```

Matches the token `gm` or the phrase `good morning` with punctuation/whitespace
boundaries (so `magma`, `goodmorning`, and `gmail` URLs do **not** match). Keep
the two copies in sync.

## Runtime capability gate

good-morning doubles as a **runtime/shell debugging napplet**, so before it
mounts the inbox it probes the host for the NAPs it needs and, if any are
missing, says so plainly instead of failing into a blank or perpetually
"loading" screen:

- **Essential** (`identity`, `inc`, `outbox`) — the inbox can't function without
  them. Missing → a full-surface diagnostic (`MissingNaps` screen variant)
  listing each absent NAP and what it's for.
- **Degraded** (`resource`, `theme`) — the inbox still works but loses avatars or
  theming. Missing → a dismissible warning banner above a working inbox.

Detection checks `window.napplet.<domain>` presence (see
`src/lib/nap-capabilities.ts`) — a domain object being installed means the
runtime exposes that NAP; absence means it's unavailable. The inbox is
**outbox-only** — both note reads and Quick GM publishes route through
`NAP-OUTBOX` (there is no `NAP-RELAY` fallback), so it's gated essential.

## Structure

- `src/lib/nap-capabilities.ts` — the runtime NAP probe + essential/degraded
  classifier (pure `classifyCapabilities` is unit tested).
- `src/components/MissingNaps.svelte` — the diagnostic screen / warning banner.
- `src/lib/gm-detection.ts` — the GM regex (+ tests).
- `src/lib/gm-store.ts` — inbox state machine: contacts → GM notes → replies →
  `buildGMThreads` (roots only, `isRead` derivation). Pure helpers are unit
  tested.
- `src/lib/gm-origin.ts` — the NAP-OUTBOX routing seam for inbox subscriptions.
- `src/lib/gm-media.ts` — extracts the first image source from a note's content
  via the local `extractNoteContentEmbeds` parser for the gallery view (+ tests).
- `src/lib/profile-metadata.ts` — shared kind-0 loader (kept in sync with feed).
- `src/lib/gm-actions.ts` — `note:open` payload builders.
- `src/components/` — `GMInbox` (list/gallery view toggle + profile batching),
  `GMRow` (a list row), `GMGallery` (the image-wall view), `GMNoteContent` (local
  text/reference/link renderer).

## Develop

```bash
pnpm --filter @napplelets/good-morning dev        # vite dev server (port 5184)
pnpm --filter @napplelets/good-morning test       # vitest
pnpm --filter @napplelets/good-morning type-check
pnpm --filter @napplelets/good-morning build
```

The manifest (`d` tag `good-morning`) is build-signed by `@napplet/vite-plugin`;
the launcher registry entry (`apps/shell/.../napplet-registry.ts`) uses the same
dTag.
