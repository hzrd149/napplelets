import type { NostrEvent } from '@napplet/sdk';
import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, MinesweeperGame } from './game';
import {
  MINESWEEPER_EVENT_KIND,
  captureGameResult,
  chunkAuthors,
  createGameEventTemplate,
  mergeFeedEntries,
  parseGameEvent,
  type PublishedGameResult,
} from './social';

const result: PublishedGameResult = {
  result: 'lost',
  difficulty: 'beginner',
  width: 9,
  height: 9,
  mineCount: 10,
  elapsedSeconds: 42,
  board: {
    mines: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    revealed: [0, 10, 11],
    flags: [1],
    exploded: 0,
  },
};

function event(overrides: Partial<NostrEvent> = {}): NostrEvent {
  const template = createGameEventTemplate(result, 'Close one!', 100);
  return {
    ...template,
    id: 'event-1',
    pubkey: 'pubkey-1',
    sig: 'signature',
    ...overrides,
  };
}

describe('Minesweeper kind 1989 events', () => {
  it('stores the player message in content and all game data in tags', () => {
    const template = createGameEventTemplate(result, 'Close one!', 123);
    expect(template.kind).toBe(MINESWEEPER_EVENT_KIND);
    expect(template.created_at).toBe(123);
    expect(template.content).toBe('Close one!');
    expect(template.tags).toContainEqual(['result', 'lost']);
    expect(template.tags).toContainEqual(['mines', '0,1,2,3,4,5,6,7,8,9']);
    expect(parseGameEvent(event())).toEqual(result);
  });

  it('captures a terminal board without a phantom exploded cell', () => {
    const game = new MinesweeperGame(DIFFICULTIES[0]);
    game.status = 'won';
    game.cells.slice(0, 10).forEach((cell) => {
      cell.mine = true;
      cell.flagged = true;
    });
    expect(captureGameResult(game, DIFFICULTIES[0], 8)?.board.exploded).toBeNull();
  });

  it('rejects malformed, conflicting, and out-of-range events', () => {
    expect(parseGameEvent(event({ kind: 78 }))).toBeNull();
    expect(parseGameEvent(event({ content: '{any text is valid' }))).toEqual(result);
    expect(parseGameEvent(event({ tags: [['result', 'won']] }))).toBeNull();
    expect(
      parseGameEvent(
        event({
          tags: event().tags.map((tag) => (tag[0] === 'mines' ? ['mines', '0,0'] : tag)),
        }),
      ),
    ).toBeNull();
    expect(
      parseGameEvent(
        event({
          tags: event().tags.map((tag) =>
            tag[0] === 'mines' ? ['mines', '0,1,2,3,4,5,6,7,8,81'] : tag,
          ),
        }),
      ),
    ).toBeNull();
  });

  it('deduplicates, sorts, and caps feed entries', () => {
    const entries = [1, 2, 3].map((createdAt) => ({
      event: event({ id: `event-${createdAt}`, created_at: createdAt }),
      result,
    }));
    const merged = mergeFeedEntries([entries[0]!], [entries[0]!, entries[1]!, entries[2]!], 2);
    expect(merged.map((entry) => entry.event.id)).toEqual(['event-3', 'event-2']);
  });

  it('deduplicates and batches authors', () => {
    expect(chunkAuthors(['a', 'b', 'a', 'c'], 2)).toEqual([['a', 'b'], ['c']]);
    const authors = Array.from({ length: 201 }, (_, index) => `author-${index}`);
    expect(chunkAuthors(authors)).toHaveLength(2);
    expect(chunkAuthors(authors)[0]).toHaveLength(200);
    expect(chunkAuthors(authors)[1]).toHaveLength(1);
  });
});
