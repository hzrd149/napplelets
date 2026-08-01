import { afterEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  resource: { bytes: vi.fn() },
}));

vi.mock('@napplet/sdk', () => sdk);

import { resourceImageBatch } from './resource-image';

afterEach(() => {
  sdk.resource.bytes.mockReset();
  Reflect.deleteProperty(globalThis, 'napplet');
  vi.restoreAllMocks();
});

describe('resourceImageBatch', () => {
  it('leaves external media unset when NAP-RESOURCE is unavailable', () => {
    const image = document.createElement('img');

    expect(() => resourceImageBatch(image, 'https://example.com/avatar.png')).not.toThrow();
    expect(sdk.resource.bytes).not.toHaveBeenCalled();
    expect(image.hasAttribute('src')).toBe(false);
  });

  it('does not crash when a diagnostic runtime exposes an incomplete resource domain', () => {
    Object.defineProperty(globalThis, 'napplet', {
      configurable: true,
      value: { resource: {} },
    });
    sdk.resource.bytes.mockImplementation(() => {
      throw new Error('resource.bytes is unavailable');
    });
    const image = document.createElement('img');

    expect(() => resourceImageBatch(image, 'https://example.com/avatar.png')).not.toThrow();
    expect(image.hasAttribute('src')).toBe(false);
  });

  it('creates a standard object URL from runtime-provided bytes', async () => {
    Object.defineProperty(globalThis, 'napplet', {
      configurable: true,
      value: { resource: {} },
    });
    sdk.resource.bytes.mockResolvedValue(new Blob(['avatar'], { type: 'image/png' }));
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:avatar');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const image = document.createElement('img');

    const action = resourceImageBatch(image, 'https://example.com/avatar.png');

    await vi.waitFor(() => expect(image.getAttribute('src')).toBe('blob:avatar'));
    expect(sdk.resource.bytes).toHaveBeenCalledWith(
      'https://example.com/avatar.png',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(createObjectURL).toHaveBeenCalledOnce();

    action.destroy?.();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:avatar');
  });
});
