# Upstream JS Paint port status

Source: `https://github.com/1j01/jspaint`

The target is the real JS Paint application inside a NIP-5D napplet, not a
lookalike. The pinned upstream runtime is now the production artifact.

## Authority inventory

| Feature | Upstream owner | Napplet replacement | Status |
| --- | --- | --- | --- |
| Menu bar and popups | `lib/os-gui/MenuBar.js`, `src/menus.js` | Original upstream modules and menu definitions | Integrated |
| Open image | browser file picker / File APIs | `fs.pickFile` + chunked `fs.read`; storage recovery fallback | Integrated |
| Save / Save As | File System Access API / download | `fs.write`; storage recovery fallback | Integrated |
| Crash recovery | browser storage | `storage` recovery image | Integrated |
| Core editor and selections | upstream global modules and canvas layers | Pinned and bundled upstream modules | Integrated |
| Tool and palette components | upstream `$ToolBox`, `$ColorBox`, tools and assets | Pinned and bundled upstream modules | Integrated |
| Clipboard | browser Clipboard APIs | Defer until a shipped shell boundary owns image clipboard data | Pending |
| Imgur / URL open / web image search | `XMLHttpRequest` / `fetch` | Disable, or adapt read-only bytes through `resource` where faithful | Pending |
| Multi-user sessions | Firebase / direct network | Disabled; no shipped NAP faithfully owns Firebase session semantics | Pending |
| Speech and eye-gaze extras | browser speech APIs, Tracky Mouse, model side files | Disabled for initial full editor port | Pending |
| Help, sounds, fonts, cursors, format codecs | runtime side assets | Inlined into the single-file artifact | Integrated |

## Current persistence contract

- NAP-FS is the primary user-visible image boundary.
- Reads are chunked until `eof`; virtual paths stay opaque.
- Chunk sizes honor the shell's `fs.info()` read/write limits, matching the
  Notepad napplet's picker and I/O behavior.
- Picker cancellation returns without opening recovery data or saving a
  recovery copy; only an unavailable or failed filesystem activates fallback.
- Saves retain the format selected by JS Paint and write padded RFC 4648 base64.
- Every successful FS save also updates the NAP-STORAGE recovery copy.
- If FS is absent, denied, or fails, Open/Save fall back to NAP-STORAGE.
- No NAP-THEME integration is installed; the bundled XP chrome remains fixed.

## Removed menu authority

The build removes Load From URL, Upload To Imgur, Manage Storage, Print
Preview, Page Setup, Print, both Set As Wallpaper actions, and Recent File.
They can return when shipped NAP domains faithfully own those operations.

## Deliberate compatibility policy

The port waives the current `boot/no-forbidden-globals` finding for upstream
references to `fetch`, `XMLHttpRequest`, and `localStorage`. The built artifact
boots in an opaque `allow-scripts` iframe, and the primary Open/Save paths were
tested against mocked NAP-FS and NAP-STORAGE domains. Optional network/session
extras are not adapted into shell authority and are not part of the supported
napplet contract.
