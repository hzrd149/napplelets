/**
 * Turns a NAP-THEME payload into something a reader can check against what the
 * window actually looks like.
 *
 * Pure on purpose: this is the part of the showcase that has to be *right*, so
 * it is the part that is tested. Everything here works from the `Theme` shape
 * in `@napplet/nap/theme` -- `colors` required, `fonts`, `background` and
 * `title` optional -- and it never assumes the shell filled a field just
 * because the type says it might.
 */
import { isDarkXpTheme, isXpThemeHex } from '@napplelets/theme-xp';
import type { Theme } from '@napplet/sdk';

/** Where the payload on screen came from. */
export type ThemeSource =
  /** The shell offers no theme domain at all. */
  | { kind: 'unavailable' }
  /** Asked for, not answered yet. */
  | { kind: 'pending' }
  /** The one-shot `theme.get` at boot. */
  | { kind: 'get' }
  /** A shell-pushed `theme.changed`; `count` is how many have arrived. */
  | { kind: 'changed'; count: number }
  /** `theme.get` rejected. */
  | { kind: 'error'; message: string };

export type Tone = 'ok' | 'muted' | 'warn';

export type Fact = { label: string; value: string; tone: Tone };

export type ColorSwatch = { name: string; value: string; valid: boolean };

const COLOR_KEYS = ['background', 'text', 'primary'] as const;

export function describeSource(source: ThemeSource): Fact {
  switch (source.kind) {
    case 'unavailable':
      return {
        label: 'Source',
        value: 'No theme domain — the shell did not inject one. Authentic Luna, from CSS.',
        tone: 'muted',
      };
    case 'pending':
      return { label: 'Source', value: 'theme.get — waiting for the shell…', tone: 'muted' };
    case 'get':
      return { label: 'Source', value: 'theme.get — the payload at boot', tone: 'ok' };
    case 'changed':
      return {
        label: 'Source',
        value: `theme.changed — ${source.count} push${source.count === 1 ? '' : 'es'} so far`,
        tone: 'ok',
      };
    case 'error':
      return { label: 'Source', value: `theme.get failed: ${source.message}`, tone: 'warn' };
  }
}

/** True when all three required colours are `#rrggbb`, which is what the XP token mapping needs. */
export function hasUsableColors(theme: Theme | null): boolean {
  const colors = theme?.colors;
  if (!colors) return false;
  return COLOR_KEYS.every((key) => {
    const value = colors[key];
    return typeof value === 'string' && isXpThemeHex(value);
  });
}

export function describeColors(theme: Theme | null): ColorSwatch[] {
  const colors = theme?.colors;
  return COLOR_KEYS.map((name) => {
    const value = colors?.[name];
    return {
      name,
      value: typeof value === 'string' && value ? value : '—',
      valid: typeof value === 'string' && isXpThemeHex(value),
    };
  });
}

/**
 * The one sentence that explains why the window looks the way it does.
 *
 * theme-xp is all-or-nothing by design: a payload it cannot map is not
 * half-applied, it is dropped, and the stylesheet's own Luna palette shows
 * through. That is a feature worth naming out loud rather than a bug to hide.
 */
export function describePalette(theme: Theme | null, source: ThemeSource): string {
  if (source.kind === 'unavailable')
    return 'Authentic Luna. theme-xp writes no fallback palette on install — its stylesheet already carries a complete one, so there is nothing to fall back to.';
  if (!theme) return 'Nothing applied yet.';
  if (!hasUsableColors(theme))
    return 'The shell sent colours that are not all #rrggbb, so the client removed its inline values rather than half-applying them. This is authentic Luna.';
  return isDarkXpTheme({
    background: theme.colors.background,
    text: theme.colors.text,
    primary: theme.colors.primary,
  })
    ? 'Dark theme: every XP token is re-derived from these three, including the fieldset, tab strip and field text that XP hardcodes light.'
    : 'Light theme: every XP token is re-derived from these three, with the title-bar gradient re-tinted at its original stop offsets.';
}

/** What the shell actually sent, field by field, including the fields it left out. */
export function describePayload(theme: Theme | null): Fact[] {
  if (!theme) return [];

  const facts: Fact[] = [];

  facts.push(
    theme.title
      ? { label: 'title', value: theme.title, tone: 'ok' }
      : { label: 'title', value: 'not sent — optional', tone: 'muted' },
  );

  facts.push({
    label: 'colors',
    value: hasUsableColors(theme)
      ? 'background, text, primary — all #rrggbb'
      : 'present, but not all #rrggbb',
    tone: hasUsableColors(theme) ? 'ok' : 'warn',
  });

  for (const slot of ['body', 'title'] as const) {
    const font = theme.fonts?.[slot];
    facts.push(
      font?.name
        ? { label: `fonts.${slot}`, value: `${font.name} — ${font.url || 'no url'}`, tone: 'ok' }
        : { label: `fonts.${slot}`, value: 'not sent — optional', tone: 'muted' },
    );
  }

  const background = theme.background;
  facts.push(
    background?.url
      ? {
          label: 'background',
          value: `${background.mime || 'unknown type'}, mode ${background.mode || 'unset'}`,
          tone: 'ok',
        }
      : { label: 'background', value: 'not sent — optional', tone: 'muted' },
  );

  return facts;
}

/** The status-bar summary: short enough for a field that ellipsises. */
export function summarize(theme: Theme | null, source: ThemeSource): string {
  if (source.kind === 'unavailable') return 'Theme: none (Luna)';
  if (!theme) return 'Theme: …';
  const name = theme.title ?? (hasUsableColors(theme) ? theme.colors.primary : 'unusable');
  return `Theme: ${name}`;
}
