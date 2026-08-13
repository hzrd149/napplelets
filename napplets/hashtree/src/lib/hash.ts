/**
 * SHA-256 over `@noble/hashes` rather than `crypto.subtle`.
 *
 * Deliberate: `crypto.subtle` needs a secure context and is absent from jsdom,
 * which would make the BUD test vectors untestable and add a runtime failure
 * mode that has nothing to do with the protocol. This is synchronous, works
 * anywhere, and every blob passes through it.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from './bytes.js';

export function sha256Bytes(data: Uint8Array): Uint8Array {
  return sha256(data);
}

export function sha256Hex(data: Uint8Array): string {
  return bytesToHex(sha256(data));
}
