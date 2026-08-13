import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@napplet/sdk';
import { filterCandidates, pickLatestRootEvent, readRootEvent } from './resolve.js';
import { parseTreeRef, type MutableRef } from './refs.js';
import { encodeBech32 } from './bech32.js';
import { hexToBytes } from './bytes.js';

const PUBKEY = '11'.repeat(32);
const HASH = 'ab'.repeat(32);
const KEY = 'cd'.repeat(32);

const event = (overrides: Partial<NostrEvent> = {}): NostrEvent =>
  ({
    id: '00'.repeat(32),
    pubkey: PUBKEY,
    kind: 30064,
    created_at: 1000,
    tags: [
      ['d', 'photos'],
      ['hash', HASH],
    ],
    content: '',
    sig: '00'.repeat(64),
    ...overrides,
  }) as NostrEvent;

const mutableRef = (): MutableRef => {
  const npub = encodeBech32('npub', hexToBytes(PUBKEY)!);
  const parsed = parseTreeRef(`htree://${npub}/photos`);
  if (!parsed.ok || parsed.ref.kind !== 'mutable') throw new Error('fixture ref did not parse');
  return parsed.ref;
};

describe('readRootEvent', () => {
  it('reads a public root with no key', () => {
    expect(readRootEvent(event())).toEqual({
      hash: HASH,
      key: null,
      visibility: 'public',
      warnings: [],
    });
  });

  it('reads a public root that publishes its key', () => {
    const result = readRootEvent(
      event({ tags: [['d', 'photos'], ['hash', HASH], ['key', KEY]] }),
    );
    expect(result).toMatchObject({ hash: HASH, key: KEY, visibility: 'public' });
  });

  it('classifies a link-private root', () => {
    const result = readRootEvent(
      event({
        tags: [['d', 'photos'], ['hash', HASH], ['encryptedKey', KEY], ['keyId', '00'.repeat(8)]],
      }),
    );
    expect(result).toMatchObject({ visibility: 'link-private', key: null });
  });

  it('classifies an owner-private root', () => {
    const result = readRootEvent(
      event({ tags: [['d', 'photos'], ['hash', HASH], ['selfEncryptedKey', 'nip44…']] }),
    );
    expect(result).toMatchObject({ visibility: 'owner-private', key: null });
  });

  it('rejects an event with no hash tag', () => {
    expect(readRootEvent(event({ tags: [['d', 'photos']] }))).toBe('event has no `hash` tag');
  });

  it('rejects a malformed hash tag', () => {
    expect(readRootEvent(event({ tags: [['d', 'p'], ['hash', 'nope']] }))).toMatch(
      /not a 32 byte hex hash/,
    );
  });

  it('accepts but flags an uppercase hash', () => {
    const result = readRootEvent(event({ tags: [['d', 'p'], ['hash', HASH.toUpperCase()]] }));
    expect(result).toMatchObject({ hash: HASH });
    expect(typeof result === 'string' ? [] : result.warnings).toHaveLength(1);
  });
});

describe('pickLatestRootEvent', () => {
  it('takes the newest created_at', () => {
    const older = event({ id: 'aa'.repeat(32), created_at: 1000 });
    const newer = event({ id: 'bb'.repeat(32), created_at: 2000 });
    expect(pickLatestRootEvent([older, newer])?.id).toBe(newer.id);
    expect(pickLatestRootEvent([newer, older])?.id).toBe(newer.id);
  });

  it('breaks a tie on the lowest id, per NIP-01', () => {
    // BUD-18 says "lexicographically greatest"; that contradicts NIP-01 and the
    // reference implementation, so the lowest id wins here.
    const low = event({ id: '11'.repeat(32) });
    const high = event({ id: 'ff'.repeat(32) });
    expect(pickLatestRootEvent([high, low])?.id).toBe(low.id);
  });

  it('prefers kind 30064 over the legacy kind at the same timestamp', () => {
    const legacy = event({ id: '11'.repeat(32), kind: 30078 });
    const current = event({ id: 'ff'.repeat(32), kind: 30064 });
    expect(pickLatestRootEvent([legacy, current])?.kind).toBe(30064);
  });

  it('returns null for no candidates', () => {
    expect(pickLatestRootEvent([])).toBeNull();
  });
});

describe('filterCandidates', () => {
  const ref = mutableRef();

  it('keeps matching author, kind and d tag', () => {
    expect(filterCandidates([event()], ref)).toHaveLength(1);
    expect(filterCandidates([event({ kind: 30078 })], ref)).toHaveLength(1);
  });

  it('drops a different author, kind or tree name', () => {
    expect(filterCandidates([event({ pubkey: '22'.repeat(32) })], ref)).toHaveLength(0);
    expect(filterCandidates([event({ kind: 30023 })], ref)).toHaveLength(0);
    expect(
      filterCandidates([event({ tags: [['d', 'other'], ['hash', HASH]] })], ref),
    ).toHaveLength(0);
  });
});
