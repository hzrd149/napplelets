import { describe, expect, it } from 'vitest';
import { EMPTY_STATS, foldStats, hashrate, mineBatch, type KeySource } from './miner.js';

const TARGET = 'ab'.repeat(32);

/** A clock the test drives by hand, so the budget is deterministic. */
function fakeClock(stepMs: number): () => number {
  let t = 0;
  return () => {
    const current = t;
    t += stepMs;
    return current;
  };
}

/** Yields pubkeys from a fixed list, cycling. */
function scriptedSource(pubkeys: string[]): KeySource {
  let i = 0;
  return () => {
    const pubkey = pubkeys[i % pubkeys.length]!;
    i += 1;
    return { secret: new Uint8Array(32), pubkey };
  };
}

describe('mineBatch', () => {
  it('always tries at least one key even with a zero budget', () => {
    const batch = mineBatch(TARGET, 0, fakeClock(1), scriptedSource(['00'.repeat(32)]));
    expect(batch.attempts).toBe(1);
    expect(batch.last).not.toBeNull();
  });

  it('stops once the time budget is spent', () => {
    // Clock advances 1ms per read; mineBatch reads once before the loop test.
    const batch = mineBatch(TARGET, 5, fakeClock(1), scriptedSource(['00'.repeat(32)]));
    expect(batch.attempts).toBeGreaterThan(1);
    expect(batch.attempts).toBeLessThanOrEqual(6);
  });

  it('scores the shared prefix against the target', () => {
    const near = `abab${'0'.repeat(60)}`;
    const batch = mineBatch(TARGET, 0, fakeClock(1), scriptedSource([near]));
    expect(batch.best?.matchedPrefix).toBe(4);
  });

  it('scores zero when there is no target', () => {
    const batch = mineBatch(null, 0, fakeClock(1), scriptedSource([TARGET]));
    expect(batch.best?.matchedPrefix).toBe(0);
    expect(batch.matched).toBeNull();
  });

  it('reports a planted full match and stops immediately', () => {
    const batch = mineBatch(TARGET, 50, fakeClock(1), scriptedSource([TARGET]));
    expect(batch.matched?.pubkey).toBe(TARGET);
    expect(batch.attempts).toBe(1);
  });

  it('collects capped samples for the animation', () => {
    const batch = mineBatch(TARGET, 50, fakeClock(1), scriptedSource(['00'.repeat(32)]));
    expect(batch.samples.length).toBeGreaterThan(0);
    expect(batch.samples.length).toBeLessThanOrEqual(8);
  });
});

describe('foldStats', () => {
  it('accumulates attempts across batches', () => {
    const source = scriptedSource(['00'.repeat(32)]);
    let stats = EMPTY_STATS;
    const a = mineBatch(TARGET, 0, fakeClock(1), source);
    stats = foldStats(stats, a, 10);
    const b = mineBatch(TARGET, 0, fakeClock(1), source);
    stats = foldStats(stats, b, 20);

    expect(stats.attempts).toBe(a.attempts + b.attempts);
    expect(stats.elapsedMs).toBe(20);
  });

  it('keeps the best candidate monotonically', () => {
    const good = mineBatch(TARGET, 0, fakeClock(1), scriptedSource([`abab${'0'.repeat(60)}`]));
    const worse = mineBatch(TARGET, 0, fakeClock(1), scriptedSource([`0${'0'.repeat(63)}`]));

    let stats = foldStats(EMPTY_STATS, good, 10);
    expect(stats.best?.matchedPrefix).toBe(4);

    stats = foldStats(stats, worse, 20);
    expect(stats.best?.matchedPrefix).toBe(4);
  });

  it('latches matched once it is set', () => {
    const hit = mineBatch(TARGET, 0, fakeClock(1), scriptedSource([TARGET]));
    const miss = mineBatch(TARGET, 0, fakeClock(1), scriptedSource(['00'.repeat(32)]));

    let stats = foldStats(EMPTY_STATS, hit, 10);
    expect(stats.matched).toBe(true);
    stats = foldStats(stats, miss, 20);
    expect(stats.matched).toBe(true);
  });

  it('tracks the most recent candidate', () => {
    const batch = mineBatch(TARGET, 0, fakeClock(1), scriptedSource([`ff${'0'.repeat(62)}`]));
    const stats = foldStats(EMPTY_STATS, batch, 5);
    expect(stats.last?.pubkey).toBe(`ff${'0'.repeat(62)}`);
  });
});

describe('hashrate', () => {
  it('reports zero rather than Infinity before any time has passed', () => {
    expect(hashrate(10, 0)).toBe(0);
    expect(hashrate(10, -5)).toBe(0);
  });

  it('converts attempts per ms into keys per second', () => {
    expect(hashrate(1000, 1000)).toBe(1000);
    expect(hashrate(50, 100)).toBe(500);
  });
});
