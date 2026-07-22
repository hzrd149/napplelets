import { themeGet, themeOnChanged } from '@napplet/sdk';
import type { Theme } from '@napplet/sdk';

type Rgb = [number, number, number];

const FALLBACK_VARIABLES: Record<string, string> = {
  '--hg-color-scheme': 'dark',
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

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function parseHexColor(value: string | undefined): Rgb | null {
  if (!value) return null;
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const hex = match[1]!;
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((channel) => clampChannel(channel).toString(16).padStart(2, '0')).join('')}`;
}

function mix(color: Rgb, target: Rgb, amount: number): Rgb {
  return color.map((channel, index) => channel + (target[index]! - channel) * amount) as Rgb;
}

function relativeLuminance([r, g, b]: Rgb): number {
  const [rr, gg, bb] = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rr! + 0.7152 * gg! + 0.0722 * bb!;
}

function applyCssVariables(values: Record<string, string>): void {
  const style = document.documentElement.style;
  for (const [name, value] of Object.entries(values)) style.setProperty(name, value);
  const colorScheme = values['--hg-color-scheme'];
  if (colorScheme === 'light' || colorScheme === 'dark') document.documentElement.dataset.hgTheme = colorScheme;
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
  const bodyFont = theme.fonts?.body?.name;
  if (typeof bodyFont === 'string' && bodyFont.trim()) variables['--hg-font-body'] = bodyFont;

  const background = parseHexColor(theme.colors.background);
  const text = parseHexColor(theme.colors.text);
  const primary = parseHexColor(theme.colors.primary);
  // All or nothing, as in theme-dsui. Applying the shell's base colors without
  // the derived surfaces, borders, and dim text would leave a light background
  // sitting on the dark fallback palette -- an unreadable half-theme -- and
  // would skip `data-hg-theme`, so consumers' light-mode rules never engage.
  // A shell sending `#fff`, `rgb(...)`, or a named color keeps the coherent
  // fallback instead.
  if (background && text && primary) {
    for (const [themeKey, cssVar] of Object.entries(THEME_COLOR_MAP)) {
      const value = theme.colors[themeKey as keyof typeof THEME_COLOR_MAP];
      if (typeof value === 'string' && value.trim()) variables[cssVar] = value;
    }
    const isLight = relativeLuminance(background) > 0.56;
    const towardsSurface: Rgb = isLight ? [255, 255, 255] : [0, 0, 0];
    const towardsBorder: Rgb = isLight ? [48, 42, 30] : [255, 255, 255];
    variables['--hg-color-scheme'] = isLight ? 'light' : 'dark';
    variables['--hg-bg-surface'] = toHex(mix(background, towardsSurface, isLight ? 0.44 : 0.12));
    variables['--hg-bg-elevated'] = toHex(mix(background, towardsSurface, isLight ? 0.68 : 0.2));
    variables['--hg-bg-overlay'] = toHex(mix(background, towardsSurface, isLight ? 0.82 : 0.48));
    variables['--hg-border-default'] = toHex(mix(background, towardsBorder, isLight ? 0.2 : 0.28));
    variables['--hg-border-dim'] = toHex(mix(background, towardsBorder, isLight ? 0.12 : 0.18));
    variables['--hg-text-secondary'] = toHex(mix(text, background, 0.32));
    variables['--hg-text-muted'] = toHex(mix(text, background, 0.48));
    variables['--hg-text-dim'] = toHex(mix(text, background, 0.64));
    variables['--hg-accent-amber'] = toHex(isLight ? mix(primary, [245, 158, 11], 0.72) : mix(primary, [229, 196, 100], 0.72));
    variables['--hg-accent-red'] = toHex(isLight ? mix(primary, [220, 38, 38], 0.76) : mix(primary, [255, 115, 105], 0.76));
  }
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
