import { themeGet, themeOnChanged } from '@napplet/sdk';
import type { Theme } from '@napplet/sdk';
import { buildDaisyTheme, isDaisyThemeHex } from './daisy-theme';

const RUNTIME_THEME = 'napplet-runtime';

const FALLBACK_COLORS = {
  background: '#14110c',
  text: '#f5f1e8',
  primary: '#9be564',
};

function applyCssVariables(values: Record<string, string>): void {
  document.documentElement.setAttribute('data-theme', RUNTIME_THEME);
  const style = document.documentElement.style;
  for (const [name, value] of Object.entries(values)) style.setProperty(name, value);
}

function variablesForTheme(theme: Theme): Record<string, string> {
  const colors = {
    background: theme.colors.background,
    text: theme.colors.text,
    primary: theme.colors.primary,
  };
  if (!Object.values(colors).every((value) => typeof value === 'string' && isDaisyThemeHex(value)))
    return {};

  const variables = buildDaisyTheme(colors);
  // NAP-THEME fonts are { name, url } objects — use the family name. Loading
  // the font file at `url` requires NAP-RESOURCE + @font-face injection, which
  // is a separate concern; the name alone works when the font is system-installed.
  const bodyFont = theme.fonts?.body?.name;
  if (typeof bodyFont === 'string' && bodyFont.trim()) variables['--gm-font-body'] = bodyFont;
  return variables;
}

export function installBuiltInThemeClient(): { close(): void } {
  applyCssVariables(buildDaisyTheme(FALLBACK_COLORS));

  const napplet = (globalThis as unknown as { napplet?: { theme?: unknown } }).napplet;
  if (!napplet?.theme) return { close: () => undefined };

  // Keep the fallback usable in diagnostic/development runtimes that expose
  // the optional domain but do not implement its complete SDK surface.
  try {
    void themeGet()
      .then((theme) => applyCssVariables(variablesForTheme(theme)))
      .catch(() => undefined);
  } catch {
    // The fallback variables above are already applied.
  }

  let sub: { close(): void } | null = null;
  try {
    sub = themeOnChanged((theme) => applyCssVariables(variablesForTheme(theme)));
  } catch {
    // Theme updates are a degradable enhancement.
  }
  return { close: () => sub?.close() };
}
