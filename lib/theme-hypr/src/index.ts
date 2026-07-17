import { themeGet, themeOnChanged } from '@napplet/sdk';
import type { Theme } from '@napplet/sdk';

const FALLBACK_VARIABLES: Record<string, string> = {
  '--hg-bg-base': '#14110c',
  '--hg-bg-surface': '#1a1a1a',
  '--hg-bg-elevated': '#242016',
  '--hg-bg-overlay': '#080706',
  '--hg-border-default': '#4a453c',
  '--hg-border-dim': '#3a3a3a',
  '--hg-text-primary': '#f5f1e8',
  '--hg-text-secondary': '#d8d0c0',
  '--hg-text-muted': '#b8b1a4',
  '--hg-text-dim': '#776f62',
  '--hg-accent-green': '#9be564',
  '--hg-accent-amber': '#e5c464',
  '--hg-accent-red': '#ff7369',
  '--hg-font-body': "ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, Consolas, monospace",
  '--hg-font-mono': "ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, Consolas, monospace",
};

const THEME_COLOR_MAP: Record<'background' | 'text' | 'primary', string> = {
  background: '--hg-bg-base',
  text: '--hg-text-primary',
  primary: '--hg-accent-green',
};

function applyCssVariables(values: Record<string, string>): void {
  const style = document.documentElement.style;
  for (const [name, value] of Object.entries(values)) style.setProperty(name, value);
  for (const [name, value] of Object.entries(values)) {
    const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
    if (!match) continue;
    const hex = match[1]!;
    style.setProperty(
      `${name}-rgb`,
      `${parseInt(hex.slice(0, 2), 16)} ${parseInt(hex.slice(2, 4), 16)} ${parseInt(hex.slice(4, 6), 16)}`,
    );
  }
}

function variablesForTheme(theme: Theme): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const [themeKey, cssVar] of Object.entries(THEME_COLOR_MAP)) {
    const value = theme.colors[themeKey as keyof typeof THEME_COLOR_MAP];
    if (typeof value === 'string' && value.trim()) variables[cssVar] = value;
  }
  const bodyFont = theme.fonts?.body?.name;
  if (typeof bodyFont === 'string' && bodyFont.trim()) variables['--hg-font-body'] = bodyFont;
  return variables;
}

export function installHyprThemeClient(): { close(): void } {
  applyCssVariables(FALLBACK_VARIABLES);

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

export const installThemeClient = installHyprThemeClient;
