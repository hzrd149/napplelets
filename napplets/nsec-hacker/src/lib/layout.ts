/**
 * Pure layout math for the slot reel.
 *
 * Lives in `lib/` rather than next to the GSAP code because the column-fitting
 * rule is exactly the thing that has to hold at a 200px sidebar and a 2000px
 * tab, and that is worth asserting rather than eyeballing.
 */

export const MIN_COLUMNS = 8;
export const MAX_COLUMNS = 64;

/** Narrowest a column may get before we show fewer of them. */
const MIN_COLUMN_PX = 11;

/**
 * How many hex columns fit in `px`, clamped so a tiny pane still shows a reel
 * and a huge one never shows more characters than a pubkey has.
 */
export function columnsForWidth(px: number): number {
  if (!Number.isFinite(px) || px <= 0) return MIN_COLUMNS;
  const fits = Math.floor(px / MIN_COLUMN_PX);
  return Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, fits));
}
