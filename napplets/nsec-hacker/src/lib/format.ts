/**
 * Display formatting. Pure, so the readouts can be asserted in tests rather
 * than eyeballed.
 */

import { hashrate } from './miner.js';

const GROUPED = new Intl.NumberFormat('en-US');

/** `27,431` -- the attempts counter. */
export function formatCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0';
  return GROUPED.format(Math.floor(value));
}

/** `1,632 keys/s`. Guards the divide-by-zero on the very first frame. */
export function formatHashrate(attempts: number, elapsedMs: number): string {
  return `${formatCount(hashrate(attempts, elapsedMs))} keys/s`;
}

/** `9.8s` -- short enough for a narrow readout. */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0.0s';
  return `${(ms / 1000).toFixed(1)}s`;
}

/** `3 / 64` -- how close the best guess got. */
export function formatPrefix(matched: number, total = 64): string {
  const clamped = Number.isFinite(matched) ? Math.max(0, Math.min(total, Math.floor(matched))) : 0;
  return `${clamped} / ${total}`;
}

/**
 * The odds line, as an order of magnitude. A full 256-bit match is 1 in 2^256;
 * quoting the exact integer is noise, so this reports the exponent.
 */
export function formatOdds(): string {
  return '1 in 2^256';
}
