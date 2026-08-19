/**
 * Resolving the pubkey to hunt for, over NAP-IDENTITY.
 *
 * Identity is read-only and always resolves: a hex pubkey when a user is
 * connected, `""` when not. Anything that is not a well-formed hex pubkey
 * becomes `null`, which the UI renders as "NO TARGET" rather than as a failure.
 */

import { identity } from '@napplet/sdk';
import { isPubkeyHex } from './keys.js';
import { attempt, hasMethod } from './nap.js';

/** Current target pubkey, or null when there is nothing to compare against. */
export async function resolveTarget(): Promise<string | null> {
  if (!hasMethod('identity', 'getPublicKey')) return null;
  try {
    const pubkey = (await identity.getPublicKey()).toLowerCase();
    return isPubkeyHex(pubkey) ? pubkey : null;
  } catch {
    return null;
  }
}

/**
 * Watch the active identity. Fires once immediately, then on every change.
 * Returns an unsubscribe function; late results from a superseded identity are
 * dropped so a slow resolve cannot overwrite a newer one.
 */
export function subscribeTarget(onTarget: (target: string | null) => void): () => void {
  let token = 0;
  let closed = false;

  const refresh = (): void => {
    const current = ++token;
    void resolveTarget().then((target) => {
      if (!closed && current === token) onTarget(target);
    });
  };

  refresh();

  if (!hasMethod('identity', 'onChanged')) {
    return () => {
      closed = true;
    };
  }

  const subscription = attempt(() => identity.onChanged(() => refresh()));
  return () => {
    closed = true;
    attempt(() => subscription?.close());
  };
}
