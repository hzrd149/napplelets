/**
 * BUD-18 reference parsing.
 *
 * Everything a user can paste, or a NAP-INTENT payload can carry, funnels
 * through `parseTreeRef` and comes out as one of two shapes:
 *
 *   immutable — an `nhash` (or bare root hash): the root manifest is pinned.
 *   mutable   — an `npub` + tree name (or `naddr`): the root is whatever the
 *               author's latest kind 30064 event currently points at.
 *
 * The path rule that is easy to get wrong, and that BUD-18 states as a MUST:
 * split on `/` first, then percent-decode each segment. Decoding first would
 * make `releases%2Fnostr-vpn` split into two segments instead of naming one
 * tree, and would let an encoded slash escape a directory.
 */

import { bytesToHex, hexToBytes, isHash32Hex } from './bytes.js';
import { decodeBech32, decodeTlv, encodeBech32, encodeTlv, findTlv } from './bech32.js';
import { isValidEntryName } from './manifest.js';

/** BUD-18 mutable root event. Not registered in NIP-01 — see the README. */
export const HASHTREE_KIND = 30064;
/** Older implementations published the same shape as kind 30078. */
export const LEGACY_HASHTREE_KIND = 30078;

/** `nhash` TLV: type 0 is the root manifest hash, type 5 the optional root key. */
const TLV_ROOT_HASH = 0;
const TLV_ROOT_KEY = 5;

/** NIP-19 `naddr` TLV. */
const TLV_SPECIAL = 0;
const TLV_RELAY = 1;
const TLV_AUTHOR = 2;
const TLV_KIND = 3;

export interface ImmutableRef {
  readonly kind: 'immutable';
  readonly rootHash: string;
  readonly rootKey: string | null;
  readonly path: readonly string[];
}

export interface MutableRef {
  readonly kind: 'mutable';
  readonly pubkey: string;
  readonly treeName: string;
  readonly eventKind: number;
  readonly relays: readonly string[];
  /**
   * The `k=` link key from a link-private reference. Parsed so the UI can say
   * something useful, but v1 does not implement the `encryptedKey` XOR scope.
   */
  readonly linkKey: string | null;
  readonly path: readonly string[];
}

export type TreeRef = ImmutableRef | MutableRef;

export type ParseResult = { ok: true; ref: TreeRef } | { ok: false; error: string };

const fail = (error: string): ParseResult => ({ ok: false, error });

function decodeNhash(input: string): { hash: string; key: string | null } | string {
  const decoded = decodeBech32(input);
  if (decoded === null || decoded.hrp !== 'nhash') return 'not a valid nhash';

  // Legacy form: a bare 32-byte payload is the root hash with no key. Any other
  // length MUST be read as TLV.
  if (decoded.bytes.length === 32) {
    return { hash: bytesToHex(decoded.bytes), key: null };
  }

  const records = decodeTlv(decoded.bytes);
  if (records === null) return 'nhash payload is not valid TLV';

  const hash = findTlv(records, TLV_ROOT_HASH);
  if (hash === undefined) return 'nhash is missing the root manifest hash (TLV type 0)';
  if (hash.length !== 32) return `nhash root hash must be 32 bytes, got ${hash.length}`;

  const key = findTlv(records, TLV_ROOT_KEY);
  if (key !== undefined && key.length !== 32) {
    return `nhash root key must be 32 bytes, got ${key.length}`;
  }

  return { hash: bytesToHex(hash), key: key === undefined ? null : bytesToHex(key) };
}

function decodeNaddr(
  input: string,
): { pubkey: string; identifier: string; eventKind: number; relays: string[] } | string {
  const decoded = decodeBech32(input);
  if (decoded === null || decoded.hrp !== 'naddr') return 'not a valid naddr';

  const records = decodeTlv(decoded.bytes);
  if (records === null) return 'naddr payload is not valid TLV';

  const author = findTlv(records, TLV_AUTHOR);
  if (author === undefined || author.length !== 32) return 'naddr is missing a 32 byte author';

  const kindBytes = findTlv(records, TLV_KIND);
  if (kindBytes === undefined || kindBytes.length !== 4) return 'naddr is missing a kind';
  const eventKind =
    ((kindBytes[0]! << 24) | (kindBytes[1]! << 16) | (kindBytes[2]! << 8) | kindBytes[3]!) >>> 0;

  const special = findTlv(records, TLV_SPECIAL);
  const identifier = special === undefined ? '' : new TextDecoder().decode(special);
  if (identifier.length === 0) return 'naddr is missing a `d` identifier (the tree name)';

  const relays = records
    .filter((record) => record.type === TLV_RELAY)
    .map((record) => new TextDecoder().decode(record.value));

  return { pubkey: bytesToHex(author), identifier, eventKind, relays };
}

