import { describe, expect, it } from 'vitest';
import { decodeBech32, encodeBech32, encodeTlv } from './bech32.js';
import { hexToBytes } from './bytes.js';
import { addressOf, encodeNhash, formatHtreeUri, parseTreeRef } from './refs.js';

const ROOT_HASH = 'ab'.repeat(32);
/** The BUD-18 test vector: TLV payload `0020ab…ab`. */
const NHASH_VECTOR = 'nhash1qqs2h2at4w46h2at4w46h2at4w46h2at4w46h2at4w46h2at4w46h2cym3cqn';

const PUBKEY = '11'.repeat(32);
const NPUB = encodeBech32('npub', hexToBytes(PUBKEY)!);

const naddr = (kind: number, identifier: string, relays: string[] = []) =>
  encodeBech32(
    'naddr',
    encodeTlv([
      { type: 0, value: new TextEncoder().encode(identifier) },
      ...relays.map((relay) => ({ type: 1, value: new TextEncoder().encode(relay) })),
      { type: 2, value: hexToBytes(PUBKEY)! },
      {
        type: 3,
        value: new Uint8Array([(kind >>> 24) & 0xff, (kind >>> 16) & 0xff, (kind >>> 8) & 0xff, kind & 0xff]),
      },
    ]),
  );

const ok = (input: string) => {
  const result = parseTreeRef(input);
  if (!result.ok) throw new Error(`expected ${input} to parse, got: ${result.error}`);
  return result.ref;
};

const err = (input: string) => {
  const result = parseTreeRef(input);
  if (result.ok) throw new Error(`expected ${input} to fail`);
  return result.error;
};

describe('nhash (BUD-18 test vector)', () => {
  it('encodes the documented vector', () => {
    expect(encodeNhash(ROOT_HASH, null)).toBe(NHASH_VECTOR);
  });

  it('decodes the documented vector', () => {
    expect(ok(NHASH_VECTOR)).toEqual({
      kind: 'immutable',
      rootHash: ROOT_HASH,
      rootKey: null,
      path: [],
    });
  });

  it('round-trips a root key as TLV type 5', () => {
    const withKey = encodeNhash(ROOT_HASH, 'cd'.repeat(32));
    expect(withKey).not.toBeNull();
    expect(ok(withKey!)).toMatchObject({ rootHash: ROOT_HASH, rootKey: 'cd'.repeat(32) });
  });

  it('accepts the legacy bare 32 byte payload as a keyless root hash', () => {
    const legacy = encodeBech32('nhash', hexToBytes(ROOT_HASH)!);
    expect(ok(legacy)).toMatchObject({ rootHash: ROOT_HASH, rootKey: null });
  });

  it('rejects a payload with no root hash record', () => {
    const bad = encodeBech32('nhash', encodeTlv([{ type: 5, value: hexToBytes(ROOT_HASH)! }]));
    expect(err(bad)).toMatch(/missing the root manifest hash/);
  });

  it('rejects a corrupted checksum', () => {
    expect(decodeBech32(NHASH_VECTOR.replace(/.$/, 'q'))).toBeNull();
  });

  it('rejects mixed case', () => {
    expect(decodeBech32(`Nhash1${NHASH_VECTOR.slice(6)}`)).toBeNull();
  });
});

describe('htree:// references', () => {
  it('parses the nhash form with a path', () => {
    expect(ok(`htree://${NHASH_VECTOR}/docs/index.html`)).toMatchObject({
      kind: 'immutable',
      rootHash: ROOT_HASH,
      path: ['docs', 'index.html'],
    });
  });

  it('parses the npub form, taking the first segment as the tree name', () => {
    expect(ok(`htree://${NPUB}/photos/2026/summer.jpg`)).toMatchObject({
      kind: 'mutable',
      pubkey: PUBKEY,
      treeName: 'photos',
      eventKind: 30064,
      path: ['2026', 'summer.jpg'],
    });
  });

  it('treats a tree name containing an encoded slash as one segment', () => {
    // BUD-18's own example: htree://npub1example/releases%2Fnostr-vpn/v0.3.0/app.zip
    expect(ok(`htree://${NPUB}/releases%2Fnostr-vpn/v0.3.0/app.zip`)).toMatchObject({
      treeName: 'releases/nostr-vpn',
      path: ['v0.3.0', 'app.zip'],
    });
  });

  it('decodes each path segment independently, never the whole path', () => {
    // %2F inside a path segment would be an entry name containing `/`, which
    // BUD-16 forbids -- it must not silently split into two segments.
    expect(err(`htree://${NHASH_VECTOR}/a%2Fb`)).toMatch(/invalid path segment/);
  });

  it('accepts the gateway path form', () => {
    expect(ok(`/htree/${NHASH_VECTOR}/docs`)).toMatchObject({ path: ['docs'] });
  });

  it('ignores a trailing slash', () => {
    expect(ok(`htree://${NHASH_VECTOR}/docs/`)).toMatchObject({ path: ['docs'] });
  });

  it('rejects an empty interior segment', () => {
    expect(err(`htree://${NHASH_VECTOR}/docs//index.html`)).toMatch(/invalid path segment/);
  });

  it('rejects dot segments', () => {
    expect(err(`htree://${NHASH_VECTOR}/../secrets`)).toMatch(/invalid path segment/);
  });

  it('rejects invalid percent-encoding', () => {
    expect(err(`htree://${NHASH_VECTOR}/%zz`)).toMatch(/invalid percent-encoding/);
  });

  it('requires a tree name for the npub form', () => {
    expect(err(`htree://${NPUB}`)).toMatch(/needs a tree name/);
  });
});

