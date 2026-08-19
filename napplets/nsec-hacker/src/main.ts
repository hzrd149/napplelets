/**
 * nsec-hacker -- boot and wiring.
 *
 * The run is time-bounded, never work-bounded: a fixed-duration GSAP timeline
 * owns the clock, and mining fills whatever compute is left over each frame. A
 * slow device therefore reports fewer keys rather than a longer run, which
 * keeps the displayed hashrate honest.
 *
 * See `src/lib/keys.ts` for why a napplet is generating secret keys at all.
 */

import { gsap } from 'gsap';
import { formatCount, formatElapsed, formatHashrate, formatPrefix } from './lib/format.js';
import { randomKeypair, toNpub, truncateMiddle } from './lib/keys.js';
import { abortsRun, initialState, reduce, type MachineEvent, type Phase } from './lib/machine.js';
import { EMPTY_STATS, foldStats, mineBatch, type MinerStats } from './lib/miner.js';
import { subscribeTarget } from './lib/target.js';
import { createRain } from './ui/rain.js';
import { createSlots } from './ui/slots.js';
import { hideResult, showResult, type ResultRefs } from './ui/result.js';
import './styles.css';

/** The joke's rhythm. Deliberately not configurable. */
const RUN_SECONDS = 10;
const REDUCED_RUN_SECONDS = 1.5;
/** Milliseconds of each frame handed to mining; the rest belongs to animation. */
const BUDGET_MS = 5;
/**
 * Repaint the reel every Nth frame (~15Hz). Rewriting 64 columns of glyphs on
 * every frame is far more DOM work than the eye can use, and it competes with
 * the mining budget for the same milliseconds.
 */
const REEL_EVERY = 4;

function requireElement<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
}

const app = requireElement<HTMLDivElement>('#app');
const slotsRoot = requireElement<HTMLDivElement>('#slots');
const canvas = requireElement<HTMLCanvasElement>('.rain');
const hackButton = requireElement<HTMLButtonElement>('#hack');
const againButton = requireElement<HTMLButtonElement>('#again');
const captionEl = requireElement<HTMLParagraphElement>('#caption');
const guessEl = requireElement<HTMLParagraphElement>('#guess');
const targetEl = requireElement<HTMLSpanElement>('#target');
const readout = {
  keys: requireElement<HTMLSpanElement>('#r-keys'),
  rate: requireElement<HTMLSpanElement>('#r-rate'),
  best: requireElement<HTMLSpanElement>('#r-best'),
  time: requireElement<HTMLSpanElement>('#r-time'),
};
const resultRefs: ResultRefs = {
  panel: requireElement<HTMLElement>('#result'),
  title: requireElement<HTMLElement>('#result-title'),
  note: requireElement<HTMLElement>('#result-note'),
  targetRow: requireElement<HTMLElement>('#diff-target-row'),
  targetChars: requireElement<HTMLElement>('#diff-target'),
  guessChars: requireElement<HTMLElement>('#diff-guess'),
  summary: requireElement<HTMLElement>('#diff-summary'),
  nsecRow: requireElement<HTMLElement>('#result-secret-row'),
  nsec: requireElement<HTMLElement>('#result-nsec'),
};

const motionQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
let reducedMotion = motionQuery?.matches ?? false;

let state = initialState(null);
let stats: MinerStats = EMPTY_STATS;
let runStartedAt = 0;
let runTimeline: gsap.core.Timeline | null = null;
let warmedUp = false;
let frame = 0;

const rain = createRain(canvas);
const slots = createSlots(slotsRoot, reducedMotion);

/* ------------------------------------------------------------------ status */

const PHASE_CAPTIONS: Record<Phase, string> = {
  idle: 'Awaiting input.',
  mining: 'Seeding entropy pool...',
  denied: 'Attempt failed. The keyspace remains undefeated.',
  granted: 'Impossible. Verify this yourself before believing it.',
  'no-target': 'Nothing to compare against.',
};

/** Status lines shown as the run progresses, purely for flavour. */
const RUN_CAPTIONS: readonly [number, string][] = [
  [0, 'Seeding entropy pool...'],
  [0.2, 'Deriving secp256k1 points...'],
  [0.45, 'Comparing against target pubkey...'],
  [0.7, 'Narrowing keyspace...'],
  [0.88, 'Final candidates...'],
];

function captionForProgress(progress: number): string {
  let caption = RUN_CAPTIONS[0]![1];
  for (const [at, text] of RUN_CAPTIONS) if (progress >= at) caption = text;
  return caption;
}

/* ------------------------------------------------------------------ render */

function renderReadout(): void {
  readout.keys.textContent = formatCount(stats.attempts);
  readout.rate.textContent = formatHashrate(stats.attempts, stats.elapsedMs);
  readout.best.textContent = formatPrefix(stats.best?.matchedPrefix ?? 0);
  readout.time.textContent = formatElapsed(stats.elapsedMs);
}

