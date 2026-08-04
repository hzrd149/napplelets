import { describe, expect, it } from 'vitest';
import {
  base64ToBytes, basename, isDescendantPath, joinPath, parentPath, previewKind,
  sortEntries, validateEntryName,
} from './fs-utils';

describe('virtual path helpers', () => {
  it('joins and splits absolute virtual paths', () => {
    expect(joinPath('/', 'notes')).toBe('/notes');
    expect(joinPath('/shared/', 'notes')).toBe('/shared/notes');
    expect(parentPath('/shared/notes/a.txt')).toBe('/shared/notes');
    expect(basename('/shared/notes/a.txt')).toBe('a.txt');
  });

  it('checks descendant boundaries without prefix confusion', () => {
    expect(isDescendantPath('/docs', '/docs/archive')).toBe(true);
    expect(isDescendantPath('/docs', '/docs2')).toBe(false);
    expect(isDescendantPath('/docs', '/docs')).toBe(false);
  });
});

describe('entry rules', () => {
  it('rejects unsafe names', () => {
    expect(validateEntryName('')).toBeTruthy();
    expect(validateEntryName('../x')).toBeTruthy();
    expect(validateEntryName(' spaced ')).toBeTruthy();
    expect(validateEntryName('notes.txt')).toBeNull();
  });

  it('sorts directories first and names naturally', () => {
    const result = sortEntries([
      { name: 'file10', path: '/file10', kind: 'file' },
      { name: 'z', path: '/z', kind: 'directory' },
      { name: 'file2', path: '/file2', kind: 'file' },
    ]);
    expect(result.map((entry) => entry.name)).toEqual(['z', 'file2', 'file10']);
  });
});

describe('preview helpers', () => {
  it('classifies only explicitly supported formats', () => {
    expect(previewKind('README.md')).toEqual({ kind: 'text' });
    expect(previewKind('photo.WEBP')).toEqual({ kind: 'image', mime: 'image/webp' });
    expect(previewKind('vector.svg')).toEqual({ kind: 'none' });
    expect(previewKind('archive.zip')).toEqual({ kind: 'none' });
  });

  it('decodes standard padded base64', () => {
    expect([...base64ToBytes('SGk=')]).toEqual([72, 105]);
  });
});
