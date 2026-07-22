import { afterEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  themeGet: vi.fn(),
  themeOnChanged: vi.fn(),
}));

vi.mock('@napplet/sdk', () => sdk);

import { installThemeClient } from './index';

afterEach(() => {
  sdk.themeGet.mockReset();
  sdk.themeOnChanged.mockReset();
  Reflect.deleteProperty(globalThis, 'napplet');
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-hg-theme');
});

describe('installThemeClient', () => {
  it('keeps fallback variables when a diagnostic runtime injects an incomplete theme domain', () => {
    Object.defineProperty(globalThis, 'napplet', {
      configurable: true,
      value: { theme: {} },
    });
    sdk.themeGet.mockImplementation(() => {
      throw new Error('theme.get is unavailable');
    });
    sdk.themeOnChanged.mockImplementation(() => {
      throw new Error('theme.onChanged is unavailable');
    });

    expect(() => installThemeClient()).not.toThrow();
    expect(document.documentElement.dataset.hgTheme).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--hg-bg-base')).toBe('#14110c');
  });

  it('maps light shell NAP-THEME colors into a complete light Hypr palette', async () => {
    Object.defineProperty(globalThis, 'napplet', {
      configurable: true,
      value: { theme: {} },
    });
    sdk.themeGet.mockResolvedValue({
      colors: { background: '#f8fafc', text: '#0f172a', primary: '#2563eb' },
      fonts: { body: { name: 'Inter', url: 'https://example.com/inter.woff2' } },
    });
    sdk.themeOnChanged.mockReturnValue({ close: vi.fn() });

    installThemeClient();
    await Promise.resolve();

    expect(document.documentElement.dataset.hgTheme).toBe('light');
    expect(document.documentElement.style.getPropertyValue('--hg-color-scheme')).toBe('light');
    expect(document.documentElement.style.getPropertyValue('--hg-bg-base')).toBe('#f8fafc');
    expect(document.documentElement.style.getPropertyValue('--hg-bg-overlay')).not.toBe('#080706');
    expect(document.documentElement.style.getPropertyValue('--hg-text-primary')).toBe('#0f172a');
    expect(document.documentElement.style.getPropertyValue('--hg-accent-green')).toBe('#2563eb');
    expect(document.documentElement.style.getPropertyValue('--hg-font-body')).toBe('Inter');
  });

  it('applies changed theme snapshots from NAP-THEME subscriptions', () => {
    Object.defineProperty(globalThis, 'napplet', {
      configurable: true,
      value: { theme: {} },
    });
    let onChanged: ((theme: unknown) => void) | undefined;
    sdk.themeGet.mockResolvedValue({ colors: { background: '#14110c', text: '#f5f1e8', primary: '#9be564' } });
    sdk.themeOnChanged.mockImplementation((callback) => {
      onChanged = callback;
      return { close: vi.fn() };
    });

    installThemeClient();
    onChanged?.({ colors: { background: '#ffffff', text: '#111827', primary: '#16a34a' } });

    expect(document.documentElement.dataset.hgTheme).toBe('light');
    expect(document.documentElement.style.getPropertyValue('--hg-bg-base')).toBe('#ffffff');
    expect(document.documentElement.style.getPropertyValue('--hg-accent-green')).toBe('#16a34a');
  });

  it('keeps the coherent fallback palette when shell colors are not #rrggbb', async () => {
    Object.defineProperty(globalThis, 'napplet', {
      configurable: true,
      value: { theme: {} },
    });
    // A light background in a form the palette maths cannot consume. Applying
    // it alone would leave light-on-dark-fallback text.
    sdk.themeGet.mockResolvedValue({
      colors: { background: '#fff', text: 'rgb(15, 23, 42)', primary: 'blue' },
      fonts: { body: { name: 'Inter' } },
    });
    sdk.themeOnChanged.mockReturnValue({ close: vi.fn() });

    installThemeClient();
    await Promise.resolve();

    expect(document.documentElement.style.getPropertyValue('--hg-bg-base')).toBe('#14110c');
    expect(document.documentElement.style.getPropertyValue('--hg-text-primary')).toBe('#f5f1e8');
    expect(document.documentElement.dataset.hgTheme).toBe('dark');
    // The font is independent of the colour maths and still applies.
    expect(document.documentElement.style.getPropertyValue('--hg-font-body')).toBe('Inter');
  });
});