describe('link keys', () => {
  it('reads `k=` from the fragment', () => {
    expect(ok(`htree://${NPUB}/docs#k=${'cd'.repeat(32)}`)).toMatchObject({
      linkKey: 'cd'.repeat(32),
    });
  });

  it('reads `k=` from the query string too, but the fragment wins', () => {
    expect(ok(`htree://${NPUB}/docs?k=${'ab'.repeat(32)}`)).toMatchObject({
      linkKey: 'ab'.repeat(32),
    });
    expect(ok(`htree://${NPUB}/docs?k=${'ab'.repeat(32)}#k=${'cd'.repeat(32)}`)).toMatchObject({
      linkKey: 'cd'.repeat(32),
    });
  });

  it('keeps the query and fragment out of the tree path', () => {
    expect(ok(`htree://${NHASH_VECTOR}/docs?k=${'ab'.repeat(32)}`)).toMatchObject({
      path: ['docs'],
    });
  });

  it('ignores a malformed key rather than treating it as a path', () => {
    expect(ok(`htree://${NHASH_VECTOR}/docs#k=nope`)).toMatchObject({ path: ['docs'] });
  });
});

describe('bare entities', () => {
  it('accepts a bare 64 character root hash', () => {
    expect(ok(ROOT_HASH)).toMatchObject({ kind: 'immutable', rootHash: ROOT_HASH });
  });

  it('accepts an naddr for the hashtree kind', () => {
    expect(ok(naddr(30064, 'photos', ['wss://relay.example']))).toEqual({
      kind: 'mutable',
      pubkey: PUBKEY,
      treeName: 'photos',
      eventKind: 30064,
      relays: ['wss://relay.example'],
      linkKey: null,
      path: [],
    });
  });

  it('accepts the legacy kind 30078', () => {
    expect(ok(naddr(30078, 'photos'))).toMatchObject({ eventKind: 30078 });
  });

  it('rejects an naddr for an unrelated kind', () => {
    expect(err(naddr(30023, 'an-article'))).toMatch(/kind 30023/);
  });

  it('tolerates a nostr: prefix', () => {
    expect(ok(`nostr:${naddr(30064, 'photos')}`)).toMatchObject({ treeName: 'photos' });
  });

  it('explains that a bare npub is not enough', () => {
    expect(err(NPUB)).toMatch(/needs a tree name/);
  });

  it('rejects unrecognised input', () => {
    expect(err('https://example.com/file.txt')).toMatch(/unrecognised reference/);
    expect(err('')).toMatch(/enter a hashtree reference/);
  });
});

describe('formatting', () => {
  it('round-trips an immutable reference through an htree:// URI', () => {
    const ref = ok(`htree://${NHASH_VECTOR}`);
    const uri = formatHtreeUri(ref, ['docs', 'index.html']);
    expect(uri).toBe(`htree://${NHASH_VECTOR}/docs/index.html`);
    expect(ok(uri)).toMatchObject({ path: ['docs', 'index.html'] });
  });

  it('percent-encodes a tree name containing a slash', () => {
    const ref = ok(`htree://${NPUB}/releases%2Fnostr-vpn`);
    expect(formatHtreeUri(ref, ['app.zip'])).toBe(
      `htree://${NPUB}/releases%2Fnostr-vpn/app.zip`,
    );
  });

  it('builds the replaceable event coordinate', () => {
    const ref = ok(`htree://${NPUB}/photos`);
    if (ref.kind !== 'mutable') throw new Error('expected a mutable ref');
    expect(addressOf(ref)).toBe(`30064:${PUBKEY}:photos`);
  });
});
