import { themeGet, themeOnChanged } from '@napplet/sdk';

interface ThemeLike {
  colors?: Record<string, string>;
  fonts?: Record<string, string>;
}

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

const COLOR_KEYS = {
  bgBase: '--hg-bg-base',
  bgSurface: '--hg-bg-surface',
  bgElevated: '--hg-bg-elevated',
  bgOverlay: '--hg-bg-overlay',
  borderDefault: '--hg-border-default',
  borderMuted: '--hg-border-dim',
  textPrimary: '--hg-text-primary',
  textSecondary: '--hg-text-secondary',
  textMuted: '--hg-text-muted',
  textDim: '--hg-text-dim',
  accentPrimary: '--hg-accent-green',
  accentWarning: '--hg-accent-amber',
  accentDanger: '--hg-accent-red',
} as const;

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

function variablesForTheme(theme: unknown): Record<string, string> {
  if (typeof theme !== 'object' || theme === null) return {};
  const input = theme as ThemeLike;
  const variables: Record<string, string> = {};
  for (const [key, variable] of Object.entries(COLOR_KEYS)) {
    const value = input.colors?.[key];
    if (typeof value === 'string' && value.trim()) variables[variable] = value;
  }
  const body = input.fonts?.body;
  const mono = input.fonts?.mono;
  if (typeof body === 'string' && body.trim()) variables['--hg-font-body'] = body;
  if (typeof mono === 'string' && mono.trim()) variables['--hg-font-mono'] = mono;
  return variables;
}

export function installBuiltInThemeClient(): { close(): void } {
  applyCssVariables(FALLBACK_VARIABLES);
  void themeGet()
    .then((theme) => applyCssVariables(variablesForTheme(theme)))
    .catch(() => undefined);
  try {
    const sub = themeOnChanged((theme) => applyCssVariables(variablesForTheme(theme)));
    return { close: () => sub.close() };
  } catch {
    return { close: () => undefined };
  }
}
