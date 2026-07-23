import {
  CBZ_MIME_TYPE,
  COMIC_EVENT_KIND,
  COMIC_INFO_FIELDS,
  type BuildComicEventInput,
  type ComicEventDraft,
  type ComicInfoField,
  type ComicMetadata,
} from './comic';
import { getFirstValue } from './comic';
import { normalizeFieldValue } from './normalization';

const INDEX_FIELD_MAP: Partial<Record<ComicInfoField, string>> = {
  Publisher: 'publisher',
  Series: 'series',
  Number: 'number',
  Volume: 'volume',
  Count: 'count',
  LanguageISO: 'language',
  Year: 'year',
  Month: 'month',
  PageCount: 'page-count',
  Genre: 'genre',
  Manga: 'manga',
  BlackAndWhite: 'black-and-white',
  Writer: 'writer',
  Penciller: 'penciller',
  Inker: 'inker',
  Colorist: 'colorist',
  Letterer: 'letterer',
  CoverArtist: 'cover-artist',
  Editor: 'editor',
};

export function buildAddress(metadata: ComicMetadata): string {
  return [
    'cbz',
    normalizeFieldValue('publisher', getFirstValue(metadata, 'Publisher')),
    normalizeFieldValue('series', getFirstValue(metadata, 'Series')),
    normalizeFieldValue('volume', getFirstValue(metadata, 'Volume')),
    normalizeFieldValue('number', getFirstValue(metadata, 'Number')),
    normalizeFieldValue('language', getFirstValue(metadata, 'LanguageISO')),
  ].join(':');
}

export function buildIssueValue(metadata: ComicMetadata): string {
  return [
    normalizeFieldValue('publisher', getFirstValue(metadata, 'Publisher')),
    normalizeFieldValue('series', getFirstValue(metadata, 'Series')),
    normalizeFieldValue('volume', getFirstValue(metadata, 'Volume')),
    normalizeFieldValue('number', getFirstValue(metadata, 'Number')),
    normalizeFieldValue('language', getFirstValue(metadata, 'LanguageISO')),
  ].join('|');
}

export function buildIndexTags(metadata: ComicMetadata): string[][] {
  const tags: string[][] = [];
  for (const [field, indexField] of Object.entries(INDEX_FIELD_MAP) as Array<[ComicInfoField, string]>) {
    for (const value of metadata[field] ?? []) {
      const normalized = normalizeFieldValue(indexField, value);
      if (normalized) tags.push(['c', `${indexField}:${normalized}`]);
    }
  }

  const issue = buildIssueValue(metadata);
  if (issue.replaceAll('|', '')) tags.push(['c', `issue:${issue}`]);
  return tags;
}

export function buildComicInfoTags(metadata: ComicMetadata): string[][] {
  const tags: string[][] = [];
  for (const field of COMIC_INFO_FIELDS) {
    const values = metadata[field]?.map((value) => value.trim()).filter(Boolean);
    if (values?.length) tags.push([field, ...values]);
  }
  return tags;
}

export function buildDefaultContent(metadata: ComicMetadata): string {
  const series = getFirstValue(metadata, 'Series');
  const number = getFirstValue(metadata, 'Number');
  const title = getFirstValue(metadata, 'Title');
  const publisher = getFirstValue(metadata, 'Publisher');
  const year = getFirstValue(metadata, 'Year');
  const writers = metadata.Writer?.join(', ');
  const pencillers = metadata.Penciller?.join(', ');
  const lines = [`${series}${number ? ` #${number}` : ''}${year ? ` (${year})` : ''}`.trim()];
  if (title) lines.push(title);
  const credits = [publisher ? `Published by ${publisher}` : '', writers ? `written by ${writers}` : '', pencillers ? `pencilled by ${pencillers}` : '']
    .filter(Boolean)
    .join(', ');
  if (credits) lines.push('', `${credits}.`);
  return lines.filter((line, index) => line || lines[index - 1]).join('\n');
}

export function buildComicEvent(input: BuildComicEventInput, now = Math.floor(Date.now() / 1000)): ComicEventDraft {
  const address = buildAddress(input.metadata);
  const tags: string[][] = [
    ['d', address],
    ['url', input.cbz.url],
    ['m', CBZ_MIME_TYPE],
    ['x', input.cbz.sha256],
    ['size', String(input.cbz.size)],
    ['thumb', input.thumbnail.url, input.thumbnail.sha256],
  ];

  for (const fallback of input.cbz.fallbackUrls ?? []) tags.push(['fallback', fallback]);
  tags.push(...buildIndexTags(input.metadata));
  tags.push(...buildComicInfoTags(input.metadata));
  tags.push(['alt', `${getFirstValue(input.metadata, 'Series')} #${getFirstValue(input.metadata, 'Number')}, ${getFirstValue(input.metadata, 'Publisher')}`]);

  return {
    kind: COMIC_EVENT_KIND,
    created_at: now,
    content: input.content.trim() || buildDefaultContent(input.metadata),
    tags,
  };
}
