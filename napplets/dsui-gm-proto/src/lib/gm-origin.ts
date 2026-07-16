// napplets/dsui-gm-proto/src/lib/gm-origin.ts
// The single origin-routing seam for the GM inbox.
//
// subscribeForPayload turns a set of filters into a NAP-OUTBOX read and returns a
// uniform { close } handle. NAP-OUTBOX has no `eose` (napplet/naps#32), so the
// read is two legs over the same filters/options:
//
//   origin:'outbox'  → outbox.query(filters, { authors }) for the initial stored
//                      scan (resolution = "scan settled") + a live
//                      outbox.subscribe(filters, { authors }) tail for new events.
//
// The SDK owns the app-facing transport: outbox.subscribe/query read the
// runtime-injected window.napplet.outbox at call time, so app code passes plain
// objects and lets the runtime boundary own clone-safe postMessage delivery.

import { outbox, type RelayEventResult, type Subscription } from '@napplet/sdk';
import type { NostrEvent, NostrFilter } from './nostr';

/** The minimal payload the GM inbox routes (a subset of FeedIntentPayload). */
export interface OriginSubscribePayload {
  filters: NostrFilter[];
  origin: 'outbox';
  /**
   * Explicit author hints for NAP-OUTBOX relay routing. The shell resolves each
   * author's NIP-65 write relays (the outbox model) from this list; passing it
   * makes routing deterministic instead of relying on the shell re-deriving
   * authors from the filters. Mirrors OutboxSubscribeOptions.authors.
   */
  authors?: string[];
}

export interface PayloadSubscriptionCallbacks {
  onEvent(event: NostrEvent): void;
  /**
   * Fired once the initial one-shot outbox.query() for this payload resolves —
   * i.e. the stored-events scan has settled. NAP-OUTBOX no longer emits an `eose`
   * on the live subscription (removed in napplet/naps#32), so the bounded query
   * IS the "scan done" signal; the live subscription then streams any GMs
   * published while the inbox stays open.
   */
  onScanSettled(): void;
}

/** Read options shared by the initial query and the live subscription. */
interface OutboxReadOptions {
  /** Explicit author hints so the shell can route to the right write relays. */
  authors?: string[];
}

/**
 * Apply caller-supplied per-leg props onto every filter, returning plain filter
 * objects. The runtime boundary normalizes clone-safe values before they cross
 * the iframe, so a plain spread is sufficient here.
 */
function withExtraProps(
  filters: NostrFilter[],
  extra: Record<string, unknown> | undefined,
): NostrFilter[] {
  if (!extra || Object.keys(extra).length === 0) return filters;
  return filters.map((filter) => ({ ...filter, ...extra }));
}

/**
 * Build a uniform { close } subscription from a payload. Opens synchronously;
 * an early close() is honored.
 *
 * NAP-OUTBOX has no `eose` signal (napplet/naps#32), so the read is split into
 * two legs that share one set of filters/options:
 *   - a one-shot `outbox.query()` for the initial stored-events scan — its
 *     resolution is the "scan settled" signal (`onScanSettled`);
 *   - a live `outbox.subscribe()` tail so GMs published while the inbox is open
 *     still stream in via `onEvent`.
 * Both legs feed `onEvent`; any overlap is harmless because callers dedupe
 * incoming events by id.
 */
export function subscribeForPayload(
  payload: OriginSubscribePayload,
  callbacks: PayloadSubscriptionCallbacks,
  extraFilterProps?: Record<string, unknown>,
): Subscription {
  const filters = withExtraProps(payload.filters, extraFilterProps);
  // Forward explicit author hints so the shell routes each filter to the authors'
  // write relays (NAP-OUTBOX) instead of re-deriving them. A plain array copy is
  // enough — the runtime handles clone-safety at the boundary.
  const options: OutboxReadOptions =
    payload.authors && payload.authors.length > 0 ? { authors: [...payload.authors] } : {};

  let subscription: Subscription | null = null;
  let closed = false;

  function close(): void {
    if (closed) return;
    closed = true;
    // Null until the live leg opens; the open below re-checks `closed` right
    // after opening, so a close() that lands before then still tears down.
    subscription?.close();
    subscription = null;
  }

  // Live tail first: open the streaming subscription before the one-shot scan so
  // a GM published between the query snapshot and the subscription opening is not
  // missed. Overlap is harmless — callers dedupe incoming notes by event id.
  const sub = outbox.subscribe(filters, options);
  // NAP-OUTBOX delivers a RelayEventResult (`{ event, sidecar? }`), so the raw
  // event is at `result.event` (napplet/naps#32), NOT the callback arg itself.
  sub.on('event', (result: RelayEventResult) => {
    if (closed) return;
    callbacks.onEvent(result.event);
  });
  subscription = {
    close: () => {
      sub.close();
    },
  };
  if (closed) {
    sub.close();
    return { close };
  }

  // Initial bounded scan: the one-shot query resolves once the shell has
  // collected the stored events (or its budget elapses). That resolution is
  // what settles the inbox's scan state now that there is no `eose`.
  void (async () => {
    try {
      const { events } = await outbox.query(filters, options);
      if (closed) return;
      for (const result of events) callbacks.onEvent(result.event);
    } catch {
      // Scan failed; still settle below so the inbox stops "scanning".
    } finally {
      if (!closed) callbacks.onScanSettled();
    }
  })();

  return { close };
}
