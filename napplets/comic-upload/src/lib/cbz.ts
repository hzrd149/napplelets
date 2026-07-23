import { unzipSync } from 'fflate';
import { parseComicInfoXml } from './comic-info';
import type { ParsedCbz } from './comic';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : path.slice(dot).toLocaleLowerCase();
}

function mimeForImage(path: string): string {
  const ext = extensionOf(path);
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

export function inspectCbz(arrayBuffer: ArrayBuffer): ParsedCbz {
  const entries = unzipSync(new Uint8Array(arrayBuffer));
  const entryNames = Object.keys(entries).filter((name) => !name.endsWith('/'));
  const comicInfoName = entryNames.find((name) => name.split('/').at(-1)?.toLocaleLowerCase() === 'comicinfo.xml');
  const imageName = entryNames
    .filter((name) => IMAGE_EXTENSIONS.has(extensionOf(name)))
    .sort((a, b) => collator.compare(a, b))[0];

  if (!imageName) throw new Error('No cover image candidate was found in the CBZ.');

  const metadata = comicInfoName ? parseComicInfoXml(new TextDecoder().decode(entries[comicInfoName])) : {};
  const coverBytes = entries[imageName];

  return {
    metadata,
    comicInfoFound: Boolean(comicInfoName),
    cover: new Blob([coverBytes], { type: mimeForImage(imageName) }),
    coverName: imageName,
    entryCount: entryNames.length,
  };
}
