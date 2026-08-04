# NOTICE — third-party material in `@napplelets/theme-xp`

This package redistributes material from two upstream projects under three
different licenses, plus artwork that neither project owns. Read this before
shipping a napplet built on it.

---

## 1. XP.css — MIT

The stylesheets under `src/generated/{xp,98,gui}.css` are rebuilt from
[XP.css](https://github.com/botoxparty/XP.css) `v0.2.6` sources by
`scripts/generate-css.mjs`.

```
The MIT License (MIT)
Copyright (c) 2020 Adam Hammad, Jordan Scales
https://github.com/botoxparty/XP.css/blob/main/LICENSE
```

XP.css is itself based on [98.css](https://github.com/jdan/98.css) by Jordan
Scales, also MIT. Its icons are hand-redrawn SVG recreations, inlined as data
URIs — vector originals, not extracted bitmaps.

## 2. "Pixelated MS Sans Serif" — CC BY-SA 3.0

`src/generated/fonts.css` embeds three woff2 files as base64 data URIs. Two of
them, `ms_sans_serif.woff2` and `ms_sans_serif_bold.woff2`, are a FontStruct
recreation by **"lou"**, licensed **CC BY-SA 3.0** — a _different_ license from
XP.css's MIT, even though the files ship inside the XP.css package.

See `node_modules/xp.css/gui/fonts/src/ms-sans-serif/license.txt`.

Share-alike obligations attach to the font, not to a napplet that merely
displays text in it, but the attribution requirement is real and this file is
how it is met.

## 3. winXP — MIT

`vendor/windows-icons/*.png` are taken from
[ShizukuIchi/winXP](https://github.com/ShizukuIchi/winXP), and the taskbar,
start-button and inactive-title-bar gradients in `src/taskbar.css` and
`src/patch-xp.css` are reimplemented from its components.

```
The MIT License (MIT)
Copyright (c) 2019 Shizuku Yang
https://github.com/ShizukuIchi/winXP/blob/master/LICENSE
```

## 4. The icon artwork itself — Microsoft's

**This is the one to actually think about.**

The 125 PNGs in `vendor/windows-icons/` are extracted Windows XP shell icons —
their filenames (`676(32x32).png`, `327(16x16).png`) are resource IDs from a
`shell32`-style dump. winXP's MIT license covers Shizuku Yang's _code_; it does
not, and cannot, license Microsoft's artwork. winXP's own README says so:

> The Windows XP name, artwork, trademark are surely property of Microsoft. This
> project is provided for educational purposes only. It is not affiliated with
> and has not been approved by Microsoft.

The same framing applies to anything built with these icons.

Two consequences specific to this repo, because napplet artifacts are
content-addressed and published to Nostr — which means permanently, and without
a practical way to retract:

- **Icons are opt-in and tree-shaken.** `@napplelets/theme-xp/icons` exports one
  ES binding per icon, so a napplet that imports three icons ships three, not
  all 125 (~293kB of base64). Importing `@napplelets/theme-xp/icons.css` instead
  ships every one of them — measured at 244kB in a real bundle.
- **Nothing in `styles.css` pulls in an icon.** The base stylesheet is XP.css's
  own redrawn SVG only. You have to ask for the bitmaps.

The `.ico` files in winXP (`narrator.ico`, `restart.ico`, `all-programs.ico`,
`restore.ico`, `view-info.ico`, `290.ico`) were deliberately **not** vendored:
ICO support in `background-image` is uneven and converting them would add an
image dependency to the build.

## 5. Not included

- **The Bliss wallpaper.** winXP does not ship it either — it hotlinks a 674kB
  JPEG from imgur. A napplet pane is not a desktop.
- **Google Fonts.** winXP imports Noto Sans TC over the network; napplets have
  no network, and it is not an XP font anyway.
