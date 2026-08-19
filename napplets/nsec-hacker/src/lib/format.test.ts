import { describe, expect, it } from 'vitest';
import { formatCount, formatElapsed, formatHashrate, formatOdds, formatPrefix } from './format.js';

describe('formatCount', () => {
  it('groups thousands', () => {
    expect(formatCount(27431)).toBe('27,431');
    expect(formatCount(7)).toBe('7');
  });

  it('floors fractions and clamps junk to zero', () => {
    expect(formatCount(12.9)).toBe('12');
    expect(formatCount(-5)).toBe('0');
    expect(formatCount(Number.NaN)).toBe('0');
  });
});

describe('formatHashrate', () => {
  it('guards the divide-by-zero on the first frame', () => {
    expect(formatHashrate(10, 0)).toBe('0 keys/s');
  });

  it('reports keys per second', () => {
    expect(formatHashrate(1600, 1000)).toBe('1,600 keys/s');
  });
});

describe('formatElapsed', () => {
  it('renders one decimal of seconds', () => {
    expect(formatElapsed(9800)).toBe('9.8s');
  });

  it('floors non-positive input', () => {
    expect(formatElapsed(0)).toBe('0.0s');
    expect(formatElapsed(-1)).toBe('0.0s');
  });
});

describe('formatPrefix', () => {
  it('reports matched over total', () => {
    expect(formatPrefix(3)).toBe('3 / 64');
  });

  it('clamps out-of-range values', () => {
    expect(formatPrefix(-1)).toBe('0 / 64');
    expect(formatPrefix(999)).toBe('64 / 64');
    expect(formatPrefix(Number.NaN)).toBe('0 / 64');
  });
});

describe('formatOdds', () => {
  it('quotes the order of magnitude rather than the integer', () => {
    expect(formatOdds()).toBe('1 in 2^256');
  });
});
