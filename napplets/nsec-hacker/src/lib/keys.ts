/**
 * Ephemeral keypair generation and nostr encoding.
 *
 * ## About the private keys in this file
 *
 * This napplet generates secret keys. That deserves an explicit note, because
 * `docs/boundaries.md` and the napplet design skills say a napplet must never
 * handle a raw private key -- a rule aimed squarely at *the user's* key and at
 * app-owned signing.
 *
 * Nothing here goes near either. Every key below is:
 *
 *   - generated locally from `crypto.getRandomValues` (via nostr-tools),
 *   - never the user's key, and never derived from anything the user owns,
 *   - never persisted -- no NAP-STORAGE, no browser storage, no config,
 *   - never published, never sent over any wire, never handed to a signer,
 *   - never used to sign or encrypt anything,
 *   - discarded when the run ends and the references drop.
 *
 * The napplet reads the user's *public* key through NAP-IDENTITY, which is
 * read-only by design, and compares it against these throwaway guesses. That is
 * the entire joke: the search space is 2^256, so it always loses.
 *
 * ## Import discipline (load-bearing)
 *
 * Import ONLY from `nostr-tools/pure` and `nostr-tools/nip19`. The package root
 * (`nostr-tools`) re-exports the relay and pool modules, which reference
 * `WebSocket` -- and conformance runs a *static* scan over the built bundle, so
 * even a dead reference fails the build. These two subpaths are verified free of
 * every forbidden pattern.
 */

import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode, nsecEncode } from 'nostr-tools/nip19';

export interface Keypair {
  /** Ephemeral. See the file header: never stored, never signed with. */
  secret: Uint8Array;
  /** 64-char lowercase hex x-only pubkey. */
  pubkey: string;
}

/** One throwaway keypair. */
export function randomKeypair(): Keypair {
  const secret = generateSecretKey();
  return { secret, pubkey: getPublicKey(secret) };
}

export function toNpub(pubkeyHex: string): string {
  return npubEncode(pubkeyHex);
}

export function toNsec(secret: Uint8Array): string {
  return nsecEncode(secret);
}

/** How many leading hex characters two pubkeys share. */
export function sharedPrefix(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let shared = 0;
  while (shared < limit && a[shared] === b[shared]) shared += 1;
  return shared;
}

/** `npub1abc...wxyz`, for readouts too narrow to show the whole thing. */
export function truncateMiddle(value: string, head = 12, tail = 8): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

/** True for a 64-char lowercase hex pubkey, the only shape worth comparing. */
export function isPubkeyHex(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}
