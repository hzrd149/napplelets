import * as nip19 from 'nostr-tools/nip19';
import type { NostrEvent } from '@napplet/sdk';

export const NAPPLET_KIND_NAMED = 35129;

export interface NappletManifestSummary {
  address: string;
  naddr: string;
  title: string;
  description: string;
  identifier: string;
  pubkey: string;
  createdAt: number;
  aggregateHash: string | null;
  pathCount: number;
  isSingleFile: boolean;
  requires: string[];
  archetypes: string[];
  hasConfig: boolean;
}

export function summarizeManifest(event: NostrEvent, relayHints: string[] = []): NappletManifestSummary | null {
  if (event.kind !== NAPPLET_KIND_NAMED) return null;

  const identifier = firstTagValue(event, 'd');
  if (!identifier) return null;

  const title = firstTagValue(event, 'title') || identifier;
  const description = firstTagValue(event, 'description') || '';
  const aggregateHash = event.tags.find((tag) => tag[0] === 'x' && tag[2] === 'aggregate')?.[1] ?? null;
  const pathTags = event.tags.filter((tag) => tag[0] === 'path');
  const requires = uniqueTagValues(event, 'requires');
  const archetypes = event.tags
    .filter((tag) => tag[0] === 'archetype')
    .map((tag) => tag.slice(1).filter(Boolean).join(' / '))
    .filter(Boolean);

  return {
    address: `${event.kind}:${event.pubkey}:${identifier}`,
    naddr: nip19.naddrEncode({
      kind: event.kind,
      pubkey: event.pubkey,
      identifier,
      relays: relayHints,
    }),
    title,
    description,
    identifier,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    aggregateHash,
    pathCount: pathTags.length,
    isSingleFile: pathTags.length === 1 && pathTags[0]?.[1] === '/index.html',
    requires,
    archetypes,
    hasConfig: event.tags.some((tag) => tag[0] === 'config' && Boolean(tag[1])),
  };
}

export function upsertNewest(
  items: Map<string, NappletManifestSummary>,
  next: NappletManifestSummary,
): boolean {
  const current = items.get(next.address);
  if (current && current.createdAt >= next.createdAt) return false;
  items.set(next.address, next);
  return true;
}

export function sortedSummaries(items: Iterable<NappletManifestSummary>): NappletManifestSummary[] {
  return [...items].sort((a, b) => b.createdAt - a.createdAt || a.title.localeCompare(b.title));
}

function firstTagValue(event: NostrEvent, name: string): string | null {
  return event.tags.find((tag) => tag[0] === name && Boolean(tag[1]))?.[1] ?? null;
}

function uniqueTagValues(event: NostrEvent, name: string): string[] {
  return [...new Set(event.tags.filter((tag) => tag[0] === name && Boolean(tag[1])).map((tag) => tag[1]))];
}
