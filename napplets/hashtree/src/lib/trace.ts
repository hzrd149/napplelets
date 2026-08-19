/**
 * A bounded log of what the blob layer actually did.
 *
 * The napplet already knows everything a fetch debugger needs — which servers
 * were tried, which one answered, whether the bytes verified, whether the answer
 * came from cache — but until now all of it was discarded on success and only
 * partially surfaced (as `BlobError.attempts`) on failure. This keeps the last N
 * of those records so the inspector can show them.
 *
 * It records only what the store already handled. Nothing here fetches, and a
 * decryption key is never part of an event: an encrypted link is reported as
 * encrypted, never by its `k`.
 */

/** One server that was tried and did not produce the requested blob. */
export interface ServerAttempt {
  readonly server: string;
  readonly error: string;
}

/**
 * Where the bytes came from.
 *
 * `inflight` is a request that arrived while an identical one was already in
 * progress and was coalesced onto it — worth seeing, because a burst of them is
 * the difference between "fetched 40 chunks" and "asked for 40, fetched 12".
 */
export type BlobEventSource = 'network' | 'cache' | 'inflight';

export interface BlobEvent {
  /** Monotonic per-trace counter, and a stable key for rendering. */
  readonly seq: number;
  /** Wall-clock stamp, applied by the trace so producers need no clock. */
  readonly at: number;
  readonly hash: string;
  /** The link carried a `k`, so these bytes were decrypted after verifying. */
  readonly encrypted: boolean;
  readonly source: BlobEventSource;
  /** The server that served the verified bytes; `null` unless `source` is `network`. */
  readonly server: string | null;
  /** Servers tried before the one that worked, with why each was rejected. */
  readonly attempts: readonly ServerAttempt[];
  /** Usable bytes produced — plaintext length for an encrypted blob. */
  readonly bytes: number;
  readonly ms: number;
  readonly ok: boolean;
  readonly error: string | null;
}

/** What a producer supplies: the trace adds the sequence number and the stamp. */
export type RecordedEvent = Omit<BlobEvent, 'seq' | 'at'>;

export interface TraceTotals {
  readonly events: number;
  readonly network: number;
  readonly cache: number;
  readonly inflight: number;
  readonly failed: number;
  /** Bytes that crossed the network, i.e. excluding cache and coalesced hits. */
  readonly fetchedBytes: number;
}

/**
 * Roll up a set of events. A free function, not just a method, so a component
 * can derive totals from the event list it already renders and stay reactive.
 */
export function summarizeEvents(events: readonly BlobEvent[]): TraceTotals {
  let network = 0;
  let cache = 0;
  let inflight = 0;
  let failed = 0;
  let fetchedBytes = 0;
  for (const event of events) {
    if (!event.ok) failed += 1;
    if (event.source === 'network') {
      network += 1;
      fetchedBytes += event.bytes;
    } else if (event.source === 'cache') {
      cache += 1;
    } else {
      inflight += 1;
    }
  }
  return { events: events.length, network, cache, inflight, failed, fetchedBytes };
}

const monotonic = (): number =>
  typeof performance?.now === 'function' ? performance.now() : Date.now();

/** Start a stopwatch, in milliseconds, rounded when read. */
export function startTimer(): () => number {
  const began = monotonic();
  return () => Math.round(monotonic() - began);
}

/**
 * Ring buffer of blob events with change notification.
 *
 * Recording is always on: it costs one small object per fetch, and a debugger
 * that only starts collecting once you open it cannot explain what already
 * happened.
 */
export class BlobTrace {
  private events: BlobEvent[] = [];
  private readonly listeners = new Set<(events: readonly BlobEvent[]) => void>();
  private seq = 0;

  constructor(private readonly limit = 300) {}

  record(event: RecordedEvent): void {
    this.seq += 1;
    this.events.push({ ...event, seq: this.seq, at: Date.now() });
    if (this.events.length > this.limit) {
      this.events = this.events.slice(this.events.length - this.limit);
    }
    this.emit();
  }

  /** Newest first, which is the order the log is read in. */
  list(): readonly BlobEvent[] {
    return [...this.events].reverse();
  }

  forHash(hash: string): readonly BlobEvent[] {
    return this.list().filter((event) => event.hash === hash);
  }

  totals(): TraceTotals {
    return summarizeEvents(this.events);
  }

  clear(): void {
    this.events = [];
    this.emit();
  }

  /** Returns an unsubscribe function, so a component can drop it on teardown. */
  subscribe(listener: (events: readonly BlobEvent[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.list());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snapshot = this.list();
    for (const listener of this.listeners) listener(snapshot);
  }
}
