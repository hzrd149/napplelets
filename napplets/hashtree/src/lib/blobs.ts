/**
 * Verified blob fetching over NAP-RESOURCE.
 *
 * Every byte the napplet uses passes through here, and nothing leaves here
 * unverified: BUD-17 makes "clients MUST verify every fetched blob against the
 * hash from its link before using it" a hard requirement, and BUD-15 says the
 * blob_hash and chk_key checks MUST NOT be skipped as an optimization.
 *
 * Two things this deliberately does not do:
 *   - it never puts a decryption key in a request. The URL is `<server>/<hash>`
 *     and nothing else. `k` is a bearer secret and BUD-15/16 both say clients
 *     MUST NOT send it to Blossom servers.
 *   - it never reports "not found" from a failed fetch. Failure across N servers
 *     means availability is *unknown*; absence is not observable from here.
 */

import { resource } from '@napplet/sdk';
import { decryptChkHex } from './chk.js';
import { sha256Hex } from './hash.js';
import { decodeNode, type TreeNode } from './manifest.js';
import { ServerRanking } from './servers.js';
import { startTimer, type RecordedEvent, type ServerAttempt } from './trace.js';

export type { ServerAttempt };

export type BlobErrorCode =
  | 'no-servers'
  | 'resource-unavailable'
  | 'unavailable'
  | 'decrypt-failed'
  | 'aborted';

export class BlobError extends Error {
  constructor(
    message: string,
    readonly code: BlobErrorCode,
    readonly attempts: readonly ServerAttempt[] = [],
  ) {
    super(message);
    this.name = 'BlobError';
  }
}

export interface BlobStoreOptions {
  /** Read lazily so a config change takes effect without rebuilding the store. */
  readonly servers: () => readonly string[];
  readonly maxCacheBytes: () => number;
  /**
   * Called once per `bytes()` call with what it took to satisfy it. Optional and
   * never awaited: the store's behaviour must not depend on anyone watching.
   */
  readonly onEvent?: (event: RecordedEvent) => void;
}

export interface FetchOptions {
  readonly signal?: AbortSignal;
}

/**
 * The surface `tree.ts` needs. Structural so navigation can be tested against an
 * in-memory tree without a shell, and so the store stays swappable.
 */
export interface NodeSource {
  bytes(hash: string, key: string | null, options?: FetchOptions): Promise<Uint8Array>;
  node(hash: string, key: string | null, options?: FetchOptions): Promise<TreeNode>;
}

const describeError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};

const abortIfRequested = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted === true) throw new BlobError('Cancelled.', 'aborted');
};

export class BlobStore {
  private readonly ranking = new ServerRanking();
  /** Insertion order doubles as LRU order: re-inserting moves an entry to the end. */
  private readonly cache = new Map<string, Uint8Array>();
  private readonly nodes = new Map<string, TreeNode>();
  private readonly inflight = new Map<string, Promise<Uint8Array>>();
  private cacheBytes = 0;

  constructor(private readonly options: BlobStoreOptions) {}

  private static cacheKey(hash: string, key: string | null): string {
    return key === null ? hash : `${hash}:${key}`;
  }

  private remember(cacheKey: string, bytes: Uint8Array): void {
    const budget = Math.max(0, this.options.maxCacheBytes());
    // Never let one oversized blob evict the whole cache.
    if (bytes.length > budget / 2) return;
    this.cache.set(cacheKey, bytes);
    this.cacheBytes += bytes.length;
    for (const [oldest, value] of this.cache) {
      if (this.cacheBytes <= budget) break;
      if (oldest === cacheKey) break;
      this.cache.delete(oldest);
      this.cacheBytes -= value.length;
    }
  }

  private take(cacheKey: string): Uint8Array | undefined {
    const hit = this.cache.get(cacheKey);
    if (hit === undefined) return undefined;
    this.cache.delete(cacheKey);
    this.cache.set(cacheKey, hit);
    return hit;
  }

  /**
   * Fetch the blob addressed by `hash` and prove it is that blob.
   *
   * A server that returns the wrong bytes is treated as a failed server, not a
   * failed fetch — the next one is tried. The servers that were rejected on the
   * way to the one that worked are returned too, not just on failure: that trail
   * is exactly what the inspector shows.
   */
  private async fetchVerified(
    hash: string,
    signal: AbortSignal | undefined,
  ): Promise<{ bytes: Uint8Array; server: string; attempts: readonly ServerAttempt[] }> {
    if (typeof resource?.bytes !== 'function') {
      throw new BlobError(
        'This shell does not provide NAP-RESOURCE, so no blobs can be fetched.',
        'resource-unavailable',
      );
    }

    const servers = this.ranking.order(this.options.servers());
    if (servers.length === 0) {
      throw new BlobError(
        'No Blossom servers are configured. Add at least one in settings.',
        'no-servers',
      );
    }

    const attempts: ServerAttempt[] = [];
    for (const server of servers) {
      abortIfRequested(signal);
      try {
        // The hash is the whole request. No query string: `k` never goes out.
        const blob = await resource.bytes(`${server}/${hash}`, signal ? { signal } : {});
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const actual = sha256Hex(bytes);
        if (actual !== hash) {
          this.ranking.failed(server);
          attempts.push({
            server,
            error: `served ${actual.slice(0, 12)}… when ${hash.slice(0, 12)}… was requested`,
          });
          continue;
        }
        this.ranking.succeeded(server);
        return { bytes, server, attempts };
      } catch (error) {
        if (error instanceof BlobError && error.code === 'aborted') throw error;
        this.ranking.failed(server);
        attempts.push({ server, error: describeError(error) });
      }
    }

    throw new BlobError(
      `Could not retrieve ${hash.slice(0, 12)}… from any of the ${servers.length} configured server(s). ` +
        'This does not mean the blob does not exist — only that none of these servers served it.',
      'unavailable',
      attempts,
    );
  }

