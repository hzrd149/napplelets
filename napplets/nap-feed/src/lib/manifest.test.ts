import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@napplet/sdk';
import { summarizeManifest, upsertNewest } from './manifest';

const baseEvent: NostrEvent = {
  id: '0'.repeat(64),
  pubkey: '1'.repeat(64),
  created_at: 100,
  kind: 35129,
  tags: [
    ['d', 'good-morning'],
    ['title', 'Good Morning'],
    ['description', 'A GM inbox'],
    ['path', '/index.html', 'a'.repeat(64)],
    ['x', 'b'.repeat(64), 'aggregate'],
    ['requires', 'identity'],
    ['requires', 'outbox'],
    ['requires', 'identity'],
    ['archetype', 'feed', 'NAP-5'],
    ['config', '{"type":"object"}'],
  ],
  content: '',
  sig: '2'.repeat(128),
};

describe('summarizeManifest', () => {
  it('extracts display metadata without artifact bytes', () => {
    const summary = summarizeManifest(baseEvent, ['wss://relay.example']);

    expect(summary).toMatchObject({
      address: `35129:${baseEvent.pubkey}:good-morning`,
      title: 'Good Morning',
      description: 'A GM inbox',
      identifier: 'good-morning',
      aggregateHash: 'b'.repeat(64),
      pathCount: 1,
      isSingleFile: true,
      requires: ['identity', 'outbox'],
      archetypes: ['feed / NAP-5'],
      hasConfig: true,
    });
    expect(summary?.naddr).toMatch(/^naddr1/);
  });

  it('rejects non-addressable or wrong-kind events', () => {
    expect(summarizeManifest({ ...baseEvent, kind: 1 })).toBeNull();
    expect(summarizeManifest({ ...baseEvent, tags: [] })).toBeNull();
  });
});

describe('upsertNewest', () => {
  it('keeps the newest event per address', () => {
    const oldest = summarizeManifest(baseEvent);
    const newest = summarizeManifest({ ...baseEvent, created_at: 200, tags: [['d', 'good-morning']] });
    if (!oldest || !newest) throw new Error('test fixture failed');

    const items = new Map<string, typeof oldest>();
    expect(upsertNewest(items, newest)).toBe(true);
    expect(upsertNewest(items, oldest)).toBe(false);
    expect(items.get(newest.address)?.createdAt).toBe(200);
  });
});
