import { themeGet, themeOnChanged } from '@napplet/sdk';
import type { Theme } from '@napplet/sdk';

import { buildXpThemeVariables, isXpThemeHex } from './xp-theme';
import type { XpThemeVariables } from './xp-theme';

export { buildXpThemeVariables, isDarkXpTheme, isXpThemeHex } from './xp-theme';
export type { XpThemeInput, XpThemeVariables } from './xp-theme';

/**
 * Custom properties written to `<html>` by the most recent apply, so a later
 * apply can drop the ones it no longer sets. Without this, a shell that sends a
 * good theme and then a malformed one would leave the first theme's colours
 * stranded on the element, where they outrank the stylesheet's own defaults.
 */
let managed: string[] = [];

/**
 * Unlike `theme-dsui` and `theme-hypr`, this package does NOT write a fallback
 * palette to `<html>` on install.
 *
 * Those packages have to, because their stylesheets carry no complete palette of
 * their own. Ours does: the rebuilt XP.css keeps its `:root` block, so authentic
 * Luna is already the default in CSS. Writing the same values back as inline
 * styles would only make them un-overridable, since an inline custom property
 * beats every `:root` rule a napplet might add.
 *
 * The all-or-nothing rule the siblings established still holds, it is just
 * expressed by *removing* our inline values rather than by writing fallbacks:
 * a shell sending `#fff`, `rgb(...)` or a named colour gets authentic XP, not an
 * unreadable half-theme.
 */
function applyCssVariables(values: XpThemeVariables): void {
  const style = document.documentElement.style;
  for (const name of managed) {
    if (!(name in values)) style.removeProperty(name);
  }
  for (const [name, value] of Object.entries(values)) style.setProperty(name, value);
  managed = Object.keys(values);

  const scheme = values['color-scheme'];
  document.documentElement.dataset.xpTheme = scheme === 'dark' ? 'dark' : 'light';
}

function variablesForTheme(theme: Theme): XpThemeVariables {
  const variables: XpThemeVariables = {};

  const bodyFont = theme.fonts?.body?.name;
  if (typeof bodyFont === 'string' && bodyFont.trim()) {
    variables['--xp-font-body'] = `${bodyFont}, Arial, "Pixelated MS Sans Serif", sans-serif`;
  }

  const { background, text, primary } = theme.colors ?? {};
  if (
    typeof background === 'string' &&
    typeof text === 'string' &&
    typeof primary === 'string' &&
    isXpThemeHex(background) &&
    isXpThemeHex(text) &&
    isXpThemeHex(primary)
  ) {
    Object.assign(variables, buildXpThemeVariables({ background, text, primary }));
  }

  return variables;
}

/**
 * Subscribes the napplet to the shell's theme and paints it in Windows XP.
 *
 * Safe to call when the shell offers no theme domain, and safe to call before
 * the DOM has any content -- everything it touches lives on `<html>`.
 */
export function installXpThemeClient(): { close(): void } {
  // Authentic Luna is a light theme; consumers' light-mode rules should engage
  // straight away rather than after the first `theme.get` resolves.
  document.documentElement.dataset.xpTheme ??= 'light';

  const napplet = (globalThis as unknown as { napplet?: { theme?: unknown } }).napplet;
  if (!napplet?.theme) return { close: () => undefined };

  try {
    void themeGet()
      .then((theme) => applyCssVariables(variablesForTheme(theme)))
      .catch(() => undefined);
  } catch {
    // The stylesheet's own XP defaults are already in effect.
  }

  let sub: { close(): void } | null = null;
  try {
    sub = themeOnChanged((theme) => applyCssVariables(variablesForTheme(theme)));
  } catch {
    // Theme updates are a degradable enhancement.
  }

  return { close: () => sub?.close() };
}

export const installThemeClient = installXpThemeClient;
