import type { EventTemplate, NostrEvent } from '@napplet/sdk';
import { DIFFICULTIES, type Difficulty, type MinesweeperGame } from './game';

export const MINESWEEPER_EVENT_KIND = 1989;
export const AUTHOR_BATCH_SIZE = 200;
export const MAX_FEED_RESULTS = 100;

export type GameResult = 'won' | 'lost';

export type PublishedGameResult = {
  result: GameResult;
  difficulty: Difficulty['id'];
  width: number;
  height: number;
  mineCount: number;
  elapsedSeconds: number;
  board: {
    mines: number[];
    revealed: number[];
    flags: number[];
    exploded: number | null;
  };
};

export type FeedEntry = { event: NostrEvent; result: PublishedGameResult };

export function captureGameResult(
  game: MinesweeperGame,
  difficulty: Difficulty,
  elapsedSeconds: number,
): PublishedGameResult | null {
  if (game.status !== 'won' && game.status !== 'lost') return null;
  const exploded = game.cells.findIndex((cell) => cell.exploded);
  return {
    result: game.status,
    difficulty: difficulty.id,
    width: difficulty.width,
    height: difficulty.height,
    mineCount: difficulty.mines,
    elapsedSeconds: Math.max(0, Math.floor(elapsedSeconds)),
    board: {
      mines: indicesWhere(game, (cell) => cell.mine),
      revealed: indicesWhere(game, (cell) => cell.revealed),
      flags: indicesWhere(game, (cell) => cell.flagged),
      exploded: exploded === -1 ? null : exploded,
    },
  };
}

function indicesWhere(
  game: MinesweeperGame,
  predicate: (cell: MinesweeperGame['cells'][number]) => boolean,
): number[] {
  return game.cells.flatMap((cell, index) => (predicate(cell) ? [index] : []));
}

export function createGameEventTemplate(
  result: PublishedGameResult,
  message = '',
  createdAt = Math.floor(Date.now() / 1000),
): EventTemplate {
  return {
    kind: MINESWEEPER_EVENT_KIND,
    created_at: createdAt,
    tags: [
      ['result', result.result],
      ['difficulty', result.difficulty],
      ['duration', String(result.elapsedSeconds)],
      ['width', String(result.width)],
      ['height', String(result.height)],
      ['mine_count', String(result.mineCount)],
      ['mines', result.board.mines.join(',')],
      ['revealed', result.board.revealed.join(',')],
      ['flags', result.board.flags.join(',')],
      ['exploded', result.board.exploded === null ? '' : String(result.board.exploded)],
      ['alt', 'Minesweeper game result'],
    ],
    content: message,
  };
}

export function parseGameEvent(event: NostrEvent): PublishedGameResult | null {
  if (event.kind !== MINESWEEPER_EVENT_KIND) return null;
  const difficultyId = tagValue(event, 'difficulty');
  const difficulty = DIFFICULTIES.find((item) => item.id === difficultyId);
  const result = tagValue(event, 'result');
  const elapsedSeconds = integerTag(event, 'duration');
  const width = integerTag(event, 'width');
  const height = integerTag(event, 'height');
  const mineCount = integerTag(event, 'mine_count');
  if (
    !difficulty ||
    (result !== 'won' && result !== 'lost') ||
    width !== difficulty.width ||
    height !== difficulty.height ||
    mineCount !== difficulty.mines ||
    elapsedSeconds === null
  ) {
    return null;
  }
  const size = difficulty.width * difficulty.height;
  const mines = indexTag(event, 'mines', size);
  const revealed = indexTag(event, 'revealed', size);
  const flags = indexTag(event, 'flags', size);
  const explodedValue = tagValue(event, 'exploded');
  const exploded = explodedValue === '' ? null : parseInteger(explodedValue);
  if (
    !mines ||
    mines.length !== difficulty.mines ||
    !revealed ||
    !flags ||
    explodedValue === null ||
    (explodedValue !== '' && exploded === null) ||
    !(exploded === null || (isNonNegativeInteger(exploded) && exploded < size)) ||
    (result === 'won' && exploded !== null) ||
    (result === 'lost' && (exploded === null || !mines.includes(exploded))) ||
    tagValue(event, 'alt') !== 'Minesweeper game result'
  ) {
    return null;
  }
  return {
    result,
    difficulty: difficulty.id,
    width,
    height,
    mineCount,
    elapsedSeconds,
    board: { mines, revealed, flags, exploded },
  };
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function validIndices(value: unknown, size: number): number[] | null {
  if (!Array.isArray(value) || !value.every((item) => isNonNegativeInteger(item) && item < size)) {
    return null;
  }
  return new Set(value).size === value.length ? value : null;
}

function parseInteger(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function integerTag(event: NostrEvent, name: string): number | null {
  return parseInteger(tagValue(event, name));
}

function indexTag(event: NostrEvent, name: string, size: number): number[] | null {
  const value = tagValue(event, name);
  if (value === null) return null;
  if (value === '') return [];
  const indices = value.split(',').map((item) => parseInteger(item));
  return validIndices(indices, size);
}

function tagValue(event: NostrEvent, name: string): string | null {
  const matches = event.tags.filter((tag) => tag[0] === name && tag.length === 2);
  return matches.length === 1 ? (matches[0]?.[1] ?? null) : null;
}

export function mergeFeedEntries(
  current: readonly FeedEntry[],
  incoming: readonly FeedEntry[],
  limit = MAX_FEED_RESULTS,
): FeedEntry[] {
  const byId = new Map(current.map((entry) => [entry.event.id, entry]));
  for (const entry of incoming) byId.set(entry.event.id, entry);
  return [...byId.values()]
    .sort((left, right) => right.event.created_at - left.event.created_at)
    .slice(0, limit);
}

export function chunkAuthors(authors: readonly string[], size = AUTHOR_BATCH_SIZE): string[][] {
  const unique = [...new Set(authors.filter(Boolean))];
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += size) {
    chunks.push(unique.slice(index, index + size));
  }
  return chunks;
}
