// napplets/good-morning/src/lib/debug-log.ts
//
// NAP boundary tracer. good-morning doubles as a runtime/shell debugging napplet
// (see nap-capabilities.ts), so every NAP API call and its response/stream is
// traced to the console. This is intentionally verbose: it exists to diagnose
// why a runtime is (or isn't) delivering data — e.g. an empty follow list, a
// shell handshake that never settles, a subscription that never EOSEs, or GM
// notes that arrive over the wire but get filtered out before they render.
//
// Conformance-safe: `console` is NOT a forbidden global (unlike fetch/WebSocket/
// localStorage/window.nostr). Nothing here crosses the postMessage wire —
// summarize() only READS values to format them, it never re-posts them.
//
// Toggles (read live, so you can flip them in devtools mid-session):
//   window.__GM_DEBUG__        = false  → silence everything except failures.
//   window.__GM_DEBUG_STREAM__ = false  → keep calls/eose/errors, but mute the
//                                         per-event firehose (a busy follow list
//                                         streams every kind-1 note since
//                                         midnight, which is a lot of lines).

let SEQ = 0;

interface DebugFlags {
  __GM_DEBUG__?: boolean;
  __GM_DEBUG_STREAM__?: boolean;
}

/** Master switch — logging is ON unless explicitly disabled. */
function loggingEnabled(): boolean {
  return (globalThis as DebugFlags).__GM_DEBUG__ !== false;
}

/** Per-event stream switch (also gated by the master switch). */
function streamEnabled(): boolean {
  const flags = globalThis as DebugFlags;
  return flags.__GM_DEBUG__ !== false && flags.__GM_DEBUG_STREAM__ !== false;
}

/** HH:MM:SS.mmm — enough to read ordering/latency without date noise. */
function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

/** Shorten a 64-char hex (id/pubkey) for readable one-line logs. */
function short(hex: string): string {
  return hex.length > 16 ? `${hex.slice(0, 8)}…${hex.slice(-4)}` : hex;
}

function isEventLike(v: Record<string, unknown>): boolean {
  return typeof v.id === 'string' && typeof v.kind === 'number' && typeof v.pubkey === 'string';
}

function summarizeEvent(e: Record<string, unknown>): Record<string, unknown> {
  const content = typeof e.content === 'string' ? e.content : '';
  return {
    id: typeof e.id === 'string' ? short(e.id) : e.id,
    kind: e.kind,
    pubkey: typeof e.pubkey === 'string' ? short(e.pubkey) : e.pubkey,
    created_at: e.created_at,
    content: content.length > 80 ? `${content.slice(0, 80)}…(${content.length})` : content,
    tags: Array.isArray(e.tags) ? `${e.tags.length} tags` : e.tags,
  };
}

/**
 * Compact a value for logging: shorten hex, preview long strings, collapse big
 * arrays (a 500-author outbox filter should not print 500 keys), and render Nostr
 * events as a one-line digest. Depth-capped so a stray cycle can't hang the log.
 */
function summarize(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'string') {
    return value.length > 120 ? `${value.slice(0, 120)}…(${value.length})` : value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    if (value.length > 6) {
      return [
        ...value.slice(0, 3).map((item) => summarize(item, depth + 1)),
        `…(+${value.length - 3} more)`,
      ];
    }
    return value.map((item) => summarize(item, depth + 1));
  }
  const obj = value as Record<string, unknown>;
  if (isEventLike(obj)) return summarizeEvent(obj);
  if (depth > 2) return '…';
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) out[key] = summarize(val, depth + 1);
  return out;
}

function emit(line: string, detail: unknown): void {
  if (detail === undefined) console.log(line);
  else console.log(line, summarize(detail));
}

/** A live trace handle for one NAP call (or long-lived subscription). */
export interface NapCallLog {
  /** One-shot response to the call resolved successfully. */
  ok(result?: unknown): void;
  /** A value streamed on a long-lived subscription (repeatable; stream-gated). */
  event(detail?: unknown): void;
  /** A named lifecycle signal (eose, closed, timeout, close-requested, …). */
  info(label: string, detail?: unknown): void;
  /** The call/subscription failed. Always logged, even with logging disabled. */
  fail(err: unknown): void;
}

/**
 * Open a trace for a NAP call. Logs the outgoing call immediately and returns a
 * handle whose `ok`/`event`/`info`/`fail` log the correlated response(s), tagged
 * with a shared sequence number so a call and its reply line up in the console.
 *
 *   const call = napLog('NAP-IDENTITY', 'getFollows');
 *   try { call.ok({ count: follows.length }); } catch (e) { call.fail(e); }
 */
export function napLog(domain: string, method: string, args?: unknown): NapCallLog {
  const seq = ++SEQ;
  const head = `[good-morning] ${domain} #${seq}`;
  if (loggingEnabled()) emit(`${ts()} ${head} → ${method}`, args);
  return {
    ok(result) {
      if (loggingEnabled()) emit(`${ts()} ${head} ← ${method}`, result);
    },
    event(detail) {
      if (streamEnabled()) emit(`${ts()} ${head} ⇐ ${method}:event`, detail);
    },
    info(label, detail) {
      if (loggingEnabled()) emit(`${ts()} ${head} · ${method}:${label}`, detail);
    },
    fail(err) {
      // Failures bypass the master switch — a silenced session should still show
      // the reason a NAP call blew up.
      console.error(`${ts()} ${head} ✗ ${method}`, err);
    },
  };
}

/** Fire-and-forget breadcrumb for app-side decisions around a NAP boundary. */
export function napNote(domain: string, message: string, detail?: unknown): void {
  if (loggingEnabled()) emit(`${ts()} [good-morning] ${domain} · ${message}`, detail);
}
