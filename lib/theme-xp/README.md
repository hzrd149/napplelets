# @napplelets/theme-xp

A Windows XP theme for napplets — XP.css rebuilt so it can actually be
re-themed, plus the components it never had.

```ts
import '@napplelets/theme-xp/styles.css';
import { installThemeClient } from '@napplelets/theme-xp';

installThemeClient();
```

Add `'theme'` to the `requires` array in your `vite.config.ts` manifest — the
host derives injected domains from it.

> This is not the repo default. `@napplelets/theme-dsui` is. Reach for theme-xp
> when a napplet wants the XP visual language on purpose.

---

## Why this package rebuilds XP.css instead of importing it

The published `xp.css` package has **no CSS custom properties at all**. Its build
runs `postcss-css-variables`, which flattens every `var()` at build time:
`grep -c 'var(--' dist/XP.css` returns `0`, and there is no `:root` block. The
tokens exist only in source.

So `scripts/generate-css.mjs` re-runs upstream's own PostCSS chain from the
sources in `node_modules/xp.css/`, minus the three plugins that destroy what we
need:

| Upstream plugin                                          | Ours     | Why                                                              |
| -------------------------------------------------------- | -------- | ---------------------------------------------------------------- |
| `postcss-import`, `postcss-nested`, `postcss-inline-svg` | keep     | resolve imports, `&` nesting, and `svg-load()`                   |
| `postcss-css-variables`                                  | **drop** | this is what flattens `var()`                                    |
| `postcss-calc`                                           | **drop** | cannot reduce `calc()` containing `var()`; native CSS handles it |
| `postcss-copy`                                           | **drop** | replaced by the font inliner                                     |
| `cssnano`                                                | **drop** | keeps the output diffable; your Vite build minifies anyway       |

The result is checked in under `src/generated/`. It is verified to carry the
same 162 selectors as upstream's `dist/XP.css` — the only differences are the
`:root` block we keep and four degenerate duplicate selectors that
`postcss-css-variables` used to emit.

**`src/generated/` is generated. Do not edit it.**

```bash
pnpm --filter @napplelets/theme-xp generate   # rewrite it
pnpm --filter @napplelets/theme-xp test       # fails if it has drifted
```

## Fonts

The three `@font-face` families are inlined as base64 woff2 in
`src/generated/fonts.css`. This is not an optimisation: napplets load through
`iframe.srcdoc` at an opaque origin, where upstream's relative
`url(ms_sans_serif.woff2)` resolves to nothing and silently falls back to Arial.

Worth knowing what the ~40kB buys. In the **XP** skin the body font is Arial and
the only XP-specific family is the system font Trebuchet MS, so the pixel font
appears only in `.status-bar-field` (and Perfect DOS VGA only in `pre`/`code`).
It earns its keep in the **98** skin, where `--sans-serif` is the pixel font
throughout.

## Skins

| Import                             | Look                                                 |
| ---------------------------------- | ---------------------------------------------------- |
| `@napplelets/theme-xp/styles.css`  | XP (Luna)                                            |
| `@napplelets/theme-xp/98.css`      | Windows 98                                           |
| `@napplelets/theme-xp/gui.css`     | unthemed base — `--surface` is literally `lightblue` |
| `@napplelets/theme-xp/taskbar.css` | opt-in taskbar, see below                            |

They are mutually exclusive. `98.css` has no `<progress>` styling — that
component exists only in the XP theme upstream.

## Components