  /** Verified, and decrypted when the link carried a key. */
  async bytes(hash: string, key: string | null, options: FetchOptions = {}): Promise<Uint8Array> {
    const cacheKey = BlobStore.cacheKey(hash, key);
    const elapsed = startTimer();
    const encrypted = key !== null;

    const cached = this.take(cacheKey);
    if (cached !== undefined) {
      this.report({
        hash,
        encrypted,
        source: 'cache',
        server: null,
        attempts: [],
        bytes: cached.length,
        ms: elapsed(),
        ok: true,
        error: null,
      });
      return cached;
    }

    const existing = this.inflight.get(cacheKey);
    if (existing !== undefined) {
      // Ride along on the request already in flight. Reported separately from a
      // cache hit so a fan-out of duplicate chunk requests is visible as such.
      const bytes = await existing;
      this.report({
        hash,
        encrypted,
        source: 'inflight',
        server: null,
        attempts: [],
        bytes: bytes.length,
        ms: elapsed(),
        ok: true,
        error: null,
      });
      return bytes;
    }

    let server: string | null = null;
    let attempts: readonly ServerAttempt[] = [];

    const pending = (async () => {
      const result = await this.fetchVerified(hash, options.signal);
      server = result.server;
      attempts = result.attempts;
      if (key === null) return result.bytes;
      try {
        // The ciphertext already matched `hash`, so a failure here is a wrong
        // key, not a bad server. Retrying elsewhere would just fail identically.
        return decryptChkHex(result.bytes, key);
      } catch (error) {
        throw new BlobError(
          `The blob ${hash.slice(0, 12)}… could not be decrypted: ${describeError(error)}`,
          'decrypt-failed',
        );
      }
    })();

    this.inflight.set(cacheKey, pending);
    try {
      const bytes = await pending;
      this.remember(cacheKey, bytes);
      this.report({
        hash,
        encrypted,
        source: 'network',
        server,
        attempts,
        bytes: bytes.length,
        ms: elapsed(),
        ok: true,
        error: null,
      });
      return bytes;
    } catch (error) {
      this.report({
        hash,
        encrypted,
        source: 'network',
        server,
        // A failure before any server answered still carries the whole trail.
        attempts: error instanceof BlobError && error.attempts.length > 0 ? error.attempts : attempts,
        bytes: 0,
        ms: elapsed(),
        ok: false,
        error: describeError(error),
      });
      throw error;
    } finally {
      this.inflight.delete(cacheKey);
    }
  }

  /** Never let a broken observer break a fetch. */
  private report(event: RecordedEvent): void {
    try {
      this.options.onEvent?.(event);
    } catch {
      // Ignore: tracing is diagnostic, and the caller wants its bytes.
    }
  }

  /** Verified, decrypted, and decoded as a tree node. */
  async node(hash: string, key: string | null, options: FetchOptions = {}): Promise<TreeNode> {
    const cacheKey = BlobStore.cacheKey(hash, key);
    const cached = this.nodes.get(cacheKey);
    if (cached !== undefined) return cached;

    const node = decodeNode(await this.bytes(hash, key, options));
    this.nodes.set(cacheKey, node);
    return node;
  }

  /** True when this blob is already available without a network round trip. */
  has(hash: string, key: string | null): boolean {
    return this.cache.has(BlobStore.cacheKey(hash, key));
  }

  clear(): void {
    this.cache.clear();
    this.nodes.clear();
    this.cacheBytes = 0;
  }
}

/** BUD-17 chunk size. Only used to sanity-check the host's resource limits. */
export const CHUNK_SIZE = 2097152;

/**
 * Warn if the shell's resource policy is too tight to fetch a full chunk.
 * Advisory only — the real answer comes from an actual fetch failing.
 */
export async function describeResourceLimits(): Promise<string | null> {
  if (typeof resource?.info !== 'function') return null;
  try {
    const info = await resource.info();
    const maxBytes = info.maxBytes;
    if (typeof maxBytes === 'number' && maxBytes > 0 && maxBytes < CHUNK_SIZE) {
      return `This shell caps resource fetches at ${maxBytes} bytes, below the ${CHUNK_SIZE} byte BUD-17 chunk size. Large files will fail to assemble.`;
    }
    const https = info.schemes?.find((scheme) => scheme.scheme === 'https');
    if (https !== undefined && !https.enabled) {
      return 'This shell has disabled https: resource fetches, so no Blossom server can be reached.';
    }
    return null;
  } catch {
    return null;
  }
}
