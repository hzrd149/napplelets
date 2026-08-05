# XP Theme Showcase

The kitchen sink for [`@napplelets/theme-xp`](../../lib/theme-xp): every
component, all three skins, the opt-in taskbar, the icon set — driven by a live
NAP-THEME payload rather than by a hardcoded palette.

```bash
pnpm dev xp-showcase                        # Paja runtime + HMR, with a real theme domain
pnpm --filter xp-showcase verify            # unit tests + type-check + single-file build
pnpm --filter xp-showcase test:conformance  # NAP conformance on the built artifact
```

`pnpm dev` boots it in Paja, which offers `--theme dark|light` and a live theme
switcher — that is the only way to see `theme.changed` actually arrive. Bare
`pnpm --filter xp-showcase dev` runs it with no shell at all, which is the
degraded path (and worth looking at).

---

## What it is for

Two audiences, one page:

- **Someone choosing a theme package** wants to see what the components look
  like, in the skin they would ship, at the frame size they have.
- **Someone wiring NAP-THEME** wants to see what a payload actually contains,
  what happens to each field, and what happens when a field is missing or
  malformed.

The Theme tab is the second of those. Nothing on it is a mock-up: every value is
either a field the shell sent, a load result from `resource.bytes`, or a custom
property read back off `<html>` with `getComputedStyle`. If the tab and the
window disagree, the tab is wrong.

## The NAP-THEME surface, end to end

`Theme` is `{ colors, fonts?, background?, title? }`. All of it is handled.

| Field                              | What happens                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| `colors.{background,text,primary}` | `installThemeClient()` maps them onto ~40 XP tokens — bevels, gradients, fieldsets, tab strip    |
| `title`                            | Appended to the window title, and summarised in the status bar                                   |
| `fonts.body`                       | `--xp-font-body` gets the family name; the bytes are fetched and registered so the name resolves |
| `fonts.title`                      | Same, applied to the title bar                                                                   |
| `background`                       | Fetched, hung behind the window as wallpaper at the shell's own `mode` as `background-size`      |

Colours are the theme package's job — one line, `installThemeClient()`, and any
napplet gets them. **The other three are not**, and that gap is the interesting
part: `fonts.*.url` and `background.url` are external bytes, and a napplet has
no network. `<link href>`, `@font-face { src: url(https://…) }` and
`<img src>` all resolve to nothing from an opaque origin, and `fetch` is out of
bounds. NAP-RESOURCE is the sanctioned route, so `src/lib/theme-assets.ts` turns
each URL into bytes through `resource.bytes` and only then into a `FontFace` or
an object URL.

That lives here rather than in `@napplelets/theme-xp` on purpose: the theme
package needs only the `theme` domain, and folding this in would make every
consumer declare `resource` as well. If it earns its way upstream it lifts out
whole.

### Degradation is a feature, not a fallback

theme-xp is deliberately all-or-nothing — a payload it cannot map is dropped
rather than half-applied, because its stylesheet already carries a complete Luna
palette. The showcase names each state out loud instead of quietly looking
fine:

- **No theme domain** → authentic Luna, and the tab says so.
- **Colours that are not all `#rrggbb`** → the client removes its inline values;
  the swatch for the bad colour is left empty rather than painted with something
  the window is not wearing.
- **No resource domain** → fonts and wallpaper report "sent, but the bytes
  cannot be fetched" rather than silently falling back to Arial.
- **A resource failure** → the NAP-RESOURCE error code and what it means.

### Domains can be present and hollow

The conformance reference shell injects `napplet[domain] = {}` for every domain
a manifest declares. `napplet.theme` is therefore truthy while
`napplet.theme.get` is not a function, and a presence check alone walks straight
into a `TypeError` at boot — this napplet did, once. `src/lib/shell.ts` splits
the two questions: `hasDomain` for whether the feature should exist at all,
`attempt` for whether this particular call is callable. `src/boot-hollow.test.ts`
is the regression.

## Shell-owned vs reader-owned

| Setting      | Owner                    | Why                                                                                                      |
| ------------ | ------------------------ | -------------------------------------------------------------------------------------------------------- |
| Window frame | `config`                 | Whether the host already draws a title bar is knowledge only the host has                                |
| Skin         | `config`, then `storage` | The placement picks what it opens with; whoever is looking may flip skins to compare, and that is theirs |
| Open tab     | `storage`                | Pure view state                                                                                          |

Turning **Window frame** off is what shows `.xp-frameless`; there is no in-app
toggle for it, because an in-app toggle would be a second source of truth for a
question the shell owns.

## Deliberate omissions

- **20 icons, not 125.** `theme-xp/icons` exports one ES binding per icon so a
  bundler drops what you do not import; importing all of them costs ~244 kB of
  base64, and `theme-xp/icons.css` costs that unconditionally. The artwork is
  Microsoft's and a published napplet artifact is permanent — read
  [`NOTICE.md`](../../lib/theme-xp/NOTICE.md). A showcase that quietly inlined
  the lot would be teaching the wrong lesson.
- **No minimise/maximise/close on the root window.** Those are the shell's
  decisions about the pane and no NAP lets a napplet make them. The full
  five-button set is on the Windows tab as a visual reference instead.
- **The taskbar is a sample inside the Windows tab**, not this napplet's
  navigation. It is host chrome; the repo guidance is to let the shell provide
  it.

## Artifact size

~570 kB (~210 kB gzipped). Roughly two thirds of that is the skin picker: all
three stylesheets ship as strings, and each one carries its own copy of the
~40 kB of base64 woff2. A normal napplet imports one skin the ordinary way and
pays for one. This one is a showcase and the picker is the point.

## Layout

```
src/
  main.ts             boot and wiring
  styles.css          layout only — no colours that are not theme tokens
  lib/
    shell.ts          hasDomain / attempt: the two ways a shell can be missing
    skins.ts          the three skins, swapped at runtime
    theme-report.ts   a Theme payload turned into readable facts (pure, tested)
    theme-assets.ts   fonts and wallpaper, via NAP-RESOURCE
    resource-errors.ts  the code out of a NAP-RESOURCE rejection (pure, tested)
    tokens.ts         the derived-token catalogue
    view-state.ts     storage-backed skin/tab preference (pure, tested)
  ui/                 tabs, menus and dialogs, the theme panel, the icon grid
  test/harness.ts     a fake shell, so the boot tests run the real index.html
```

`src/boot-*.test.ts` load the real `index.html` and import `main.ts` against a
fake shell — themed, bare, and hollow. They are what catches an id renamed in
one file and not the other.

---

Shared authoring context lives at the repo root: [`../../docs/`](../../docs).
See [`../../AGENTS.md`](../../AGENTS.md) before changing protocol-facing
behavior.
