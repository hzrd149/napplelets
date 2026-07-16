import { describe, expect, it, vi } from 'vitest';
import { waitForPublicKey } from './identity-client';

describe('waitForPublicKey', () => {
  it('continues polling when an incomplete runtime throws during change subscription', async () => {
    const subscriptionError = new Error('identity.onChanged is unavailable');
    const onError = vi.fn();

    await expect(
      waitForPublicKey(
        {
          getPublicKey: vi.fn().mockResolvedValue('a'.repeat(64)),
          onChanged: () => {
            throw subscriptionError;
          },
        },
        { onError, maxAttempts: 1 },
      ),
    ).resolves.toBe('a'.repeat(64));

    expect(onError).toHaveBeenCalledWith(subscriptionError);
  });
});
