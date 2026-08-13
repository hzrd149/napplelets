/**
 * Content type guessing.
 *
 * BUD-16 defines a media type for directory manifests and BUD-17 defines none
 * for file manifests, and neither defines a metadata key for a file entry's
 * content type — `m` is "JSON-compatible metadata" with only the fanout
 * `count`/`first`/`last` keys specified. A Blossom server returns the type of
 * the *ciphertext* blob for encrypted content, which is meaningless. So the
 * filename extension is the only signal available, which is exactly what the
 * reference gateway does.
 */

export type PreviewKind = 'image' | 'video' | 'audio' | 'text' | 'pdf' | 'none';

const TYPES: Readonly<Record<string, string>> = {
  // images
  apng: 'image/apng',
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  // video
  m4v: 'video/mp4',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  mp4: 'video/mp4',
  ogv: 'video/ogg',
  webm: 'video/webm',
  // audio
  aac: 'audio/aac',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  // text and code
  css: 'text/css',
  csv: 'text/csv',
  html: 'text/html',
  js: 'text/javascript',
  json: 'application/json',
  log: 'text/plain',
  md: 'text/markdown',
  py: 'text/x-python',
  rs: 'text/x-rust',
  svelte: 'text/plain',
  toml: 'text/plain',
  ts: 'text/plain',
  txt: 'text/plain',
  xml: 'application/xml',
  yaml: 'text/plain',
  yml: 'text/plain',
  // documents and archives
  gz: 'application/gzip',
  pdf: 'application/pdf',
  tar: 'application/x-tar',
  zip: 'application/zip',
};

/** Extensionless names are common in a content-addressed tree; do not guess. */
export function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

export function mimeForName(name: string): string {
  const extension = extensionOf(name);
  return (extension !== null ? TYPES[extension] : undefined) ?? 'application/octet-stream';
}

export function previewKindFor(name: string): PreviewKind {
  const mime = mimeForName(name);
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'image/svg+xml') return 'none'; // an SVG is a script container; do not render it
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml') {
    return 'text';
  }
  return 'none';
}

/** Whether shell transport controls are worth registering for this file. */
export function isTimedMedia(name: string): boolean {
  const kind = previewKindFor(name);
  return kind === 'audio' || kind === 'video';
}

/** How much of a text file to pull in for a preview. */
export const TEXT_PREVIEW_BYTES = 256 * 1024;
