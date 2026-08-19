import { describe, expect, it } from 'vitest';

import { BlobTrace, summarizeEvents, type RecordedEvent } from './trace.js';

const event = (overrides: Partial<RecordedEvent> = {}): RecordedEvent => ({
  hash: 'a'.repeat(64),
  encrypted: false,
  source: 'network',
  server: 'https://blossom.example',
  attempts: [],
  bytes: 1024,
  ms: 5,
  ok: true,
  error: null,
  ...overrides,
});

describe('BlobTrace', () => {
  it('numbers events and lists them newest first', () => {
    const trace = new BlobTrace();
    trace.record(event({ hash: 'a'.repeat(64) }));
    trace.record(event({ hash: 'b'.repeat(64) }));

    const listed = trace.list();
    expect(listed.map((entry) => entry.seq)).toEqual([2, 1]);
    expect(listed[0]?.hash).toBe('b'.repeat(64));
  });

  it('drops the oldest events once the limit is reached', () => {
    const trace = new BlobTrace(3);
    for (let i = 0; i < 5; i += 1) trace.record(event({ bytes: i }));

    // The counter keeps running even though the early events are gone, so a
    // truncated log never reuses a key.
    expect(trace.list().map((entry) => entry.seq)).toEqual([5, 4, 3]);
  });

  it('stamps each event, so producers need no clock of their own', () => {
    const before = Date.now();
    const trace = new BlobTrace();
    trace.record(event());
    expect(trace.list()[0]!.at).toBeGreaterThanOrEqual(before);
  });

  it('filters by hash', () => {
    const trace = new BlobTrace();
    trace.record(event({ hash: 'a'.repeat(64) }));
    trace.record(event({ hash: 'b'.repeat(64) }));
    trace.record(event({ hash: 'a'.repeat(64) }));

    expect(trace.forHash('a'.repeat(64))).toHaveLength(2);
  });

  it('notifies subscribers immediately and on every change', () => {
    const trace = new BlobTrace();
    trace.record(event());

    const seen: number[] = [];
    const unsubscribe = trace.subscribe((events) => seen.push(events.length));
    expect(seen).toEqual([1]);

    trace.record(event());
    expect(seen).toEqual([1, 2]);

    unsubscribe();
    trace.record(event());
    expect(seen).toEqual([1, 2]);
  });

  it('reports an empty log after clearing', () => {
    const trace = new BlobTrace();
    trace.record(event());
    trace.clear();
    expect(trace.list()).toEqual([]);
    expect(trace.totals().events).toBe(0);
  });
});

describe('summarizeEvents', () => {
  it('counts only network reads as bytes fetched', () => {
    const totals = summarizeEvents([
      { at: 0, ...event({ source: 'network', bytes: 100 }), seq: 1 },
      { at: 0, ...event({ source: 'cache', bytes: 100, server: null }), seq: 2 },
      { at: 0, ...event({ source: 'inflight', bytes: 100, server: null }), seq: 3 },
    ]);

    expect(totals).toEqual({
      events: 3,
      network: 1,
      cache: 1,
      inflight: 1,
      failed: 0,
      fetchedBytes: 100,
    });
  });

  it('counts failures separately from where they came from', () => {
    const totals = summarizeEvents([
      { at: 0, ...event({ ok: false, error: 'boom', bytes: 0 }), seq: 1 },
      { at: 0, ...event(), seq: 2 },
    ]);

    expect(totals.failed).toBe(1);
    expect(totals.network).toBe(2);
    expect(totals.fetchedBytes).toBe(1024);
  });
});
