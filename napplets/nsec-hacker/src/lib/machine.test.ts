import { describe, expect, it } from 'vitest';
import { abortsRun, initialState, reduce, type MachineState } from './machine.js';

const TARGET = 'ab'.repeat(32);
const OTHER = 'cd'.repeat(32);

const mining = (target: string | null): MachineState => ({ phase: 'mining', target });

describe('reduce', () => {
  it('starts a run from idle', () => {
    expect(reduce(initialState(TARGET), { type: 'start' }).phase).toBe('mining');
  });

  it('ignores clicks while mining', () => {
    const state = mining(TARGET);
    expect(reduce(state, { type: 'start' })).toBe(state);
  });

  it('lands on denied when a run finishes without a match', () => {
    expect(reduce(mining(TARGET), { type: 'finish', matched: false }).phase).toBe('denied');
  });

  it('lands on granted on a match', () => {
    expect(reduce(mining(TARGET), { type: 'finish', matched: true }).phase).toBe('granted');
  });

  it('lands on no-target when there was nothing to compare against', () => {
    expect(reduce(mining(null), { type: 'finish', matched: false }).phase).toBe('no-target');
  });

  it('ignores finish outside a run', () => {
    const state = initialState(TARGET);
    expect(reduce(state, { type: 'finish', matched: false })).toBe(state);
  });

  it('restarts from denied', () => {
    const denied = reduce(mining(TARGET), { type: 'finish', matched: false });
    expect(reduce(denied, { type: 'start' }).phase).toBe('mining');
  });

  it('resets to idle', () => {
    const granted = reduce(mining(TARGET), { type: 'finish', matched: true });
    expect(reduce(granted, { type: 'reset' }).phase).toBe('idle');
  });
});

describe('target changes', () => {
  it('records a new target while idle', () => {
    const next = reduce(initialState(null), { type: 'target', target: TARGET });
    expect(next).toEqual({ phase: 'idle', target: TARGET });
  });

  it('is a no-op when the target is unchanged', () => {
    const state = initialState(TARGET);
    expect(reduce(state, { type: 'target', target: TARGET })).toBe(state);
  });

  it('aborts a run in progress rather than scoring against a stale target', () => {
    const next = reduce(mining(TARGET), { type: 'target', target: OTHER });
    expect(next).toEqual({ phase: 'idle', target: OTHER });
  });

  it('aborts when the user signs out mid-run', () => {
    const next = reduce(mining(TARGET), { type: 'target', target: null });
    expect(next).toEqual({ phase: 'idle', target: null });
  });
});

describe('abortsRun', () => {
  it('is true only for a changed target during a run', () => {
    expect(abortsRun(mining(TARGET), OTHER)).toBe(true);
    expect(abortsRun(mining(TARGET), TARGET)).toBe(false);
    expect(abortsRun(initialState(TARGET), OTHER)).toBe(false);
  });
});
