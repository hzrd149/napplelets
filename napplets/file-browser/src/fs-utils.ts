import type { FsDirectoryEntry } from '@napplet/sdk';

export const TEXT_PREVIEW_BYTES = 256 * 1024;
export const IMAGE_PREVIEW_BYTES = 4 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'json', 'csv', 'log', 'xml', 'yaml', 'yml', 'toml', 'ini',
  'css', 'js', 'ts', 'html', 'htm', 'sh', 'conf',
]);
const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
};

export type PreviewKind = { kind: 'text' } | { kind: 'image'; mime: string } | { kind: 'none' };

export function basename(path: string): string {
  if (path === '/') return '/';
  return path.replace(/\/+$/, '').split('/').pop() ?? path;
}

export function parentPath(path: string): string {
  const normalized = path === '/' ? '/' : path.replace(/\/+$/, '');
  const index = normalized.lastIndexOf('/');
  return index <= 0 ? '/' : normalized.slice(0, index);
}

export function joinPath(parent: string, name: string): string {
  return parent === '/' ? `/${name}` : `${parent.replace(/\/+$/, '')}/${name}`;
}

export function isDescendantPath(parent: string, candidate: string): boolean {
  const prefix = parent === '/' ? '/' : `${parent.replace(/\/+$/, '')}/`;
  return candidate !== parent && candidate.startsWith(prefix);
}

export function validateEntryName(value: string): string | null {
  if (!value.trim()) return 'Enter a name.';
  if (value !== value.trim()) return 'Names cannot start or end with spaces.';
  if (value === '.' || value === '..') return 'Choose a different name.';
  if (/[\\/\0-\x1f\x7f]/.test(value)) return 'Names cannot contain slashes or control characters.';
  return null;
}

export function sortEntries(entries: FsDirectoryEntry[]): FsDirectoryEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind === 'directory' && b.kind !== 'directory') return -1;
    if (a.kind !== 'directory' && b.kind === 'directory') return 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
}

export function previewKind(name: string): PreviewKind {
  const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  const mime = IMAGE_TYPES[extension];
  if (mime) return { kind: 'image', mime };
  if (TEXT_EXTENSIONS.has(extension)) return { kind: 'text' };
  return { kind: 'none' };
}

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function formatBytes(value?: number): string {
  if (value === undefined) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

export function formatDate(value?: number): string {
  if (value === undefined) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : date.toLocaleString();
}
