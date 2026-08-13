import { describe, expect, it } from 'vitest';
import { hexToBytes } from './bytes.js';
import { decodeMsgpack, MsgpackError } from './msgpack.js';

const bytes = (hex: string) => {
  const decoded = hexToBytes(hex);
  if (decoded === null) throw new Error(`bad test fixture hex: ${hex}`);
  return decoded;
};

describe('decodeMsgpack', () => {
  it('decodes the scalar forms a tree node uses', () => {
    expect(decodeMsgpack(bytes('00'))).toBe(0);
    expect(decodeMsgpack(bytes('64'))).toBe(100);
    expect(decodeMsgpack(bytes('7f'))).toBe(127);
    expect(decodeMsgpack(bytes('ccff'))).toBe(255);
    expect(decodeMsgpack(bytes('cd0100'))).toBe(256);
    expect(decodeMsgpack(bytes('ce00010000'))).toBe(65536);
    expect(decodeMsgpack(bytes('ff'))).toBe(-1);
    expect(decodeMsgpack(bytes('c0'))).toBeNull();
    expect(decodeMsgpack(bytes('c2'))).toBe(false);
    expect(decodeMsgpack(bytes('c3'))).toBe(true);
  });

  it('decodes 32-byte bin8 values, the form used for hashes and keys', () => {
    const value = decodeMsgpack(bytes(`c420${'ab'.repeat(32)}`));
    expect(value).toBeInstanceOf(Uint8Array);
    expect(value).toHaveLength(32);
  });

  it('decodes arrays longer than a fixarray, as a 174-link node needs', () => {
    const links = '00'.repeat(174);
    const value = decodeMsgpack(bytes(`dc00ae${links}`));
    expect(Array.isArray(value)).toBe(true);
    expect(value).toHaveLength(174);
  });

  it('decodes nested maps with string keys', () => {
    expect(decodeMsgpack(bytes('81a16182a16101a16202'))).toEqual({ a: { a: 1, b: 2 } });
  });

  it('rejects trailing bytes', () => {
    expect(() => decodeMsgpack(bytes('0000'))).toThrow(/trailing/);
  });

  it('rejects truncated input', () => {
    expect(() => decodeMsgpack(bytes('c420abab'))).toThrow(/truncated/);
  });

  it('rejects non-string map keys', () => {
    expect(() => decodeMsgpack(bytes('810100'))).toThrow(/not a string/);
  });

  it('rejects duplicate map keys so a later one cannot shadow an earlier one', () => {
    expect(() => decodeMsgpack(bytes('82a16100a16101'))).toThrow(/duplicate map key/);
  });

  it('rejects extension types instead of skipping them', () => {
    expect(() => decodeMsgpack(bytes('d4ff00'))).toThrow(MsgpackError);
    expect(() => decodeMsgpack(bytes('c70100ff'))).toThrow(/unsupported MessagePack type/);
  });

  it('rejects invalid UTF-8 in strings', () => {
    expect(() => decodeMsgpack(bytes('a1ff'))).toThrow(/invalid UTF-8/);
  });

  it('bounds nesting depth', () => {
    // 40 nested single-element arrays.
    expect(() => decodeMsgpack(bytes(`${'91'.repeat(40)}00`))).toThrow(/nesting deeper/);
  });
});
