import { afterEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  link: { open: vi.fn() },
}));

vi.mock('@napplet/sdk', () => sdk);

import { openExternalLink } from './link-client';

afterEach(() => {
  sdk.link.open.mockReset();
  Reflect.deleteProperty(globalThis, 'napplet');
});

describe('openExternalLink', () => {
  it('returns false without calling the SDK when NAP-LINK is unavailable', async () => {
    sdk.link.open.mockResolvedValue({ status: 'opened' });

    await expect(openExternalLink('https://example.com')).resolves.toBe(false);
    expect(sdk.link.open).not.toHaveBeenCalled();
  });

  it('returns false when a diagnostic runtime exposes an incomplete link domain', async () => {
    Object.defineProperty(globalThis, 'napplet', {
      configurable: true,
      value: { link: {} },
    });
    sdk.link.open.mockRejectedValue(new Error('link.open is unavailable'));

    await expect(openExternalLink('https://example.com')).resolves.toBe(false);
  });

  it('opens through the SDK when NAP-LINK is injected', async () => {
    Object.defineProperty(globalThis, 'napplet', {
      configurable: true,
      value: { link: {} },
    });
    sdk.link.open.mockResolvedValue({ status: 'opened' });

    await expect(openExternalLink('https://example.com')).resolves.toBe(true);
    expect(sdk.link.open).toHaveBeenCalledWith('https://example.com');
  });
});
