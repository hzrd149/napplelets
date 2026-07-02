# Good Morning napplet

A "GM" inbox for hyprgate. It surfaces the **GM / good morning** notes posted by
the people you follow and marks the ones you have already greeted back.

Ported from the standalone [GM Protocol](../../gm-protocol) app onto the hyprgate
napplet runtime (NIP-5D iframe, NAP-OUTBOX relay routing, shared note renderer).

## What it does

1. Loads your contacts from your newest **kind-3** follow list.
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

### GM matching

`containsGM` is ported verbatim from `gm-protocol/src/lib/gmDetection.ts`:

```
/(?:^|[\s.,!?;:'"\-—()\[\]{}])(gm|good\s+morning)(?=$|[\s.,!?;:'"\-—()\[\]{}])/i
```

Matches the token `gm` or the phrase `good morning` with punctuation/whitespace
boundaries (so `magma`, `goodmorning`, and `gmail` URLs do **not** match). Keep
the two copies in sync.

## Structure

- `src/lib/gm-detection.ts` — the GM regex (+ tests).
- `src/lib/gm-store.ts` — inbox state machine: contacts → GM notes → replies →
  `buildGMThreads` (roots only, `isRead` derivation). Pure helpers are unit
  tested.
- `src/lib/gm-origin.ts` — the NAP-OUTBOX / NAP-RELAYS routing seam (adapted from
  the feed napplet's `feed-origin.ts`).
- `src/lib/profile-metadata.ts` — shared kind-0 loader (kept in sync with feed).
- `src/lib/gm-actions.ts` — `note:open` payload builders.
- `src/components/` — `GMInbox` (list + profile batching), `GMRow` (a row),
  `GMNoteContent` (thin adapter over `@hyprgate/napplet-ui` NoteContent).

## Develop

```bash
pnpm --filter @hyprgate/napp-good-morning dev        # vite dev server (port 5184)
pnpm --filter @hyprgate/napp-good-morning test       # vitest
pnpm --filter @hyprgate/napp-good-morning type-check
pnpm --filter @hyprgate/napp-good-morning build
```

The manifest (`d` tag `good-morning`) is build-signed by `@napplet/vite-plugin`;
the launcher registry entry (`apps/shell/.../napplet-registry.ts`) uses the same
dTag.
