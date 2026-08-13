import { describe, expect, it } from 'vitest';
import { hexToBytes } from './bytes.js';
import { sha256Hex } from './hash.js';
import {
  boundsMayContain,
  decodeNode,
  ManifestError,
  nodeSize,
  sliceLinks,
  sortEntriesByName,
} from './manifest.js';

const utf8Hex = (text: string) =>
  [...new TextEncoder().encode(text)].map((b) => b.toString(16).padStart(2, '0')).join('');

const bytes = (hex: string) => {
  const decoded = hexToBytes(hex);
  if (decoded === null) throw new Error(`bad test fixture hex: ${hex}`);
  return decoded;
};

/**
 * Golden vectors from the BUD-16 and BUD-17 drafts. The 32-byte runs are built
 * with `repeat()` so they cannot be mistyped; the documented `manifest_hash` is
 * asserted for every one, which pins both the fixture and our SHA-256 path.
 */
const VECTORS = {
  emptyDir: {
    hex: '82a16c90a17402',
    hash: '0218ed9a4fbb0993757f17e5d08d089cb0c6ac851928ba1ba82d337d76c41c0c',
  },
  singleEntryDir: {
    hex:
      '82a16c91' +
      '84' +
      'a168' +
      'c420' +
      'ab'.repeat(32) +
      'a16e' +
      'a8' +
      utf8Hex('test.txt') +
      'a173' +
      '64' +
      'a174' +
      '00' +
      'a174' +
      '02',
    hash: '16121fa792b3afc72ec8bfc1dc85060518b6adba1429973ecc12891165cbe67e',
  },
  twoChunkFile: {
    hex:
      '82a16c92' +
      '83a168c420' +
      'aa'.repeat(32) +
      'a17364a17400' +
      '83a168c420' +
      'bb'.repeat(32) +
      'a17332a17400' +
      'a17401',
    hash: '559b726c38295aa0ecbbaef43d438cc86dd63324a0c3e9426dc5f1d0285f483f',
  },
  twoChildFanout: {
    hex:
      '82a16c92' +
      '84a168c420' +
      '11'.repeat(32) +
      'a16d83' +
      'a5' +
      utf8Hex('count') +
      '02' +
      'a5' +
      utf8Hex('first') +
      'a5' +
      utf8Hex('a.txt') +
      'a4' +
      utf8Hex('last') +
      'a5' +
      utf8Hex('b.txt') +
      'a1731ea17402' +
      '84a168c420' +
      '22'.repeat(32) +
      'a16d83' +
      'a5' +
      utf8Hex('count') +
      '01' +
      'a5' +
      utf8Hex('first') +
      'a5' +
      utf8Hex('c.txt') +
      'a4' +
      utf8Hex('last') +
      'a5' +
      utf8Hex('c.txt') +
      'a17328a17402' +
      'a17403',
    hash: '6626ab03b5468f417d888fa25fa22b48f5bcb7dfafb88eef34c638d167afc0a3',
  },
} as const;

describe('BUD-16/17 golden vectors', () => {
  it.each(Object.entries(VECTORS))('%s hashes to the documented manifest_hash', (_name, vector) => {
    expect(sha256Hex(bytes(vector.hex))).toBe(vector.hash);
  });

  it('decodes the empty directory manifest', () => {
    const node = decodeNode(bytes(VECTORS.emptyDir.hex));
    expect(node.type).toBe(2);
    expect(node.links).toEqual([]);
    expect(bytes(VECTORS.emptyDir.hex)).toHaveLength(7);
  });

  it('decodes a single-entry directory manifest', () => {
    const node = decodeNode(bytes(VECTORS.singleEntryDir.hex));
    expect(node.type).toBe(2);
    expect(node.links).toHaveLength(1);
    expect(node.links[0]).toEqual({
      hash: 'ab'.repeat(32),
      key: null,
      name: 'test.txt',
      size: 100,
      type: 0,
      metadata: null,
      fanout: null,
    });
    expect(bytes(VECTORS.singleEntryDir.hex)).toHaveLength(61);
  });

  it('decodes a two-chunk file manifest with unnamed links', () => {
    const node = decodeNode(bytes(VECTORS.twoChunkFile.hex));
    expect(node.type).toBe(1);
    expect(node.links.map((link) => [link.hash, link.size, link.type, link.name])).toEqual([
      ['aa'.repeat(32), 100, 0, null],
      ['bb'.repeat(32), 50, 0, null],
    ]);
    expect(nodeSize(node)).toBe(150);
    expect(bytes(VECTORS.twoChunkFile.hex)).toHaveLength(93);
  });

  it('decodes a two-child fanout node with its bounds metadata', () => {
    const node = decodeNode(bytes(VECTORS.twoChildFanout.hex));
    expect(node.type).toBe(3);
    expect(node.links.map((link) => link.fanout)).toEqual([
      { count: 2, first: 'a.txt', last: 'b.txt' },
      { count: 1, first: 'c.txt', last: 'c.txt' },
    ]);
    expect(node.links.map((link) => [link.size, link.type])).toEqual([
      [30, 2],
      [40, 2],
    ]);
    expect(bytes(VECTORS.twoChildFanout.hex)).toHaveLength(159);
  });
});

