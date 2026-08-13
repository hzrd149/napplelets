/**
 * Settings and recently-opened trees.
 *
 * Config values arrive from the shell and are entirely untrusted as *shapes* —
 * a user can type anything into a settings field — so `readSettings` is a total
 * function from unknown values to a usable `Settings`, and is pure so it can be
 * tested without a shell.
 */

import { config, storage } from '@napplet/sdk';
import { DEFAULT_BLOSSOM_SERVERS, normalizeServers } from './servers.js';
import { hasMethod } from './nap.js';

export interface Settings {
  readonly blossomServers: readonly string[];
  readonly useAuthorServerList: boolean;
  readonly maxParallelChunks: number;
  /** In bytes; the setting is expressed in MiB. */
  readonly maxCacheBytes: number;
  readonly autoPreview: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  blossomServers: DEFAULT_BLOSSOM_SERVERS,
  useAuthorServerList: true,
  maxParallelChunks: 4,
  maxCacheBytes: 128 * 1024 * 1024,
  autoPreview: false,
};

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
};

export function readSettings(values: Record<string, unknown>): Settings {
  const rawServers = values['blossomServers'];
  const servers = Array.isArray(rawServers)
    ? normalizeServers(rawServers.filter((entry): entry is string => typeof entry === 'string'))
    : [];

  return {
    // An empty or all-invalid list would leave nothing to fetch from, which is a
    // worse outcome than ignoring the setting.
    blossomServers: servers.length > 0 ? servers : DEFAULT_BLOSSOM_SERVERS,
    useAuthorServerList:
      typeof values['useAuthorServerList'] === 'boolean'
        ? values['useAuthorServerList']
        : DEFAULT_SETTINGS.useAuthorServerList,
    maxParallelChunks: clampInt(values['maxParallelChunks'], 1, 16, 4),
    maxCacheBytes: clampInt(values['maxCacheBytes'], 8, 1024, 128) * 1024 * 1024,
    autoPreview:
      typeof values['autoPreview'] === 'boolean' ? values['autoPreview'] : DEFAULT_SETTINGS.autoPreview,
  };
}

/** Subscribe to live config. The first delivery is an immediate snapshot. */
export function subscribeSettings(onSettings: (settings: Settings) => void): () => void {
  if (!hasMethod('config', 'subscribe')) {
    onSettings(DEFAULT_SETTINGS);
    return () => undefined;
  }
  try {
    const subscription = config.subscribe((values) => onSettings(readSettings(values)));
    return () => subscription.close();
  } catch {
    onSettings(DEFAULT_SETTINGS);
    return () => undefined;
  }
}

export function openSettings(): void {
  if (!hasMethod('config', 'openSettings')) return;
  try {
    config.openSettings();
  } catch {
    // Ignore: deep-linking into shell settings is a convenience.
  }
}

export interface RecentTree {
  /** The reference exactly as it should be re-parsed. */
  readonly reference: string;
  readonly label: string;
  readonly openedAt: number;
}

const RECENTS_KEY = 'recent-trees';
const MAX_RECENTS = 8;

/** Pure: merge a new entry into the recents list, newest first, de-duplicated. */
export function mergeRecent(
  existing: readonly RecentTree[],
  entry: RecentTree,
): RecentTree[] {
  return [entry, ...existing.filter((item) => item.reference !== entry.reference)].slice(
    0,
    MAX_RECENTS,
  );
}

function parseRecents(raw: string | null): RecentTree[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is RecentTree =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as RecentTree).reference === 'string' &&
        typeof (item as RecentTree).label === 'string',
    );
  } catch {
    return [];
  }
}

export async function loadRecents(): Promise<RecentTree[]> {
  if (!hasMethod('storage', 'getItem')) return [];
  try {
    return parseRecents(await storage.getItem(RECENTS_KEY));
  } catch {
    return [];
  }
}

export async function saveRecents(entries: readonly RecentTree[]): Promise<void> {
  if (!hasMethod('storage', 'setItem')) return;
  try {
    await storage.setItem(RECENTS_KEY, JSON.stringify(entries));
  } catch {
    // Ignore: losing the recents list is not worth surfacing.
  }
}
