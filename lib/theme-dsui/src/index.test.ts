import { afterEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  themeGet: vi.fn(),
  themeOnChanged: vi.fn(),
}));

vi.mock('@napplet/sdk', () => sdk);

import { buildDaisyTheme, installThemeClient, isDarkDaisyTheme } from './index';

afterEach(() => {
  sdk.themeGet.mockReset();
  sdk.themeOnChanged.mockReset();
  Reflect.deleteProperty(globalThis, 'napplet');
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-theme');
});

describe('installThemeClient', () => {
  it('builds compact flat DaisyUI metrics for the Hypr-like baseline', () => {
    const variables = buildDaisyTheme({ background: '#14110c', text: '#f5f1e8', primary: '#9be564' });

    expect(variables['color-scheme']).toBe('dark');
    expect(variables['--radius-selector']).toBe('0.25rem');
    expect(variables['--radius-field']).toBe('0.25rem');
    expect(variables['--radius-box']).toBe('0.375rem');
    expect(variables['--size-selector']).toBe('0.21875rem');
    expect(variables['--size-field']).toBe('0.21875rem');
    expect(variables['--depth']).toBe('0');
    expect(variables['--noise']).toBe('0');
  });

  it('classifies light and dark shell backgrounds with Hypr-compatible luminance', () => {
    expect(isDarkDaisyTheme({ background: '#14110c', text: '#f5f1e8', primary: '#9be564' })).toBe(
      true,
    );
    expect(isDarkDaisyTheme({ background: '#f8fafc', text: '#0f172a', primary: '#2563eb' })).toBe(
      false,
    );
  });

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
    expect(document.documentElement.getAttribute('data-theme')).toBe('napplet-runtime');
    expect(document.documentElement.style.getPropertyValue('--color-base-100')).toBe('#14110c');
    expect(document.documentElement.style.getPropertyValue('--color-primary')).toBe('#9be564');
    expect(document.documentElement.style.getPropertyValue('--radius-field')).toBe('0.25rem');
  });

  it('maps light shell NAP-THEME colors into DaisyUI runtime variables', async () => {
    Object.defineProperty(globalThis, 'napplet', {
      configurable: true,
      value: { theme: {} },
    });
    sdk.themeGet.mockResolvedValue({
      colors: { background: '#ffffff', text: '#111827', primary: '#2563eb' },
      fonts: { body: { name: 'Inter', url: 'https://example.com/inter.woff2' } },
    });
    sdk.themeOnChanged.mockReturnValue({ close: vi.fn() });

    installThemeClient();
    await Promise.resolve();

    expect(document.documentElement.getAttribute('data-theme')).toBe('napplet-runtime');
    expect(document.documentElement.style.getPropertyValue('--color-base-100')).toBe('#ffffff');
    expect(document.documentElement.style.getPropertyValue('--color-base-content')).toBe('#111827');
    expect(document.documentElement.style.getPropertyValue('--color-primary')).toBe('#2563eb');
    expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe('light');
    expect(document.documentElement.style.getPropertyValue('--gm-font-body')).toBe('Inter');
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

    expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe('light');
    expect(document.documentElement.style.getPropertyValue('--color-base-100')).toBe('#ffffff');
    expect(document.documentElement.style.getPropertyValue('--color-primary')).toBe('#16a34a');
  });

  it('keeps the coherent fallback palette when shell colors are not #rrggbb', async () => {
    Object.defineProperty(globalThis, 'napplet', {
      configurable: true,
      value: { theme: {} },
    });
    sdk.themeGet.mockResolvedValue({
      colors: { background: '#fff', text: 'rgb(15, 23, 42)', primary: 'blue' },
      fonts: { body: { name: 'Inter' } },
    });
    sdk.themeOnChanged.mockReturnValue({ close: vi.fn() });

    installThemeClient();
    await Promise.resolve();

    expect(document.documentElement.style.getPropertyValue('--color-base-100')).toBe('#14110c');
    expect(document.documentElement.style.getPropertyValue('--color-base-content')).toBe('#f5f1e8');
    expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--gm-font-body')).toBe('Inter');
  });
});