describe('decodeNode rejections', () => {
  const dirWith = (linkHex: string, linkCount = 1) =>
    `82a16c9${linkCount}${linkHex}a17402`;

  it('rejects an unknown node type instead of guessing', () => {
    expect(() => decodeNode(bytes('82a16c90a17404'))).toThrow(
      expect.objectContaining({ code: 'unsupported-type' }) as unknown as Error,
    );
  });

  it('rejects an unknown link type', () => {
    const link = `84a168c420${'ab'.repeat(32)}a16ea3616263a17300a17407`;
    expect(() => decodeNode(bytes(dirWith(link)))).toThrow(ManifestError);
  });

  it('rejects a directory link without a name', () => {
    const link = `83a168c420${'ab'.repeat(32)}a17300a17400`;
    expect(() => decodeNode(bytes(dirWith(link)))).toThrow(/missing `n`/);
  });

  it('rejects a directory entry named ".."', () => {
    const link = `84a168c420${'ab'.repeat(32)}a16ea22e2ea17300a17400`;
    expect(() => decodeNode(bytes(dirWith(link)))).toThrow(/invalid entry name/);
  });

  it('rejects duplicate directory entry names', () => {
    const link = `84a168c420${'ab'.repeat(32)}a16ea3616263a17300a17400`;
    expect(() => decodeNode(bytes(`82a16c92${link}${link}a17402`))).toThrow(
      expect.objectContaining({ code: 'duplicate-name' }) as unknown as Error,
    );
  });

  it('rejects a named link inside a file manifest', () => {
    const link = `84a168c420${'ab'.repeat(32)}a16ea3616263a17300a17400`;
    expect(() => decodeNode(bytes(`82a16c91${link}a17401`))).toThrow(/must not include `n`/);
  });

  it('rejects a fanout link pointing at a raw blob', () => {
    const link =
      `84a168c420${'11'.repeat(32)}a16d83a5${utf8Hex('count')}01` +
      `a5${utf8Hex('first')}a161a4${utf8Hex('last')}a161a17300a17400`;
    expect(() => decodeNode(bytes(`82a16c91${link}a17403`))).toThrow(/must have t = 2 or 3/);
  });

  it('rejects a fanout link without bounds metadata', () => {
    const link = `83a168c420${'11'.repeat(32)}a17300a17402`;
    expect(() => decodeNode(bytes(`82a16c91${link}a17403`))).toThrow(/m\.count/);
  });

  it('rejects unexpected top-level fields', () => {
    expect(() => decodeNode(bytes(`83a16c90a17402a178${'00'}`))).toThrow(ManifestError);
  });

  it('rejects trailing bytes after the node', () => {
    expect(() => decodeNode(bytes('82a16c90a1740200'))).toThrow(/trailing/);
  });
});

describe('sliceLinks', () => {
  const fileNode = decodeNode(bytes(VECTORS.twoChunkFile.hex));

  it('maps a whole-file range onto every chunk', () => {
    const slices = sliceLinks(fileNode, 0, 150);
    expect(slices.map((s) => [s.offset, s.start, s.end])).toEqual([
      [0, 0, 100],
      [100, 0, 50],
    ]);
  });

  it('descends only the chunks covering a partial range', () => {
    const slices = sliceLinks(fileNode, 120, 130);
    expect(slices).toHaveLength(1);
    expect(slices[0]!.link.hash).toBe('bb'.repeat(32));
    expect([slices[0]!.start, slices[0]!.end]).toEqual([20, 30]);
  });

  it('returns nothing for a range past the end', () => {
    expect(sliceLinks(fileNode, 200, 210)).toEqual([]);
  });
});

describe('fanout bounds', () => {
  it('narrows by bytewise name order', () => {
    const bounds = { count: 2, first: 'a.txt', last: 'b.txt' };
    expect(boundsMayContain(bounds, 'a.txt')).toBe(true);
    expect(boundsMayContain(bounds, 'anything')).toBe(true);
    expect(boundsMayContain(bounds, 'b.txt')).toBe(true);
    expect(boundsMayContain(bounds, 'c.txt')).toBe(false);
    expect(boundsMayContain(bounds, 'A.txt')).toBe(false);
  });
});

describe('sortEntriesByName', () => {
  it('sorts bytewise on UTF-8, not UTF-16 code units', () => {
    const link = (name: string) => ({
      hash: 'ab'.repeat(32),
      key: null,
      name,
      size: 0,
      type: 0 as const,
      metadata: null,
      fanout: null,
    });
    // U+FF5A (ｚ, 3 UTF-8 bytes) sorts after U+10000 in UTF-16 order but before
    // it bytewise, which is the order BUD-16 specifies.
    const sorted = sortEntriesByName([link('\u{10000}'), link('ｚ'), link('a')]);
    expect(sorted.map((entry) => entry.name)).toEqual(['a', 'ｚ', '\u{10000}']);
  });
});
