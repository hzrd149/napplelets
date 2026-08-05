/**
 * The XP token surface, as a catalogue.
 *
 * NAP-THEME is three colours. `buildXpThemeVariables` turns them into all of
 * this, and the notes are where each one comes from -- that mapping is the
 * whole reason a three-colour protocol can drive a skin with hand-tuned
 * gradients. Values are not stored here: the showcase reads them off `<html>`
 * with `getComputedStyle`, so the table shows what is genuinely in effect,
 * including the stylesheet's own Luna defaults when no theme is applied.
 */

export type TokenSpec = {
  name: string;
  note: string;
  /** False for tokens whose value is not paintable, like a font stack. */
  swatch?: false;
};

export type TokenGroup = { title: string; tokens: readonly TokenSpec[] };

export const TOKEN_GROUPS: readonly TokenGroup[] = [
  {
    title: 'Surfaces & bevels',
    tokens: [
      { name: '--surface', note: 'background, verbatim' },
      { name: '--button-face', note: 'background, verbatim' },
      { name: '--button-highlight', note: 'background mixed toward white' },
      { name: '--button-shadow', note: 'background mixed toward black' },
      { name: '--window-frame', note: 'background, mixed darkest' },
    ],
  },
  {
    title: 'Accents',
    tokens: [
      { name: '--dialog-blue', note: 'primary, verbatim' },
      { name: '--dialog-blue-light', note: 'primary, lightened' },
      { name: '--link-blue', note: 'primary, verbatim' },
      { name: '--input-border-color', note: 'primary toward background' },
    ],
  },
  {
    title: 'Text',
    tokens: [
      { name: '--xp-text', note: 'text, verbatim' },
      { name: '--xp-text-dim', note: 'text toward background' },
      {
        name: '--xp-field-text',
        note: 'contrast against --button-highlight, not the window surface',
      },
      {
        name: '--xp-font-body',
        note: 'fonts.body.name, with the XP stack behind it',
        swatch: false,
      },
    ],
  },
  {
    title: 'Fieldsets & tabs',
    tokens: [
      { name: '--xp-fieldset-bg', note: 'XP hardcodes white; a dark theme needs its own' },
      { name: '--xp-fieldset-border', note: 'background toward text' },
      { name: '--xp-legend-text', note: 'primary, lifted when dark' },
      { name: '--xp-tab-bg', note: 'gradient off background' },
      { name: '--xp-tab-bg-selected', note: 'background toward white' },
      { name: '--xp-tab-text', note: 'contrast against the tab strip' },
      { name: '--xp-tab-border', note: 'background toward text' },
      { name: '--xp-tab-accent', note: "primary — XP's orange hover lip" },
      { name: '--xp-tab-accent-light', note: 'primary, lightened' },
      { name: '--xp-panel-edge', note: 'background toward white' },
      { name: '--xp-treeview-border', note: 'primary toward background' },
    ],
  },
  {
    title: 'Title bar & frame',
    tokens: [
      { name: '--xp-title-bar-bg', note: "primary at Luna's own eight stop offsets" },
      { name: '--xp-title-bar-bg-inactive', note: "winXP's thirteen-stop desaturated gradient" },
      { name: '--xp-title-bar-text', note: 'contrast against primary' },
      { name: '--xp-title-bar-text-inactive', note: 'contrast against the inactive gradient' },
      { name: '--xp-title-bar-text-shadow', note: "XP's #0f1089, as an offset from primary" },
      { name: '--xp-frame-inactive', note: 'primary, desaturated' },
      { name: '--xp-frame-outer-tl', note: 'window box-shadow layer 1' },
      { name: '--xp-frame-outer-br', note: 'window box-shadow layer 2' },
      { name: '--xp-frame-mid-tl', note: 'window box-shadow layer 3' },
      { name: '--xp-frame-mid-br', note: 'window box-shadow layer 4' },
      { name: '--xp-frame-inner-tl', note: 'window box-shadow layer 5' },
      { name: '--xp-frame-inner-br', note: 'window box-shadow layer 6' },
    ],
  },
  {
    title: 'Menus',
    tokens: [
      { name: '--xp-menu-highlight', note: 'primary, verbatim' },
      { name: '--xp-menu-highlight-text', note: 'contrast against primary' },
    ],
  },
];

/** Reads a token's computed value off `<html>`; '' when the skin does not define it. */
export function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
