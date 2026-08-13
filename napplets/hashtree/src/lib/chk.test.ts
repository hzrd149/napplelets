import { describe, expect, it } from 'vitest';
import { bytesToHex, hexToBytes } from './bytes.js';
import { sha256Hex } from './hash.js';
import { ChkError, decryptChk, decryptChkHex } from './chk.js';

const bytes = (hex: string) => {
  const decoded = hexToBytes(hex);
  if (decoded === null) throw new Error(`bad test fixture hex: ${hex}`);
  return decoded;
};

/** Both BUD-15 test vectors, verbatim. */
const VECTORS = [
  {
    label: 'empty plaintext',
    plaintext: '',
    chkKey: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    ciphertext: '7cd161ae8406d82cdf553c1100d012db',
    blobHash: '346c46e7cc6722c99efe7f7bc316d8f3ff5f025f1031bf94418ef4db891e04cd',
  },
  {
    label: '"hello"',
    plaintext: '68656c6c6f',
    chkKey: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    ciphertext: 'c65308d9c8649ff1c59820d0b3a030db34ad00f92d',
    blobHash: '70b977414934faa6270f323f117d05dbcc412e9d7ba2354b4d0f88f60aad2461',
  },
] as const;

describe('BUD-15 chk-v1', () => {
  it.each(VECTORS)('$label: blob_hash is SHA256(ciphertext)', (vector) => {
    expect(sha256Hex(bytes(vector.ciphertext))).toBe(vector.blobHash);
  });

  it.each(VECTORS)('$label: chk_key is SHA256(plaintext)', (vector) => {
    expect(sha256Hex(bytes(vector.plaintext))).toBe(vector.chkKey);
  });

  it.each(VECTORS)('$label: decrypts to the documented plaintext', (vector) => {
    const plaintext = decryptChk(bytes(vector.ciphertext), bytes(vector.chkKey));
    expect(bytesToHex(plaintext)).toBe(vector.plaintext);
  });

  it('ciphertext is exactly plaintext + the 16 byte tag', () => {
    for (const vector of VECTORS) {
      expect(bytes(vector.ciphertext).length).toBe(bytes(vector.plaintext).length + 16);
    }
  });

  it('accepts a hex key', () => {
    const plaintext = decryptChkHex(bytes(VECTORS[1].ciphertext), VECTORS[1].chkKey);
    expect(new TextDecoder().decode(plaintext)).toBe('hello');
  });
});

describe('chk failure modes', () => {
  const good = VECTORS[1];

  it('rejects a wrong key rather than returning garbage', () => {
    expect(() => decryptChk(bytes(good.ciphertext), bytes('11'.repeat(32)))).toThrow(
      expect.objectContaining({ code: 'auth-failed' }) as unknown as Error,
    );
  });

  it('rejects a tampered ciphertext', () => {
    const tampered = bytes(good.ciphertext);
    tampered[0] ^= 0xff;
    expect(() => decryptChk(tampered, bytes(good.chkKey))).toThrow(ChkError);
  });

  it('rejects a key of the wrong length', () => {
    expect(() => decryptChk(bytes(good.ciphertext), bytes('1122'))).toThrow(
      expect.objectContaining({ code: 'invalid-key' }) as unknown as Error,
    );
    expect(() => decryptChkHex(bytes(good.ciphertext), 'nothex')).toThrow(
      expect.objectContaining({ code: 'invalid-key' }) as unknown as Error,
    );
  });

  it('rejects a ciphertext shorter than the tag', () => {
    expect(() => decryptChk(bytes('0011'), bytes(good.chkKey))).toThrow(ChkError);
  });
});
