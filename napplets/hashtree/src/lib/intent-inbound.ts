/**
 * Receiving a reference from elsewhere in the shell.
 *
 * NAP-INTENT has no inbound envelope: a napplet declares its `archetypes` in the
 * manifest and the payload arrives over NAP-INC on the matching convention. The
 * subscription must therefore be live *before* anything else runs, or a
 * cold-open intent is delivered into the void.
 */

import { incOn } from '@napplet/sdk';
import { hasDomain } from './nap.js';

/** Declared in `vite.config.ts` as the `hashtree-browser` archetype. */
export const INTENT_CONVENTION = 'napplet:hashtree/open';

/**
 * Pull a reference string out of whatever the sender put in the payload.
 *
 * Deliberately permissive about the envelope and strict about nothing: the
 * result is handed straight to `parseTreeRef`, which is the real validator.
 */
export function parseOpenPayload(payload: unknown): string | null {
  if (typeof payload === 'string') return payload.trim() === '' ? null : payload;
  if (typeof payload !== 'object' || payload === null) return null;

  const record = payload as Record<string, unknown>;
  for (const field of ['uri', 'url', 'reference', 'ref', 'nhash', 'naddr', 'hash']) {
    const value = record[field];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return null;
}

/**
 * Holds references that arrive before the UI is ready to act on them.
 *
 * The NAP-INC subscription is installed in `main.ts` before the app mounts, so a
 * cold open — the shell launching this napplet *because* of an intent — is not
 * dropped in the gap between subscribing and rendering.
 */
export class ReferenceQueue {
  #pending: string[] = [];
  #handler: ((reference: string) => void) | null = null;

  push(reference: string): void {
    if (this.#handler === null) {
      this.#pending.push(reference);
      return;
    }
    this.#handler(reference);
  }

  listen(handler: (reference: string) => void): void {
    this.#handler = handler;
    const queued = this.#pending;
    this.#pending = [];
    for (const reference of queued) handler(reference);
  }
}

export function subscribeInboundIntents(onReference: (reference: string) => void): () => void {
  if (!hasDomain('inc')) return () => undefined;
  try {
    const subscription = incOn(INTENT_CONVENTION, (event) => {
      const reference = parseOpenPayload(event.payload);
      if (reference !== null) onReference(reference);
    });
    return () => subscription.close();
  } catch {
    return () => undefined;
  }
}
