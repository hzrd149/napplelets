import { afterEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  themeGet: vi.fn(),
  themeOnChanged: vi.fn(),
}));

vi.mock('@napplet/sdk', () => sdk);

import { installThemeClient } from './index';
import { buildXpThemeVariables, isDarkXpTheme, isXpThemeHex } from './xp-theme';

const LIGHT = { background: '#f8fafc', text: '#0f172a', primary: '#2563eb' };
const DARK = { background: '#14110c', text: '#f5f1e8', primary: '#9be564' };

/** Every colour token the client manages. If any survives a malformed theme, a
 * napplet ends up with half a palette. */
const COLOR_TOKENS = [
  '--surface',
  '--button-face',
  '--button-highlight',
  '--button-shadow',
  '--window-frame',
  '--dialog-blue',
  '--link-blue',
  '--xp-text',
  '--xp-title-bar-bg',
  '--xp-frame-outer-br',
];

function withThemeDomain(): void {
  Object.defineProperty(globalThis, 'napplet', {
    configurable: true,
    value: { theme: {} },
  });
}

function styleOf(name: string): string {
  return document.documentElement.style.getPropertyValue(name);
}

afterEach(() => {
  sdk.themeGet.mockReset();
  sdk.themeOnChanged.mockReset();
  Reflect.deleteProperty(globalThis, 'napplet');
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-xp-theme');
});

