/**
 * Virtual-path helpers for NAP-FS.
 *
 * NAP-FS paths are virtual absolute paths owned by the runtime. Nothing here
 * may infer anything about the host filesystem -- these are string operations
 * on the runtime's namespace and nothing more.
 *
 * Adapted from `napplets/file-browser/src/fs-utils.ts`. Copied rather than
 * shared: extracting a `lib/` package would mean editing file-browser, which is
 * outside this napplet's scope. The same duplication note applies here as to
 * the colour math the three theme packages each carry.
 */

import type { FsDirectoryEntry } from '@napplet/sdk';

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

/**
 * Names the user may type into the Save As box. Slashes are rejected rather
 * than treated as a path: the file dialog decides which directory a name lands
 * in, and letting a name escape it would be a surprise.
 */
export function validateFileName(value: string): string | null {
  if (!value.trim()) return 'Enter a file name.';
  if (value !== value.trim()) return 'File names cannot start or end with spaces.';
  if (value === '.' || value === '..') return 'Choose a different file name.';
  if (/[\\/\0-\x1f\x7f]/.test(value))
    return 'File names cannot contain slashes or control characters.';
  return null;
}

/** Directories first, then natural-order by name -- the order Explorer used. */
export function sortEntries(entries: FsDirectoryEntry[]): FsDirectoryEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind === 'directory' && b.kind !== 'directory') return -1;
    if (a.kind !== 'directory' && b.kind === 'directory') return 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
}

/** Extensions the "Text Documents" filter in the file dialog admits. */
const TEXT_EXTENSIONS = new Set([
  'txt',
  'text',
  'md',
  'markdown',
  'log',
  'ini',
  'conf',
  'cfg',
  'csv',
  'json',
  'xml',
  'yaml',
  'yml',
  'toml',
  'js',
  'ts',
  'css',
  'html',
  'htm',
  'sh',
]);

export function isTextFileName(name: string): boolean {
  const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return TEXT_EXTENSIONS.has(extension);
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
