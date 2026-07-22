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
  const variables: Record<string, string> = {};
  const bodyFont = theme.fonts?.body?.name;
  if (typeof bodyFont === 'string' && bodyFont.trim()) variables['--gm-font-body'] = bodyFont;

  const colors = {
    background: theme.colors.background,
    text: theme.colors.text,
    primary: theme.colors.primary,
  };
  if (!Object.values(colors).every((value) => typeof value === 'string' && isDaisyThemeHex(value)))
    return variables;

  Object.assign(variables, buildDaisyTheme(colors));
  return variables;
}

export function installDsuiThemeClient(): { close(): void } {
  applyCssVariables(buildDaisyTheme(FALLBACK_COLORS));

  const napplet = (globalThis as unknown as { napplet?: { theme?: unknown } }).napplet;
  if (!napplet?.theme) return { close: () => undefined };

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

export const installThemeClient = installDsuiThemeClient;
export { buildDaisyTheme, buildDaisyThemeColors, isDaisyThemeHex, isDarkDaisyTheme } from './daisy-theme';
export type { DaisyThemeInput, DaisyThemeVariables } from './daisy-theme';
