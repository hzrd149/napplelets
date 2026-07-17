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
  document.documentElement.removeAttribute('data-theme');
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
    expect(document.documentElement.getAttribute('data-theme')).toBe('napplet-runtime');
    expect(document.documentElement.style.getPropertyValue('--color-base-100')).toBe('#14110c');
    expect(document.documentElement.style.getPropertyValue('--color-primary')).toBe('#9be564');
  });

  it('maps shell NAP-THEME colors into DaisyUI runtime variables', async () => {
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
    expect(document.documentElement.style.getPropertyValue('--gm-font-body')).toBe('Inter');
  });
});