function renderTarget(): void {
  targetEl.textContent =
    state.target === null
      ? 'TARGET · none connected'
      : `TARGET · ${truncateMiddle(toNpub(state.target), 10, 6)}`;
}

function renderPhase(): void {
  app.dataset.phase = state.phase;
  captionEl.textContent = PHASE_CAPTIONS[state.phase];
  hackButton.disabled = state.phase === 'mining';
  hackButton.textContent = state.phase === 'mining' ? 'BREACHING...' : 'HACK NSEC';
  rain.setMining(state.phase === 'mining');
}

/* ------------------------------------------------------------------- runs */

function dispatch(event: MachineEvent): void {
  const previous = state;
  state = reduce(state, event);
  if (state === previous) return;

  if (previous.phase !== state.phase) renderPhase();
  if (previous.target !== state.target) renderTarget();
}

function stopRun(): void {
  runTimeline?.kill();
  runTimeline = null;
  gsap.ticker.remove(tick);
}

/** One frame: spend the budget on real keys, then push the numbers out. */
function tick(): void {
  if (state.phase !== 'mining') return;

  const batch = mineBatch(state.target, BUDGET_MS, () => performance.now());
  stats = foldStats(stats, batch, performance.now() - runStartedAt);

  rain.feed(batch.samples);

  frame += 1;
  if (frame % REEL_EVERY === 0) {
    if (stats.last !== null) {
      slots.update(stats.last.pubkey);
      // The npub of the key just tried. Encoding at ~15Hz rather than every
      // frame keeps this off the mining budget while still reading as a stream.
      guessEl.textContent = toNpub(stats.last.pubkey);
    }
    renderReadout();
  }

  if (batch.matched !== null) {
    // A real match short-circuits the timeline rather than waiting it out.
    runTimeline?.progress(1);
  }
}

function finishRun(): void {
  stopRun();
  const matched = stats.matched;
  if (stats.last !== null) slots.lock(stats.last.pubkey);

  dispatch({ type: 'finish', matched });
  renderReadout();

  const shown = stats.best ?? stats.last;
  if (shown !== null) guessEl.textContent = toNpub(shown.pubkey);
  showResult(resultRefs, state.phase, shown, state.target, reducedMotion);
}

function startRun(): void {
  if (state.phase === 'mining') return;

  hideResult(resultRefs);
  slots.reset();
  guessEl.textContent = 'npub1' + '.'.repeat(8);
  stats = EMPTY_STATS;
  frame = 0;
  runStartedAt = performance.now();

  dispatch({ type: 'start' });
  renderReadout();

  const duration = reducedMotion ? REDUCED_RUN_SECONDS : RUN_SECONDS;

  // The timeline is the single source of truth for how long a run lasts.
  // Driving mining from `gsap.ticker` means a backgrounded tab pauses the
  // animation and the mining together, so the hashrate never goes wrong.
  runTimeline = gsap.timeline({ onComplete: finishRun });
  runTimeline.to(
    { p: 0 },
    {
      p: 1,
      duration,
      ease: 'none',
      onUpdate() {
        captionEl.textContent = captionForProgress(this.progress());
      },
    },
    0,
  );

  gsap.ticker.add(tick);
  slots.settle(duration);
}

/**
 * The first secp256k1 derivation builds a precomputed table and costs far more
 * than the rest, so pay it on press-down -- before the timeline starts and any
 * hitch would be visible.
 */
function warmUp(): void {
  if (warmedUp) return;
  warmedUp = true;
  randomKeypair();
}

/* ----------------------------------------------------------------- wiring */

hackButton.addEventListener('pointerdown', warmUp);
hackButton.addEventListener('click', () => startRun());
againButton.addEventListener('click', () => {
  hideResult(resultRefs);
  dispatch({ type: 'reset' });
  slots.reset();
  startRun();
});

const resizeObserver = new ResizeObserver(() => {
  rain.resize();
  slots.relayout();
});
resizeObserver.observe(app);

const stopTarget = subscribeTarget((target) => {
  if (abortsRun(state, target)) {
    // The comparison is invalid the moment the account changes, so the run is
    // abandoned rather than scored against a stale target.
    stopRun();
    dispatch({ type: 'target', target });
    slots.reset();
    renderTarget();
    return;
  }
  dispatch({ type: 'target', target });
});

function onMotionChange(event: MediaQueryListEvent): void {
  reducedMotion = event.matches;
}
motionQuery?.addEventListener('change', onMotionChange);

function teardown(): void {
  stopRun();
  stopTarget();
  resizeObserver.disconnect();
  motionQuery?.removeEventListener('change', onMotionChange);
  rain.stop();
  slots.destroy();
}
globalThis.addEventListener('pagehide', teardown, { once: true });

renderPhase();
renderTarget();
renderReadout();
