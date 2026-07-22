import { describe, expect, it } from 'vitest';
import { chunk, getAutoBubbleTarget, getBubbleLifetime } from './bubble-model';

describe('bubble model helpers', () => {
  it('chunks authors for outbox author batches', () => {
    expect(chunk(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
  });

  it('bounds automatic bubble target by stage area', () => {
    expect(getAutoBubbleTarget(100, 100)).toBeGreaterThanOrEqual(18);
    expect(getAutoBubbleTarget(4000, 3000)).toBeLessThanOrEqual(72);
  });

  it('keeps reaction lifetimes shorter than notes', () => {
    expect(getBubbleLifetime('reaction', 40, 1)).toBeLessThan(getBubbleLifetime('note', 40, 1));
  });
});