function decodeNpub(input: string): string | null {
  const decoded = decodeBech32(input);
  if (decoded === null || decoded.hrp !== 'npub' || decoded.bytes.length !== 32) return null;
  return bytesToHex(decoded.bytes);
}

/**
 * Split off the query and fragment and pull out a `k=` link key.
 *
 * BUD-15 puts `k=` in the query string; the reference gateway refuses that and
 * uses a fragment instead, because a query string is sent to the server on the
 * matching HTTP route and `k` is a bearer secret. Both are accepted here, the
 * fragment wins, and neither ever reaches a Blossom request — see `blobs.ts`.
 */
function stripQueryAndFragment(input: string): { path: string; linkKey: string | null } {
  let rest = input;
  let fragment = '';
  let query = '';

  const hashAt = rest.indexOf('#');
  if (hashAt >= 0) {
    fragment = rest.slice(hashAt + 1);
    rest = rest.slice(0, hashAt);
  }
  const queryAt = rest.indexOf('?');
  if (queryAt >= 0) {
    query = rest.slice(queryAt + 1);
    rest = rest.slice(0, queryAt);
  }

  const readKey = (params: string): string | null => {
    for (const pair of params.split('&')) {
      const [name, value] = pair.split('=');
      if (name === 'k' && value !== undefined && isHash32Hex(value.toLowerCase())) {
        return value.toLowerCase();
      }
    }
    return null;
  };

  return { path: rest, linkKey: readKey(fragment) ?? readKey(query) };
}

/** Percent-decode one already-split segment. */
function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function parsePathSegments(rawSegments: readonly string[]): readonly string[] | string {
  const segments: string[] = [];
  for (let i = 0; i < rawSegments.length; i += 1) {
    const raw = rawSegments[i]!;
    // A trailing slash is directory notation, not an empty entry name.
    if (raw === '' && i === rawSegments.length - 1) continue;
    const decoded = decodeSegment(raw);
    if (decoded === null) return `invalid percent-encoding in path segment ${JSON.stringify(raw)}`;
    if (!isValidEntryName(decoded)) {
      return `invalid path segment ${JSON.stringify(decoded)}`;
    }
    segments.push(decoded);
  }
  return segments;
}

function parseAuthorityForm(rest: string, linkKey: string | null): ParseResult {
  const rawSegments = rest.split('/');
  const authority = rawSegments[0] ?? '';
  if (authority === '') return fail('reference is missing an npub or nhash');

  if (authority.toLowerCase().startsWith('nhash1')) {
    const decoded = decodeNhash(authority);
    if (typeof decoded === 'string') return fail(decoded);
    const path = parsePathSegments(rawSegments.slice(1));
    if (typeof path === 'string') return fail(path);
    return { ok: true, ref: { kind: 'immutable', rootHash: decoded.hash, rootKey: decoded.key, path } };
  }

  if (authority.toLowerCase().startsWith('npub1')) {
    const pubkey = decodeNpub(authority);
    if (pubkey === null) return fail('not a valid npub');
    const rawTreeName = rawSegments[1];
    if (rawTreeName === undefined || rawTreeName === '') {
      return fail('the npub form needs a tree name: htree://<npub>/<tree-name>');
    }
    // A tree name is one logical segment and may legitimately contain `/`
    // (percent-encoded), so it is not subject to the entry-name rules.
    const treeName = decodeSegment(rawTreeName);
    if (treeName === null) return fail('invalid percent-encoding in the tree name');
    const path = parsePathSegments(rawSegments.slice(2));
    if (typeof path === 'string') return fail(path);
    return {
      ok: true,
      ref: {
        kind: 'mutable',
        pubkey,
        treeName,
        eventKind: HASHTREE_KIND,
        relays: [],
        linkKey,
        path,
      },
    };
  }

  return fail('reference authority must be an npub or an nhash');
}