Everything XP.css styles works as documented at
[botoxparty.github.io/XP.css](https://botoxparty.github.io/XP.css/): `.window`,
`.title-bar` (+ `button[aria-label="Minimize|Maximize|Restore|Help|Close"]`),
`.window-body`, `.status-bar`, `.field-row`, buttons, checkbox/radio (which need
an adjacent `<label for>`), `input[type=range]`, `select`, `<fieldset>`,
`menu[role=tablist]`, `ul.tree-view`, `<progress>`.

On top of that, this package adds:

| Class                                                                       | What                                                             |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `.window.xp-fill`                                                           | fills the host frame; `.window-body` scrolls instead of the page |
| `.window.is-inactive`                                                       | the unfocused title bar XP.css never had                         |
| `.window.xp-dialog` + `.xp-dialog-body` / `-icon` / `-message` / `-buttons` | error and confirm dialogs                                        |
| `.xp-menu` + `.xp-menu-sep` + `[aria-disabled]`                             | context menu (styling only — positioning is yours)               |
| `.xp-content`                                                               | opts a subtree into `box-sizing: border-box`                     |
| `.xp-taskbar`, `.xp-start-button`, `.xp-taskbar-button`, `.xp-taskbar-tray` | opt-in, from `taskbar.css`                                       |

**There is no global `box-sizing: border-box`, on purpose.** XP.css is
content-box throughout and depends on it: `.title-bar` is `height: 21px` _plus_
`padding: 3px 5px`, so a universal border-box silently shrinks the title bar and
every control by its padding. Use `.xp-content` on your own markup instead.

### The taskbar is opt-in

`CLAUDE.md` tells napplets to "avoid adding page headers, hero sections, framed
cards" and to "let the host shell provide surrounding navigation, chrome, and
context" — and a taskbar is exactly that. It is a separate import so you have to
mean it. Use it when the napplet genuinely owns a full-frame desktop metaphor.

The start button is the one piece of winXP chrome that is a bitmap rather than
CSS. `taskbar.css` draws a CSS approximation so it stands alone; for the real
thing:

```ts
import { startButton } from '@napplelets/theme-xp/icons';

el.classList.add('is-bitmap'); // the artwork already says "start"
el.style.setProperty('--xp-start-button-image', `url(${startButton})`);
```

## Icons

125 Windows XP icons, **but read `NOTICE.md` first** — they are Microsoft's
artwork, and napplet artifacts are published permanently.

```ts
import { computer32, folder48, error32 } from '@napplelets/theme-xp/icons';
el.style.backgroundImage = `url(${computer32})`;
```

These are ES module bindings, so a bundler drops what you do not import.
Measured: a build importing two icons carries two base64 payloads (8kB); one
importing all 125 carries 244kB.

`@napplelets/theme-xp/icons.css` offers the same set as `.xp-icon-<name>`
classes, but **CSS cannot be tree-shaken** — importing it costs all 244kB
regardless of how many you show. Prefer the TS module.

Names come from winXP's own `import` statements, so most are meaningful
(`computer32`, `notepad16`, `folderOpen`, `startButton`). Where two files share
an alias they are split by size (`notepad16` / `notepad32`) or by resource ID
when the sizes match (`printer17` / `printer549`). Files winXP never named keep
theirs (`icon111_32`).

## Theming

`installThemeClient()` maps the shell's NAP-THEME payload onto XP's tokens.
NAP-THEME is a three-colour surface — `background`, `text`, `primary` — so
everything else is derived.

| XP token                                                  | From                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------- |
| `--surface`, `--button-face`                              | `background`                                                              |
| `--button-highlight`, `--button-shadow`, `--window-frame` | `background`, mixed toward white/black                                    |
| `--dialog-blue`, `--link-blue`                            | `primary`                                                                 |
| `--xp-title-bar-bg`, `--xp-frame-*`                       | `primary`, at the original gradient's stop offsets                        |
| `--xp-fieldset-bg`, `--xp-legend-text`, `--xp-tab-*`      | derived — XP hardcodes these, and a dark theme is unreadable without them |
| `--xp-font-body`                                          | `fonts.body.name`                                                         |

The gradient tables are stored as HSL offsets from XP's own `#0050ee`, so the
hand-tuned _shape_ survives re-tinting — highlight at the top, darker lip at the
bottom — and only the hue moves. Feeding `#0050ee` back reproduces upstream's
stops exactly; there is a test for that.

Two deliberate differences from `theme-dsui` and `theme-hypr`:

- **No fallback palette is written on install.** Those packages must, because
  their stylesheets carry no complete palette. Ours does — authentic Luna _is_
  the CSS default. Writing it back as inline styles would only make it
  un-overridable, since an inline custom property beats every `:root` rule.
- **All-or-nothing is expressed by removing.** A shell that sends `#fff`,
  `rgb(...)` or a named colour gets authentic XP, because the client drops its
  own inline values rather than writing fallbacks over them.

`buildXpThemeVariables` / `isXpThemeHex` / `isDarkXpTheme` are exported from
`@napplelets/theme-xp/xp-theme` if you want the mapping without the subscription.

### What cannot be re-tinted

The scrollbar arrows, the min/max/restore/help/close glyphs and the button face
are baked SVG data URIs. A variable cannot reach inside them. Because the button
face is permanently light, `patch-xp.css` pins `--xp-button-text` dark — a dark
shell theme would otherwise put light text on a light button.

## Demo

```bash
pnpm --filter @napplelets/theme-xp demo
```

Every component, all three skins, a fake-host palette panel, and a
squeeze-to-320px toggle for checking the narrow-frame layer.

## Known duplication

`src/xp-theme.ts` copies its colour helpers (hex↔rgb↔hsl, `mix`,
`shiftLightness`, `luminance`, `contrastContent`) from
`lib/theme-dsui/src/daisy-theme.ts`, which `lib/theme-hypr` already duplicates in
its own form. Extracting a shared colour lib would mean editing two working
packages; it is a reasonable follow-up, not something this package did on its
way past.
