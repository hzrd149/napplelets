/**
 * Maps a NAP-THEME payload onto XP.css's design tokens.
 *
 * NAP-THEME is a three-colour surface -- `background`, `text`, `primary` -- so
 * everything else (the raised/sunken bevels, the title-bar gradient, the window
 * frame) is derived here.
 *
 * The gradient and frame tables below are not invented. Each entry records the
 * HSL offset of one real stop from XP.css's own Luna title bar / window frame
 * (and winXP's inactive title bar) relative to `#0050ee`, the body colour of the
 * active gradient. Re-tinting therefore preserves the hand-tuned *shape* of the
 * original -- the highlight at the top, the darker lip at the bottom -- and only
 * moves the hue.
 *
 * The colour helpers are copied from `lib/theme-dsui/src/daisy-theme.ts`, which
 * `lib/theme-hypr` already duplicates in its own form. Extracting a shared
 * colour lib would mean editing two working packages; see README.md.
 */

export type XpThemeInput = {
  background: string;
  text: string;
  primary: string;
};

export type XpThemeVariables = Record<string, string>;

const HEX = /^#[0-9a-f]{6}$/i;

type Rgb = { r: number; g: number; b: number };
type Hsl = { h: number; s: number; l: number };

/** One stop of a re-tintable gradient, as an HSL offset from the reference blue. */
type Stop = { at: string; dl: number; ds: number; dh: number };

export function isXpThemeHex(value: string): boolean {
  return HEX.test(value);
}

function assertHex(value: string, name: string): void {
  if (!isXpThemeHex(value)) throw new Error(`${name} must be a #rrggbb color`);
}

function hexToRgb(hex: string): Rgb {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function componentToHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, '0');
}

function rgbToHex({ r, g, b }: Rgb): string {
  return `#${componentToHex(r)}${componentToHex(g)}${componentToHex(b)}`;
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h * 60, s, l };
}

function hueToRgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const hn = h / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: hueToRgb(p, q, hn + 1 / 3) * 255,
    g: hueToRgb(p, q, hn) * 255,
    b: hueToRgb(p, q, hn - 1 / 3) * 255,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function shiftLightness(hex: string, amount: number): string {
  const hsl = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb({ ...hsl, l: clamp01(hsl.l + amount) }));
}

function mix(a: string, b: string, weight: number): string {
  const ar = hexToRgb(a);
  const br = hexToRgb(b);
  return rgbToHex({
    r: ar.r * (1 - weight) + br.r * weight,
    g: ar.g * (1 - weight) + br.g * weight,
    b: ar.b * (1 - weight) + br.b * weight,
  });
}

function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const [rs, gs, bs] = [r, g, b].map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rs! + 0.7152 * gs! + 0.0722 * bs!;
}

function contrastContent(hex: string): string {
  return luminance(hex) > 0.5 ? '#111827' : '#ffffff';
}

/** Applies one recorded HSL offset to the target primary. */
function applyStop(base: Hsl, stop: Stop): string {
  return rgbToHex(
    hslToRgb({
      h: (base.h + stop.dh + 360) % 360,
      s: clamp01(base.s + stop.ds),
      l: clamp01(base.l + stop.dl),
    }),
  );
}

function gradient(base: Hsl, stops: readonly Stop[]): string {
  return `linear-gradient(180deg, ${stops.map((s) => `${applyStop(base, s)} ${s.at}`).join(', ')})`;
}

/**
 * XP.css's active Luna title bar, as offsets from `#0050ee`:
 * `linear-gradient(180deg,#0997ff,#0053ee 8%,#0050ee 40%,#06f 88%,#06f 93%,#005bff 95%,#003dd7 96%,#003dd7)`
 */
const TITLE_BAR_ACTIVE: readonly Stop[] = [
  { at: '0%', dl: 0.051, ds: 0, dh: -14.5 },
  { at: '8%', dl: 0, ds: 0, dh: -0.8 },
  { at: '40%', dl: 0, ds: 0, dh: 0 },
  { at: '88%', dl: 0.0333, ds: 0, dh: -3.8 },
  { at: '93%', dl: 0.0333, ds: 0, dh: -3.8 },
  { at: '95%', dl: 0.0333, ds: 0, dh: -1.2 },
  { at: '96%', dl: -0.0451, ds: 0, dh: 3.1 },
  { at: '100%', dl: -0.0451, ds: 0, dh: 3.1 },
];

/**
 * The inactive title bar, reimplemented from winXP's gradient
 * (`src/WinXP/Windows/index.js`, MIT, Copyright (c) 2019 Shizuku Yang). Lighter
 * and heavily desaturated -- that desaturation is what reads as "not focused".
 */
const TITLE_BAR_INACTIVE: readonly Stop[] = [
  { at: '0%', dl: 0.2176, ds: -0.2981, dh: 2.6 },
  { at: '3%', dl: 0.2255, ds: -0.3567, dh: 1.2 },
  { at: '6%', dl: 0.2784, ds: -0.3538, dh: 0.9 },
  { at: '8%', dl: 0.2863, ds: -0.3492, dh: -1.1 },
  { at: '14%', dl: 0.2353, ds: -0.3553, dh: -1.3 },
  { at: '17%', dl: 0.2196, ds: -0.3625, dh: -0.4 },
  { at: '25%', dl: 0.2059, ds: -0.3952, dh: 2.9 },
  { at: '56%', dl: 0.2157, ds: -0.3704, dh: 2.5 },
  { at: '81%', dl: 0.2451, ds: -0.2993, dh: -2.6 },
  { at: '89%', dl: 0.2373, ds: -0.3179, dh: -1.4 },
  { at: '94%', dl: 0.2157, ds: -0.3704, dh: 4.3 },
  { at: '97%', dl: 0.2098, ds: -0.3879, dh: 5.3 },
  { at: '100%', dl: 0.3137, ds: -0.5, dh: 4.1 },
];

