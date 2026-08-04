# JS Paint napplet

A single-file NIP-5D build of the real upstream JS Paint application. The
editor, menus, tools, dialogs, codecs, and classic application styles come from
the pinned upstream source; only its host-authority seams and outer window frame
are adapted for the napplet environment.

## Upstream JS Paint status

The requested [JS Paint](https://jspaint.app/) project is an MIT-licensed web
application rather than an embeddable library. `jspaint-upstream` pins commit
`53be67ab8c47cc0d2168899e7481bc04839c4c81`; `scripts/build-upstream.mjs`
bundles its classic scripts, ESM modules, CSS, themes, cursors, help images, and
other local runtime assets into the napplet's one `index.html`.

JS Paint and its bundled OS-GUI code are copyright Isaiah Odhner and
contributors and licensed under MIT.

## Boundary

- `fs` owns user-selected Open, Save, and Save As operations.
- `storage` persists the recovery image under `jspaint.recovery.v1` and is the fallback
  when filesystem access is unavailable or denied.
- File pickers follow the Notepad napplet's NAP-FS contract: Open requests
  `read`, Save As requests `write` plus `create`, cancellation is silent, and
  reads/writes are chunked to the limits reported by `fs.info()`.
- NAP-THEME is intentionally not requested or installed.
- The outer Luna frame is loaded from `lib/theme-xp/src/styles.css` inside a
  Shadow DOM. It cannot restyle JS Paint's menus, buttons, tools, or dialogs.
- JS Paint's optional upstream extras still contain dormant direct-network and
  browser-storage code. Default editor boot and file persistence do not use it,
  but the static conformance scanner reports those references.
- The File menu omits Load From URL, Imgur, legacy Manage Storage, all printing
  and wallpaper actions, and Recent File because those operations do not have a
  compatible NAP authority yet.

## Verify

```bash
pnpm --filter jspaint verify
pnpm --filter jspaint test:conformance
```

`verify` passes. Conformance currently passes boot, runtime-global injection,
degradation, and boot-error checks, but intentionally fails
`boot/no-forbidden-globals` for upstream `fetch`, `XMLHttpRequest`, and
`localStorage` references. This is the explicit compatibility waiver requested
for the full upstream integration.