/**
 * Parse anything the user can paste or an intent can deliver.
 *
 * Accepted: `htree://…`, a `/htree/…` gateway path, a bare `nhash1…`,
 * a bare `naddr1…`, or a bare 64-character root hash. A `nostr:` prefix is
 * tolerated because that is how nostr clients hand entities around.
 */
export function parseTreeRef(input: string): ParseResult {
  let value = input.trim();
  if (value === '') return fail('enter a hashtree reference');

  for (const prefix of ['web+nostr:', 'nostr:']) {
    if (value.toLowerCase().startsWith(prefix)) {
      value = value.slice(prefix.length);
      break;
    }
  }

  const { path: withoutParams, linkKey } = stripQueryAndFragment(value);

  const lower = withoutParams.toLowerCase();
  if (lower.startsWith('htree://')) {
    return parseAuthorityForm(withoutParams.slice('htree://'.length), linkKey);
  }
  if (lower.startsWith('/htree/')) {
    return parseAuthorityForm(withoutParams.slice('/htree/'.length), linkKey);
  }
  if (lower.startsWith('htree:/')) {
    // `htree:/…` — a single slash is a common typo; treat it as the same thing.
    return parseAuthorityForm(withoutParams.replace(/^htree:\/+/i, ''), linkKey);
  }

  if (lower.startsWith('nhash1') || lower.startsWith('npub1')) {
    return parseAuthorityForm(withoutParams, linkKey);
  }

  if (lower.startsWith('naddr1')) {
    const decoded = decodeNaddr(withoutParams);
    if (typeof decoded === 'string') return fail(decoded);
    if (decoded.eventKind !== HASHTREE_KIND && decoded.eventKind !== LEGACY_HASHTREE_KIND) {
      return fail(
        `naddr points at kind ${decoded.eventKind}; a hashtree root is kind ${HASHTREE_KIND}`,
      );
    }
    return {
      ok: true,
      ref: {
        kind: 'mutable',
        pubkey: decoded.pubkey,
        treeName: decoded.identifier,
        eventKind: decoded.eventKind,
        relays: decoded.relays,
        linkKey,
        path: [],
      },
    };
  }

  if (isHash32Hex(lower)) {
    return { ok: true, ref: { kind: 'immutable', rootHash: lower, rootKey: linkKey, path: [] } };
  }

  return fail('unrecognised reference — expected htree://…, nhash1…, naddr1…, or a 64 character hash');
}

/** Build a shareable `nhash` for a subtree the user is currently looking at. */
export function encodeNhash(rootHash: string, rootKey: string | null): string | null {
  const hash = hexToBytes(rootHash);
  if (hash === null || hash.length !== 32) return null;
  const records = [{ type: TLV_ROOT_HASH, value: hash }];
  if (rootKey !== null) {
    const key = hexToBytes(rootKey);
    if (key === null || key.length !== 32) return null;
    records.push({ type: TLV_ROOT_KEY, value: key });
  }
  return encodeBech32('nhash', encodeTlv(records));
}

/** Re-serialise a reference plus a path back into an `htree://` URI. */
export function formatHtreeUri(ref: TreeRef, path: readonly string[]): string {
  const segments = path.map((segment) => encodeURIComponent(segment));
  if (ref.kind === 'immutable') {
    const authority = encodeNhash(ref.rootHash, ref.rootKey) ?? ref.rootHash;
    return [`htree://${authority}`, ...segments].join('/');
  }
  const authority = encodeBech32('npub', hexToBytes(ref.pubkey) ?? new Uint8Array(32));
  return [`htree://${authority}`, encodeURIComponent(ref.treeName), ...segments].join('/');
}

/** The `kind:pubkey:d` coordinate for a mutable root. */
export function addressOf(ref: MutableRef): string {
  return `${ref.eventKind}:${ref.pubkey}:${ref.treeName}`;
}