/**
 * The six `box-shadow` layers of `.window`, outermost first, alternating
 * bottom-right / top-left. From XP.css:
 * `inset -1px -1px #00138c, inset 1px 1px #0831d9, inset -2px -2px #001ea0,
 *  inset 2px 2px #166aee, inset -3px -3px #003bda, inset 3px 3px #0855dd`
 */
const FRAME_LAYERS: readonly { name: string; stop: Stop }[] = [
  { name: '--xp-frame-outer-br', stop: { at: '', dl: -0.1922, ds: 0, dh: 12 } },
  { name: '--xp-frame-outer-tl', stop: { at: '', dl: -0.0255, ds: -0.0711, dh: 8.4 } },
  { name: '--xp-frame-mid-br', stop: { at: '', dl: -0.1529, ds: 0, dh: 8.9 } },
  { name: '--xp-frame-mid-tl', stop: { at: '', dl: 0.0431, ds: -0.136, dh: -3.2 } },
  { name: '--xp-frame-inner-br', stop: { at: '', dl: -0.0392, ds: 0, dh: 3.9 } },
  { name: '--xp-frame-inner-tl', stop: { at: '', dl: -0.0176, ds: -0.0699, dh: -1.5 } },
];

/** A shell background at or below this relative luminance is treated as dark. */
const DARK_THRESHOLD = 0.56;

export function isDarkXpTheme(input: XpThemeInput): boolean {
  assertHex(input.background, 'background');
  return luminance(input.background) <= DARK_THRESHOLD;
}

/**
 * Builds the full XP token set for a shell theme.
 *
 * Throws if any input is not `#rrggbb`; callers should gate on
 * {@link isXpThemeHex} and keep the authentic fallback instead.
 */
export function buildXpThemeVariables(input: XpThemeInput): XpThemeVariables {
  assertHex(input.background, 'background');
  assertHex(input.text, 'text');
  assertHex(input.primary, 'primary');

  const { background, text, primary } = input;
  const dark = isDarkXpTheme(input);
  const white = '#ffffff';
  const black = '#000000';
  const primaryHsl = rgbToHsl(hexToRgb(primary));

  const variables: XpThemeVariables = {
    'color-scheme': dark ? 'dark' : 'light',

    // Surfaces and bevels. XP's raised/sunken borders are built from these four
    // in `--border-*`, so tinting them re-bevels every control at once.
    '--surface': background,
    '--button-face': background,
    '--button-highlight': mix(background, white, dark ? 0.35 : 0.75),
    '--button-shadow': mix(background, black, 0.45),
    '--window-frame': mix(background, black, dark ? 0.55 : 0.8),

    // Accents.
    '--dialog-blue': primary,
    '--dialog-blue-light': shiftLightness(primary, 0.15),
    '--link-blue': primary,
    '--input-border-color': mix(primary, background, 0.45),

    // Ours, consumed by patch.css / patch-xp.css.
    '--xp-text': text,
    '--xp-text-dim': mix(text, background, 0.45),
    // Text inputs, textareas, selects and the tree view all sit on
    // `--button-highlight`, so their text has to contrast with that rather than
    // with the window surface.
    '--xp-field-text': contrastContent(mix(background, white, dark ? 0.35 : 0.75)),

    // XP hardcodes a white fieldset, a blue legend and a near-white tab strip.
    // Left alone they turn a dark theme into light-text-on-white.
    '--xp-fieldset-bg': dark ? mix(background, white, 0.1) : white,
    '--xp-fieldset-border': mix(background, text, 0.25),
    '--xp-legend-text': dark ? shiftLightness(primary, 0.18) : primary,
    '--xp-tab-bg': `linear-gradient(180deg, ${mix(background, white, dark ? 0.16 : 0.7)} 0%, ${mix(
      background,
      dark ? white : black,
      dark ? 0.06 : 0.04,
    )} 100%)`,
    '--xp-tab-text': contrastContent(mix(background, white, dark ? 0.16 : 0.7)),
    '--xp-tab-bg-selected': dark ? mix(background, white, 0.1) : mix(background, white, 0.85),
    '--xp-tab-border': mix(background, text, 0.35),
    '--xp-tab-accent': primary,
    '--xp-tab-accent-light': shiftLightness(primary, 0.2),
    '--xp-panel-edge': mix(background, white, dark ? 0.12 : 0.9),
    '--xp-treeview-border': mix(primary, background, 0.5),

    '--xp-title-bar-bg': gradient(primaryHsl, TITLE_BAR_ACTIVE),
    '--xp-title-bar-bg-inactive': gradient(primaryHsl, TITLE_BAR_INACTIVE),
    '--xp-title-bar-text': contrastContent(primary),
    '--xp-title-bar-text-inactive': contrastContent(applyStop(primaryHsl, TITLE_BAR_INACTIVE[7]!)),
    // The frame of an inactive window, desaturated to match its title bar.
    '--xp-frame-inactive': applyStop(primaryHsl, { at: '', dl: 0.098, ds: -0.5315, dh: 4 }),
    // XP.css's `text-shadow: 1px 1px #0f1089` on the title bar, as an offset.
    '--xp-title-bar-text-shadow': applyStop(primaryHsl, {
      at: '',
      dl: -0.1686,
      ds: -0.1974,
      dh: 19.7,
    }),
    '--xp-menu-highlight': primary,
    '--xp-menu-highlight-text': contrastContent(primary),
  };

  for (const { name, stop } of FRAME_LAYERS) variables[name] = applyStop(primaryHsl, stop);

  return variables;
}
