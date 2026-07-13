import { describe, it, expect } from 'vitest';
import type { NostrEvent } from './nostr';
import { buildGMThreads, hasETag, startOfTodaySeconds, chunk } from './gm-store';

function ev(partial: Partial<NostrEvent> & { id: string }): NostrEvent {
  return {
    id: partial.id,
    pubkey: partial.pubkey ?? 'a'.repeat(64),
    created_at: partial.created_at ?? 1000,
    kind: partial.kind ?? 1,
    tags: partial.tags ?? [],
    content: partial.content ?? 'GM',
    sig: partial.sig ?? 'sig',
  };
}

describe('hasETag', () => {
  it('detects an e tag', () => {
    expect(hasETag(ev({ id: '1', tags: [['e', 'root']] }))).toBe(true);
    expect(hasETag(ev({ id: '2', tags: [['p', 'x']] }))).toBe(false);
    expect(hasETag(ev({ id: '3', tags: [] }))).toBe(false);
  });
});

describe('startOfTodaySeconds', () => {
  it('returns local midnight for a given day', () => {
    const noon = new Date(2024, 0, 15, 12, 30, 0);
    const midnight = new Date(2024, 0, 15, 0, 0, 0);
    expect(startOfTodaySeconds(noon)).toBe(Math.floor(midnight.getTime() / 1000));
  });
});

describe('chunk', () => {
  it('splits into fixed-size groups', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 500)).toEqual([]);
  });
});

describe('buildGMThreads', () => {
  it('keeps only root GM notes (drops replies) and sorts newest-first', () => {
    const root1 = ev({ id: 'root1', created_at: 100, tags: [] });
    const root2 = ev({ id: 'root2', created_at: 200, tags: [] });
    const replyFromContact = ev({ id: 'r1', created_at: 150, tags: [['e', 'root1']] });

    const gmNotes = new Map([
      [root1.id, root1],
      [root2.id, root2],
      [replyFromContact.id, replyFromContact],
    ]);

    const threads = buildGMThreads(gmNotes, new Map());
    expect(threads.map((t) => t.note.id)).toEqual(['root2', 'root1']);
  });

  it('marks a root as read when the user GM-replied to it', () => {
    const root = ev({ id: 'root', tags: [] });
    const gmNotes = new Map([[root.id, root]]);
    const myReply = ev({
      id: 'mine',
      tags: [
        ['e', 'root'],
        ['p', root.pubkey],
      ],
      content: 'GM',
    });
    const userReplies = new Map([[myReply.id, myReply]]);

    const threads = buildGMThreads(gmNotes, userReplies);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.isRead).toBe(true);
  });

  it('leaves a root unread when no user reply e-tags it', () => {
    const root = ev({ id: 'root', tags: [] });
    const other = ev({ id: 'other', tags: [] });
    const gmNotes = new Map([
      [root.id, root],
      [other.id, other],
    ]);
    // A GM reply that points at a DIFFERENT note must not mark `root` read.
    const myReply = ev({ id: 'mine', tags: [['e', 'other']], content: 'gm' });
    const userReplies = new Map([[myReply.id, myReply]]);

    const threads = buildGMThreads(gmNotes, userReplies);
    const rootThread = threads.find((t) => t.note.id === 'root');
    const otherThread = threads.find((t) => t.note.id === 'other');
    expect(rootThread!.isRead).toBe(false);
    expect(otherThread!.isRead).toBe(true);
  });
});
