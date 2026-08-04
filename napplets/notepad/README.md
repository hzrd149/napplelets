# Notepad

A NIP-5D napplet in the [napplelets](../../README.md) monorepo: the Windows XP
Notepad, over the shell's virtual filesystem.

Open, edit and save text files through NAP-FS. Find and Replace, Go To Line, a
live Ln/Col readout, word wrap, Time/Date insert, and detection of files that
change on disk while you have them open.

It is also the reference consumer for [`@napplelets/theme-xp`](../../lib/theme-xp),
and exercises most of that theme doing its actual job — window chrome and
title-bar controls, `.xp-menu-bar` + `.xp-menu` dropdowns with shortcut hints and
a checkmark gutter, two stacked `.window.xp-dialog` layers, `ul.tree-view` for the
file list, a three-field status bar, and `.window.is-inactive` on whatever sits
behind an open dialog.

```bash
pnpm --filter notepad dev               # local dev server (127.0.0.1:3002)
pnpm --filter notepad verify            # tests + type-check + single-file build
pnpm --filter notepad test:conformance  # NAP conformance check
```

## Shell surface

| Domain    | Used for                                                                    |
| --------- | --------------------------------------------------------------------------- |
| `fs`      | everything: roots, listing, read, write, stat, pickers, and change watching |
| `storage` | the editor's own state — open path, unsaved buffer, word wrap, last folder  |
| `inc`     | delivery rail for payloads resolved through NAP-INTENT                     |
| `config`  | shell-owned option to show or hide the Windows XP window frame              |

The documents live on the filesystem; `storage` never holds one. Word wrap is a
menu toggle persisted in `storage`, while `config.windowFrame` belongs to the
shell placement: it defaults to the authentic XP title bar and border, and can
remove both when the shell already supplies its own chrome. `keys` is not used —
every action has a menu item, so there is no shell shortcut worth reserving, and
Ctrl+S/Ctrl+O/F3 are handled locally. `theme` is not used, so the napplet always
renders authentic Luna instead of following the shell palette.

Notepad advertises the `text-editor` archetype for the
`napplet:text-editor/open` and `napplet:text-editor/edit` conventions. Callers
use NAP-INTENT exclusively to resolve and open Notepad; they do not address this
napplet directly. In the current NAP-INTENT contract, the shell delivers the
resolved convention payload to the handler as an INC topic event after the
target is ready, so `inc` remains a required delivery rail rather than a second
dispatch API.

Every runtime domain is feature-checked at call time. With no `fs`, this
degrades to a working scratch text editor that says so when you try to open or
save; without `config`, the XP frame stays visible.

## Behaviour worth knowing

- **Files round-trip byte-for-byte.** The line ending and any UTF-8 BOM are
  detected on open and re-applied on save, so opening a CRLF file and saving it
  does not rewrite every line in it. New files get CRLF, as XP's Notepad wrote.
- **Binary files are refused, not mangled.** Decoding is strict UTF-8; anything
  malformed or containing NUL is rejected rather than opened as mojibake and
  corrupted on the next save.
- **Reads and writes are chunked** to `limits.maxReadBytes` / `maxWriteBytes`. A
  chunked write that fails partway leaves a short file, and the error says so.
- **External changes are caught.** The open file is watched; a change re-`stat`s
  it and compares the `revision` token. A clean buffer reloads silently, a dirty
  one asks. Saves carry `ifRevision`, so a stale write raises a conflict dialog
  (Overwrite / Reload / Cancel) instead of silently discarding someone's work.
- **A failed save never clears the buffer** and never drops the modified flag.
- **Cancelling is not an error.** NAP-FS reports cancellation as an `FsError`;
  dismissing a picker or the Open dialog does nothing at all.
- **Advertised permissions are advisory.** Actions stay enabled and the runtime's
  actual rejection is surfaced, rather than pre-emptively greying things out.

### Open and Save As

The XP dialog browses the roots `fs.info()` advertises. **Browse…** hands off to
the runtime's own `fs.pickFile()` / `fs.pickSaveFile()`, which is the only way to
reach a file outside those roots — and the only route at all on a shell that
advertises none.

### Known limits

- **Paste cannot be driven from the menu.** An opaque-origin sandbox cannot read
  the clipboard: `execCommand('paste')` is a no-op and `navigator.clipboard`
  rejects. The menu item asks you to press Ctrl+V, which works normally.
- Files over 2 MiB are refused, the way Notepad refused what it could not hold.
- UTF-8 only. XP's ANSI/Unicode encoding menu has no equivalent here.
- No Print or Page Setup — there is no NAP for printing.

The runtime injects `window.napplet`; app code uses `@napplet/sdk` for shell
services. For current Kehto/Paja compatibility, `vite.config.ts` declares every
used NAP because the host derives injected grants from that list; degradable paths
still use injected property presence and fallbacks.

Shared authoring context lives at the repo root: [`../../docs/`](../../docs).
See [`../../AGENTS.md`](../../AGENTS.md) before changing protocol-facing behavior.