describe('installThemeClient', () => {
  it('survives a diagnostic runtime that injects an incomplete theme domain', () => {
    withThemeDomain();
    sdk.themeGet.mockImplementation(() => {
      throw new Error('theme.get is unavailable');
    });
    sdk.themeOnChanged.mockImplementation(() => {
      throw new Error('theme.onChanged is unavailable');
    });

    expect(() => installThemeClient()).not.toThrow();
    expect(document.documentElement.dataset.xpTheme).toBe('light');
    // Nothing inline: authentic Luna is the stylesheet's own default, and
    // writing it back would make it un-overridable.
    for (const token of COLOR_TOKENS) expect(styleOf(token)).toBe('');
  });

  it('does nothing at all when the shell offers no theme domain', () => {
    const handle = installThemeClient();

    expect(sdk.themeGet).not.toHaveBeenCalled();
    expect(sdk.themeOnChanged).not.toHaveBeenCalled();
    expect(() => handle.close()).not.toThrow();
  });

  it('maps a light shell theme onto the XP tokens', async () => {
    withThemeDomain();
    sdk.themeGet.mockResolvedValue({
      colors: LIGHT,
      fonts: { body: { name: 'Inter', url: 'https://example.com/inter.woff2' } },
    });
    sdk.themeOnChanged.mockReturnValue({ close: vi.fn() });

    installThemeClient();
    await Promise.resolve();

    expect(document.documentElement.dataset.xpTheme).toBe('light');
    expect(styleOf('color-scheme')).toBe('light');
    expect(styleOf('--surface')).toBe('#f8fafc');
    expect(styleOf('--button-face')).toBe('#f8fafc');
    expect(styleOf('--dialog-blue')).toBe('#2563eb');
    expect(styleOf('--link-blue')).toBe('#2563eb');
    expect(styleOf('--xp-text')).toBe('#0f172a');
    expect(styleOf('--xp-font-body')).toContain('Inter');
    // The title bar is rebuilt around the shell's primary, not left as Luna blue.
    expect(styleOf('--xp-title-bar-bg')).toMatch(/^linear-gradient\(180deg, #/);
    expect(styleOf('--xp-title-bar-bg')).not.toContain('#0050ee');
  });

  it('applies changed theme snapshots from the subscription', () => {
    withThemeDomain();
    let onChanged: ((theme: unknown) => void) | undefined;
    sdk.themeGet.mockResolvedValue({ colors: DARK });
    sdk.themeOnChanged.mockImplementation((callback) => {
      onChanged = callback;
      return { close: vi.fn() };
    });

    installThemeClient();
    onChanged?.({ colors: { background: '#ffffff', text: '#111827', primary: '#16a34a' } });

    expect(document.documentElement.dataset.xpTheme).toBe('light');
    expect(styleOf('--surface')).toBe('#ffffff');
    expect(styleOf('--dialog-blue')).toBe('#16a34a');
  });

  it('falls back to authentic XP when shell colors are not #rrggbb', async () => {
    withThemeDomain();
    // A light background in a form the palette maths cannot consume. Applying it
    // alone would leave light surfaces under XP's dark default text.
    sdk.themeGet.mockResolvedValue({
      colors: { background: '#fff', text: 'rgb(15, 23, 42)', primary: 'blue' },
      fonts: { body: { name: 'Inter' } },
    });
    sdk.themeOnChanged.mockReturnValue({ close: vi.fn() });

    installThemeClient();
    await Promise.resolve();

    for (const token of COLOR_TOKENS) expect(styleOf(token)).toBe('');
    // The font is independent of the colour maths and still applies.
    expect(styleOf('--xp-font-body')).toContain('Inter');
  });

  it('clears a previous theme when the shell later sends a malformed one', () => {
    withThemeDomain();
    let onChanged: ((theme: unknown) => void) | undefined;
    sdk.themeGet.mockResolvedValue({ colors: DARK });
    sdk.themeOnChanged.mockImplementation((callback) => {
      onChanged = callback;
      return { close: vi.fn() };
    });

    installThemeClient();
    onChanged?.({ colors: LIGHT });
    expect(styleOf('--surface')).toBe('#f8fafc');

    // Stale inline values outrank every `:root` rule, so they have to go --
    // otherwise the napplet keeps a palette the shell has withdrawn.
    onChanged?.({ colors: { background: 'papayawhip', text: 'black', primary: 'red' } });
    for (const token of COLOR_TOKENS) expect(styleOf(token)).toBe('');
  });

  it('closes the subscription on close()', () => {
    withThemeDomain();
    const close = vi.fn();
    sdk.themeGet.mockResolvedValue({ colors: DARK });
    sdk.themeOnChanged.mockReturnValue({ close });

    installThemeClient().close();

    expect(close).toHaveBeenCalledOnce();
  });
});

describe('buildXpThemeVariables', () => {
  it('reproduces the original Luna gradient and frame when fed XP’s own blue', () => {
    const variables = buildXpThemeVariables({
      background: '#ece9d8',
      text: '#222222',
      primary: '#0050ee',
    });

    // The gradient tables are stored as HSL offsets from #0050ee, so feeding
    // that colour back must return the exact stops XP.css ships.
    expect(variables['--xp-title-bar-bg']).toBe(
      'linear-gradient(180deg, #0997ff 0%, #0053ee 8%, #0050ee 40%, #0066ff 88%, ' +
        '#0066ff 93%, #005bff 95%, #003dd7 96%, #003dd7 100%)',
    );
    expect(variables['--xp-frame-outer-br']).toBe('#00138c');
    expect(variables['--xp-frame-outer-tl']).toBe('#0831d9');
    expect(variables['--xp-frame-mid-br']).toBe('#001ea0');
    expect(variables['--xp-frame-mid-tl']).toBe('#166aee');
    expect(variables['--xp-frame-inner-br']).toBe('#003bda');
    expect(variables['--xp-frame-inner-tl']).toBe('#0855dd');
    expect(variables['--xp-title-bar-text-shadow']).toBe('#0f1089');
  });

  it('derives a dark bevel set that stays distinguishable from the surface', () => {
    const variables = buildXpThemeVariables(DARK);

    expect(variables['color-scheme']).toBe('dark');
    expect(variables['--surface']).toBe(DARK.background);
    // A raised bevel needs its highlight lighter than its face and its shadow
    // darker, or every control flattens into the background.
    expect(variables['--button-highlight']).not.toBe(variables['--button-face']);
    expect(variables['--button-shadow']).not.toBe(variables['--button-face']);
    // XP hardcodes a white fieldset; a dark theme that leaves it white puts the
    // shell's light body text on white.
    expect(variables['--xp-fieldset-bg']).not.toBe('#ffffff');
    expect(variables['--xp-field-text']).toBe('#ffffff');
    expect(variables['--xp-tab-text']).toBe('#ffffff');
  });

  it('picks readable title-bar text for light and dark primaries', () => {
    expect(buildXpThemeVariables({ ...LIGHT, primary: '#fde047' })['--xp-title-bar-text']).toBe(
      '#111827',
    );
    expect(buildXpThemeVariables({ ...LIGHT, primary: '#1e3a8a' })['--xp-title-bar-text']).toBe(
      '#ffffff',
    );
  });

  it('rejects colors it cannot parse rather than emitting garbage', () => {
    expect(() => buildXpThemeVariables({ ...LIGHT, primary: 'rebeccapurple' })).toThrow(/#rrggbb/);
    expect(() => buildXpThemeVariables({ ...LIGHT, background: '#fff' })).toThrow(/#rrggbb/);
  });

  it('survives a fully desaturated primary', () => {
    const variables = buildXpThemeVariables({ ...LIGHT, primary: '#808080' });

    expect(variables['--xp-title-bar-bg']).toMatch(/^linear-gradient\(180deg, #[0-9a-f]{6} 0%/);
    for (const value of Object.values(variables)) expect(value).not.toContain('NaN');
  });
});

describe('isXpThemeHex / isDarkXpTheme', () => {
  it('accepts only six-digit hex', () => {
    expect(isXpThemeHex('#0050ee')).toBe(true);
    expect(isXpThemeHex('#0050EE')).toBe(true);
    expect(isXpThemeHex('#fff')).toBe(false);
    expect(isXpThemeHex('rgb(0,0,0)')).toBe(false);
    expect(isXpThemeHex('blue')).toBe(false);
  });

  it('classifies XP’s own beige surface as light', () => {
    expect(isDarkXpTheme({ background: '#ece9d8', text: '#222222', primary: '#0050ee' })).toBe(
      false,
    );
    expect(isDarkXpTheme(DARK)).toBe(true);
  });
});
