/**
 * One level of the underlying blob structure, described for display.
 *
 * The browser view deliberately hides the shape of a tree: BUD-17 requires
 * readers to flatten fanout nodes and never expose their internal links, and a
 * file is presented as a file, not as the chunk list it really is. That is the
 * right default and the wrong thing for debugging, so this module reports the
 * structure as stored — fanout nodes included, chunks included, in manifest
 * order rather than sorted for the eye.
 *
 * Expansion stays one node at a time, like the rest of the napplet: inspecting a
 * directory fetches that directory's manifest and nothing below it. Leaf blobs
 * are described from their link alone and never fetched — the size and hash are
 * already known, and pulling 2 MiB to look at a row would be absurd.
 */

import type { FetchOptions, NodeSource } from './blobs.js';
import {
  LINK_BLOB,
  LINK_DIR,
  LINK_FANOUT,
  LINK_FILE,
  decodeNode,
  type FanoutBounds,
  type LinkType,
  type NodeType,
  type TreeLink,
} from './manifest.js';

export type LinkKind = 'blob' | 'file' | 'directory' | 'fanout';

/** What a `t` value means, in words, for a UI that should not hardcode 0..3. */
export function linkKind(type: LinkType): LinkKind {
  switch (type) {
    case LINK_BLOB:
      return 'blob';
    case LINK_FILE:
      return 'file';
    case LINK_DIR:
      return 'directory';
    case LINK_FANOUT:
      return 'fanout';
  }
}

/** True when this link addresses a manifest that can be opened one level deeper. */
export function isManifestLink(type: LinkType): boolean {
  return type !== LINK_BLOB;
}

export interface InspectedLink {
  /** Position in the parent's `l` array — the identity of a link with no name. */
  readonly index: number;
  readonly hash: string;
  readonly key: string | null;
  readonly type: LinkType;
  readonly kind: LinkKind;
  readonly name: string | null;
  readonly size: number;
  /**
   * Plaintext offset this link's bytes start at inside a file manifest — the
   * prefix sum BUD-17 stores no field for. `null` outside a file manifest.
   */
  readonly offset: number | null;
  /** `m.count` / `m.first` / `m.last`, present exactly on fanout links. */
  readonly fanout: FanoutBounds | null;
  /** Metadata field names, so an unexpected `m` is visible without dumping values. */
  readonly metadataKeys: readonly string[];
}

export interface InspectedNode {
  readonly hash: string;
  readonly key: string | null;
  readonly encrypted: boolean;
  /** `null` for a raw blob, which has no manifest and therefore no node type. */
  readonly nodeType: NodeType | null;
  readonly kind: LinkKind;
  /** Decoded manifest length in bytes; `null` for a leaf blob, which is not read. */
  readonly manifestBytes: number | null;
  /** Sum of the link sizes — the plaintext this subtree stands for. */
  readonly totalSize: number;
  readonly links: readonly InspectedLink[];
}

/** The subject of an inspection: a root, a directory entry, or a bare link. */
export interface InspectTarget {
  readonly hash: string;
  readonly key: string | null;
  readonly type: LinkType;
}

function describeLink(link: TreeLink, index: number, offset: number | null): InspectedLink {
  return {
    index,
    hash: link.hash,
    key: link.key,
    type: link.type,
    kind: linkKind(link.type),
    name: link.name,
    size: link.size,
    offset,
    fanout: link.fanout,
    metadataKeys: link.metadata === null ? [] : Object.keys(link.metadata),
  };
}

/**
 * Read one node and describe it.
 *
 * Throws whatever the store or the decoder throws — a manifest that will not
 * decode is a finding, and the caller renders the message against the row that
 * produced it rather than losing it.
 */
export async function inspectNode(
  store: NodeSource,
  target: InspectTarget,
  options: FetchOptions = {},
): Promise<InspectedNode> {
  if (target.type === LINK_BLOB) {
    return {
      hash: target.hash,
      key: target.key,
      encrypted: target.key !== null,
      nodeType: null,
      kind: 'blob',
      manifestBytes: null,
      totalSize: 0,
      links: [],
    };
  }

  // `bytes` rather than `node` so the encoded size is observable; both read the
  // same cache entry, so this costs no extra fetch.
  const raw = await store.bytes(target.hash, target.key, options);
  const node = decodeNode(raw);

  let offset = 0;
  const links = node.links.map((link, index) => {
    // Offsets only mean something where the links are consecutive byte ranges.
    const at = node.type === LINK_FILE ? offset : null;
    offset += link.size;
    return describeLink(link, index, at);
  });

  return {
    hash: target.hash,
    key: target.key,
    encrypted: target.key !== null,
    nodeType: node.type,
    kind: linkKind(node.type),
    manifestBytes: raw.length,
    totalSize: links.reduce((total, link) => total + link.size, 0),
    links,
  };
}

/**
 * A one-line shape summary, e.g. `4 chunks` or `12 entries, 2 subtrees`.
 *
 * Counting by kind rather than reporting a bare link count is what makes a
 * fanout node legible: its links are subtrees, not entries.
 */
export function summarizeLinks(links: readonly InspectedLink[]): string {
  const counts = new Map<LinkKind, number>();
  for (const link of links) counts.set(link.kind, (counts.get(link.kind) ?? 0) + 1);

  const label = (kind: LinkKind, count: number): string => {
    const plural = count === 1 ? '' : 's';
    switch (kind) {
      case 'blob':
        return `${count} chunk${plural}`;
      case 'file':
        return `${count} file manifest${plural}`;
      case 'directory':
        return `${count} director${count === 1 ? 'y' : 'ies'}`;
      case 'fanout':
        return `${count} fanout node${plural}`;
    }
  };

  const parts = [...counts].map(([kind, count]) => label(kind, count));
  return parts.length === 0 ? 'no links' : parts.join(', ');
}
