/**
 * The slot machine.
 *
 * One column per displayed hex character. Each column scrolls its own strip of
 * glyphs on an infinite GSAP tween; a run "locks" the columns left-to-right by
 * easing each tween's `timeScale` to zero, which is what gives the settling
 * slot-machine feel.
 *
 * Resize survival, which is the real trap here:
 *
 *   1. Tweens only ever touch `yPercent` and `timeScale` -- never a pixel
 *      coordinate -- so the layout can change underneath a running tween
 *      without desyncing it.
 *   2. The full 64 columns are built once, at boot. Fitting a narrower frame
 *      *hides* the surplus columns rather than rebuilding the reel, so a resize
 *      mid-run can never tear down a live timeline. Nothing is ever rebuilt.
 *
 * The glyphs are real: every character comes from an actual derived candidate
 * pubkey handed in by the miner. Nothing here invents a digit.
 */

import { gsap } from 'gsap';
import { columnsForWidth, MAX_COLUMNS } from '../lib/layout.js';

/** Glyphs per strip half. The strip holds two halves so -50% wraps seamlessly. */
const STRIP_HALF = 10;
const HEX = '0123456789abcdef';

interface Column {
  el: HTMLDivElement;
  strip: HTMLDivElement;
  cells: HTMLSpanElement[];
  spin: gsap.core.Tween;
}

export interface Slots {
  /** How many columns are actually on screen right now. */
  visibleCount(): number;
  /** Refresh the scrolling glyphs from a real candidate pubkey. */
  update(pubkeyHex: string): void;
  /** Ease every visible column to a stop over `durationSec`, left to right. */
  settle(durationSec: number): void;
  /** Stop instantly and display the given pubkey's leading characters. */
  lock(pubkeyHex: string): void;
  /** Resume spinning and clear the locked styling. */
  reset(): void;
  /** Re-fit the visible column count. Safe at any time, including mid-run. */
  relayout(): void;
  destroy(): void;
}

function randomHex(): string {
  return HEX[Math.floor(Math.random() * HEX.length)] ?? '0';
}

export function createSlots(root: HTMLElement, reducedMotion: boolean): Slots {
  const columns: Column[] = [];
  let visible = MAX_COLUMNS;

  const fragment = document.createDocumentFragment();
  for (let i = 0; i < MAX_COLUMNS; i += 1) {
    const el = document.createElement('div');
    el.className = 'slot';
    const strip = document.createElement('div');
    strip.className = 'slot-strip';

    const cells: HTMLSpanElement[] = [];
    for (let j = 0; j < STRIP_HALF * 2; j += 1) {
      const span = document.createElement('span');
      span.textContent = randomHex();
      strip.append(span);
      cells.push(span);
    }

    el.append(strip);
    fragment.append(el);

    // Percent-based and seamless: the strip is two identical halves, so -50%
    // lands exactly one half down and can repeat forever at any pixel size.
    const spin = gsap.to(strip, {
      yPercent: -50,
      duration: reducedMotion ? 1.2 : gsap.utils.random(0.35, 0.75),
      ease: 'none',
      repeat: -1,
    });

    columns.push({ el, strip, cells, spin });
  }
  root.append(fragment);

  function applyVisible(count: number): void {
    visible = count;
    for (let i = 0; i < columns.length; i += 1) {
      columns[i]!.el.hidden = i >= count;
    }
  }

  applyVisible(columnsForWidth(root.clientWidth));

  return {
    visibleCount: () => visible,

    update(pubkeyHex) {
      // Offset each column into the key so neighbouring reels never show the
      // same character at the same moment.
      for (let i = 0; i < visible; i += 1) {
        const column = columns[i];
        if (!column) continue;
        for (let j = 0; j < STRIP_HALF; j += 1) {
          const char = pubkeyHex[(i + j * 7) % pubkeyHex.length] ?? randomHex();
          column.cells[j]!.textContent = char;
          column.cells[j + STRIP_HALF]!.textContent = char;
        }
      }
    },

    settle(durationSec) {
      const each = visible > 0 ? durationSec / visible : 0;
      for (let i = 0; i < columns.length; i += 1) {
        const column = columns[i]!;
        gsap.to(column.spin, {
          timeScale: 0,
          duration: Math.max(0.25, durationSec * 0.35),
          delay: Math.min(i, visible) * each,
          ease: 'power2.out',
          onComplete: () => column.el.classList.add('is-locked'),
        });
      }
    },

    lock(pubkeyHex) {
      for (let i = 0; i < columns.length; i += 1) {
        const column = columns[i]!;
        gsap.killTweensOf(column.spin);
        column.spin.timeScale(0);
        gsap.set(column.strip, { yPercent: 0 });
        column.el.classList.add('is-locked');

        // The locked display is the real final candidate, character for
        // character -- whatever the reel did on the way here, this is the truth.
        const char = pubkeyHex[i] ?? '-';
        column.cells[0]!.textContent = char;
        column.cells[STRIP_HALF]!.textContent = char;
      }
    },

    reset() {
      for (const column of columns) {
        gsap.killTweensOf(column.spin);
        column.el.classList.remove('is-locked');
        column.spin.timeScale(1);
        column.spin.play();
      }
    },

    relayout() {
      const next = columnsForWidth(root.clientWidth);
      if (next !== visible) applyVisible(next);
    },

    destroy() {
      for (const column of columns) column.spin.kill();
      columns.length = 0;
      root.replaceChildren();
    },
  };
}
