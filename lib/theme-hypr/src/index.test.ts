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
    expect(document.documentElement.style.getPropertyValue('--hg-bg-base')).toBe('#14110c');
  });
});
