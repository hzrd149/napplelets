/**
 * The mining core.
 *
 * Pure apart from the injected key source: no DOM, no timers, no rAF. The
 * caller owns the clock, which is what makes the time budget testable and lets
 * the same code drive either a rAF loop or (some day) a worker unchanged.
 *
 * The numbers this produces are real. Measured throughput is ~0.183 ms per
 * derived key, so a 5 ms slice fits roughly 27 keys and leaves the rest of the
 * frame to the animation. Nothing displayed is invented -- see `foldStats`.
 */

import { randomKeypair, sharedPrefix, type Keypair } from './keys.js';

/** How many candidate pubkeys a batch hands back for the animation to chew on. */
const MAX_SAMPLES = 8;

export interface Candidate extends Keypair {
  /** Leading hex chars shared with the target; 0 when there is no target. */
  matchedPrefix: number;
}

export interface BatchResult {
  attempts: number;
  /** Best candidate in this batch, or null for an empty batch. */
  best: Candidate | null;
  /** Final candidate tried, the one the slot columns display. */
  last: Candidate | null;
  /** Non-null only on an actual full match. Has never happened. */
  matched: Candidate | null;
  /** A few real pubkeys from this batch, for the rain. */
  samples: string[];
}

export interface MinerStats {
  attempts: number;
  elapsedMs: number;
  best: Candidate | null;
  last: Candidate | null;
  matched: boolean;
}

export const EMPTY_STATS: MinerStats = {
  attempts: 0,
  elapsedMs: 0,
  best: null,
  last: null,
  matched: false,
};

export type KeySource = () => Keypair;

/**
 * Grind keys until `budgetMs` of wall clock is gone.
 *
 * Always tries at least one key, so a zero or negative budget still makes
 * progress rather than spinning the caller forever.
 */
export function mineBatch(
  target: string | null,
  budgetMs: number,
  now: () => number,
  source: KeySource = randomKeypair,
): BatchResult {
  const started = now();
  const samples: string[] = [];
  let attempts = 0;
  let best: Candidate | null = null;
  let last: Candidate | null = null;
  let matched: Candidate | null = null;

  do {
    const pair = source();
    const matchedPrefix = target === null ? 0 : sharedPrefix(pair.pubkey, target);
    const candidate: Candidate = { ...pair, matchedPrefix };

    attempts += 1;
    last = candidate;
    if (best === null || candidate.matchedPrefix > best.matchedPrefix) best = candidate;
    if (samples.length < MAX_SAMPLES) samples.push(candidate.pubkey);

    if (target !== null && candidate.pubkey === target) {
      matched = candidate;
      break;
    }
  } while (now() - started < budgetMs);

  return { attempts, best, last, matched, samples };
}

/** Accumulate a batch into the running totals. `best` only ever improves. */
export function foldStats(prev: MinerStats, batch: BatchResult, elapsedMs: number): MinerStats {
  const best =
    batch.best !== null &&
    (prev.best === null || batch.best.matchedPrefix > prev.best.matchedPrefix)
      ? batch.best
      : prev.best;

  return {
    attempts: prev.attempts + batch.attempts,
    elapsedMs,
    best,
    last: batch.last ?? prev.last,
    matched: prev.matched || batch.matched !== null,
  };
}

/** Keys per second. Zero elapsed time reports 0 rather than Infinity. */
export function hashrate(attempts: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  return (attempts / elapsedMs) * 1000;
}
