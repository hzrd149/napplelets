import { describe, expect, it } from 'vitest';
import { columnsForWidth, MAX_COLUMNS, MIN_COLUMNS } from './layout.js';

describe('columnsForWidth', () => {
  it('never drops below the floor, however narrow the pane', () => {
    expect(columnsForWidth(0)).toBe(MIN_COLUMNS);
    expect(columnsForWidth(20)).toBe(MIN_COLUMNS);
    expect(columnsForWidth(-100)).toBe(MIN_COLUMNS);
  });

  it('never exceeds the 64 characters a pubkey actually has', () => {
    expect(columnsForWidth(4000)).toBe(MAX_COLUMNS);
  });

  it('scales between the bounds', () => {
    const mid = columnsForWidth(330);
    expect(mid).toBeGreaterThan(MIN_COLUMNS);
    expect(mid).toBeLessThan(MAX_COLUMNS);
  });

  it('is monotonic in width', () => {
    let previous = 0;
    for (let px = 0; px <= 1200; px += 37) {
      const current = columnsForWidth(px);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it('clamps junk input to the floor', () => {
    expect(columnsForWidth(Number.NaN)).toBe(MIN_COLUMNS);
    expect(columnsForWidth(Number.POSITIVE_INFINITY)).toBe(MIN_COLUMNS);
  });
});
