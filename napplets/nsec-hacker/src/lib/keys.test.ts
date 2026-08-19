import { describe, expect, it } from 'vitest';
import {
  isPubkeyHex,
  randomKeypair,
  sharedPrefix,
  toNpub,
  toNsec,
  truncateMiddle,
} from './keys.js';

describe('randomKeypair', () => {
  it('derives a 64-char lowercase hex pubkey', () => {
    const { pubkey, secret } = randomKeypair();
    expect(pubkey).toMatch(/^[0-9a-f]{64}$/);
    expect(secret).toBeInstanceOf(Uint8Array);
    expect(secret).toHaveLength(32);
  });

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 16 }, () => randomKeypair().pubkey));
    expect(seen.size).toBe(16);
  });
});

describe('encoding', () => {
  it('encodes an npub that round-trips the pubkey', () => {
    const { pubkey } = randomKeypair();
    expect(toNpub(pubkey)).toMatch(/^npub1[0-9a-z]+$/);
  });

  it('encodes an nsec', () => {
    const { secret } = randomKeypair();
    expect(toNsec(secret)).toMatch(/^nsec1[0-9a-z]+$/);
  });
});

describe('sharedPrefix', () => {
  it('counts nothing when the first char differs', () => {
    expect(sharedPrefix('abc', 'xbc')).toBe(0);
  });

  it('counts a partial run', () => {
    expect(sharedPrefix('abcdef', 'abcxxx')).toBe(3);
  });

  it('counts a full match', () => {
    expect(sharedPrefix('abcdef', 'abcdef')).toBe(6);
  });

  it('stops at the shorter string', () => {
    expect(sharedPrefix('ab', 'abcdef')).toBe(2);
  });
});

describe('truncateMiddle', () => {
  it('leaves short values alone', () => {
    expect(truncateMiddle('npub1short')).toBe('npub1short');
  });

  it('elides the middle of long values', () => {
    const long = `npub1${'q'.repeat(58)}`;
    const out = truncateMiddle(long);
    expect(out.startsWith('npub1qqqqqqq')).toBe(true);
    expect(out).toContain('...');
    expect(out.length).toBeLessThan(long.length);
  });
});

describe('isPubkeyHex', () => {
  it('accepts 64 lowercase hex chars', () => {
    expect(isPubkeyHex('a'.repeat(64))).toBe(true);
  });

  it('rejects empty, short, and uppercase values', () => {
    expect(isPubkeyHex('')).toBe(false);
    expect(isPubkeyHex('abc')).toBe(false);
    expect(isPubkeyHex('A'.repeat(64))).toBe(false);
  });
});
