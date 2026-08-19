/**
 * The run state machine.
 *
 *   idle --start--> mining --finish--> denied --start--> mining ...
 *                     |
 *                     +--finish(matched)--> granted
 *
 * `no-target` is where a finished run lands when there was no pubkey to compare
 * against (NAP-IDENTITY absent, or the user signed out). The run still happens
 * and still animates -- it just reports honestly that there was nothing to
 * match, instead of faking a denial.
 */

export type Phase = 'idle' | 'mining' | 'denied' | 'granted' | 'no-target';

export interface MachineState {
  phase: Phase;
  /** 64-char hex pubkey, or null when signed out / identity unavailable. */
  target: string | null;
}

export type MachineEvent =
  | { type: 'start' }
  | { type: 'finish'; matched: boolean }
  | { type: 'reset' }
  | { type: 'target'; target: string | null };

export function initialState(target: string | null = null): MachineState {
  return { phase: 'idle', target };
}

export function reduce(state: MachineState, event: MachineEvent): MachineState {
  switch (event.type) {
    case 'start':
      // Clicks during a run are ignored; the button is the only way in and it
      // stays disabled, but the guard belongs here rather than in the DOM.
      if (state.phase === 'mining') return state;
      return { ...state, phase: 'mining' };

    case 'finish': {
      if (state.phase !== 'mining') return state;
      if (event.matched) return { ...state, phase: 'granted' };
      return { ...state, phase: state.target === null ? 'no-target' : 'denied' };
    }

    case 'reset':
      return { ...state, phase: 'idle' };

    case 'target': {
      if (event.target === state.target) return state;
      // A mid-run account switch invalidates the comparison, so the run is
      // abandoned rather than silently scored against a stale target. The
      // caller decides whether to kick off a fresh one.
      if (state.phase === 'mining') return { phase: 'idle', target: event.target };
      return { ...state, target: event.target };
    }

    default:
      return state;
  }
}

/** True when a `target` event would abort a run in progress. */
export function abortsRun(state: MachineState, target: string | null): boolean {
  return state.phase === 'mining' && target !== state.target;
}
