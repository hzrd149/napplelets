/**
 * Character diff between two npubs.
 *
 * Every npub starts `npub1`, so counting that as a match would flatter the
 * result: the shared prefix is split off and reported separately from the body,
 * and only body characters count toward the score.
 *
 * Bech32 is base32, so at any given position two unrelated keys agree about one
 * time in 32. Over a 58-character body that means a couple of incidental hits
 * per run -- which is exactly the point. The diff makes "nowhere close" legible
 * in a way that a single prefix number never does.
 */

export const NPUB_PREFIX = 'npub1';

export interface DiffCell {
  char: string;
  /** True when this position agrees with the other npub. */
  hit: boolean;
}

export interface NpubDiff {
  /** The shared `npub1` prefix, or `''` when an input is not an npub. */
  prefix: string;
  guess: DiffCell[];
  target: DiffCell[];
  /** Body positions that agree. */
  hits: number;
  /** Body positions compared. */
  total: number;
}

/**
 * Align two npubs position by position. Inputs of unequal length compare over
 * the overlap; the surplus is included and always counts as a miss, so nothing
 * is silently dropped from the display.
 */
export function diffNpub(guess: string, target: string): NpubDiff {
  const shared = guess.startsWith(NPUB_PREFIX) && target.startsWith(NPUB_PREFIX);
  const prefix = shared ? NPUB_PREFIX : '';
  const guessBody = guess.slice(prefix.length);
  const targetBody = target.slice(prefix.length);
  const overlap = Math.min(guessBody.length, targetBody.length);

  let hits = 0;
  const guessCells: DiffCell[] = [];
  const targetCells: DiffCell[] = [];

  for (let i = 0; i < guessBody.length; i += 1) {
    const hit = i < overlap && guessBody[i] === targetBody[i];
    if (hit) hits += 1;
    guessCells.push({ char: guessBody[i]!, hit });
  }

  for (let i = 0; i < targetBody.length; i += 1) {
    targetCells.push({ char: targetBody[i]!, hit: i < overlap && guessBody[i] === targetBody[i] });
  }

  return { prefix, guess: guessCells, target: targetCells, hits, total: overlap };
}

/** `2 of 58 characters match`, with the degenerate cases spelled out. */
export function describeDiff(diff: NpubDiff): string {
  if (diff.total === 0) return 'nothing to compare';
  if (diff.hits === diff.total) return `all ${diff.total} characters match`;
  return `${diff.hits} of ${diff.total} characters match`;
}
