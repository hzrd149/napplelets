/**
 * BUD-15 `chk-v1` convergent encryption (decryption half only).
 *
 *   chk_key    = SHA256(plaintext)
 *   aes_key    = HKDF-SHA256(ikm = chk_key, salt = "hashtree-chk",
 *                            info = "encryption-key", length = 32)
 *   ciphertext = AES-256-GCM(aes_key, 12-byte zero nonce) || 16-byte tag
 *   blob_hash  = SHA256(ciphertext)
 *
 * The zero nonce is only safe because `aes_key` is derived from the plaintext,
 * so it is never reused across two different plaintexts. This module therefore
 * refuses to decrypt with a key that does not match the recovered plaintext:
 * BUD-15 marks both the blob_hash and chk_key checks security-critical and says
 * they MUST NOT be skipped as an optimization.
 */

import { gcm } from '@noble/ciphers/aes.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { equalBytes, hexToBytes } from './bytes.js';
import { sha256Bytes } from './hash.js';

const encoder = new TextEncoder();
const HKDF_SALT = encoder.encode('hashtree-chk');
const HKDF_INFO = encoder.encode('encryption-key');
const ZERO_NONCE = new Uint8Array(12);

/** AES-GCM appends a 16-byte authentication tag, so ciphertext is plaintext + 16. */
export const CHK_TAG_BYTES = 16;

export type ChkErrorCode = 'invalid-key' | 'auth-failed' | 'key-mismatch';

export class ChkError extends Error {
  constructor(
    message: string,
    readonly code: ChkErrorCode,
  ) {
    super(message);
    this.name = 'ChkError';
  }
}

export function deriveAesKey(chkKey: Uint8Array): Uint8Array {
  return hkdf(sha256, chkKey, HKDF_SALT, HKDF_INFO, 32);
}

/**
 * Decrypt one CHK blob. `ciphertext` must already have been verified against
 * its `blob_hash` — this function only enforces the second half of the contract.
 */
export function decryptChk(ciphertext: Uint8Array, chkKey: Uint8Array): Uint8Array {
  if (chkKey.length !== 32) {
    throw new ChkError(`chk key must be 32 bytes, got ${chkKey.length}`, 'invalid-key');
  }
  if (ciphertext.length < CHK_TAG_BYTES) {
    throw new ChkError('ciphertext is shorter than the AES-GCM tag', 'auth-failed');
  }

  let plaintext: Uint8Array;
  try {
    plaintext = gcm(deriveAesKey(chkKey), ZERO_NONCE).decrypt(ciphertext);
  } catch {
    throw new ChkError('AES-GCM authentication failed', 'auth-failed');
  }

  if (!equalBytes(sha256Bytes(plaintext), chkKey)) {
    throw new ChkError('SHA256(plaintext) does not match the chk key', 'key-mismatch');
  }
  return plaintext;
}

/** Convenience wrapper for the hex keys carried in links, URIs and event tags. */
export function decryptChkHex(ciphertext: Uint8Array, chkKeyHex: string): Uint8Array {
  const key = hexToBytes(chkKeyHex);
  if (key === null || key.length !== 32) {
    throw new ChkError('chk key must be 64 hex characters', 'invalid-key');
  }
  return decryptChk(ciphertext, key);
}
