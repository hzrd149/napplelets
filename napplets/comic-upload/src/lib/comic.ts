export const COMIC_EVENT_KIND = 35641;
export const CBZ_MIME_TYPE = 'application/vnd.comicbook+zip';

export const COMIC_INFO_FIELDS = [
  'Series',
  'Number',
  'Title',
  'Publisher',
  'Volume',
  'Count',
  'LanguageISO',
  'Year',
  'Month',
  'Day',
  'PageCount',
  'Genre',
  'Writer',
  'Penciller',
  'Inker',
  'Colorist',
  'Letterer',
  'CoverArtist',
  'Editor',
  'Manga',
  'BlackAndWhite',
  'AgeRating',
  'StoryArc',
  'Character',
  'Team',
  'Location',
  'Web',
] as const;

export const REQUIRED_FIELDS = ['Series', 'Number', 'Title', 'Publisher', 'LanguageISO'] as const;

export const MULTI_VALUE_FIELDS = new Set<ComicInfoField>([
  'Genre',
  'Writer',
  'Penciller',
  'Inker',
  'Colorist',
  'Letterer',
  'CoverArtist',
  'Editor',
  'StoryArc',
  'Character',
  'Team',
  'Location',
]);

export type ComicInfoField = (typeof COMIC_INFO_FIELDS)[number];
export type RequiredComicInfoField = (typeof REQUIRED_FIELDS)[number];

export type ComicMetadata = Partial<Record<ComicInfoField, string[]>>;

export interface ParsedCbz {
  metadata: ComicMetadata;
  comicInfoFound: boolean;
  cover: Blob;
  coverName: string;
  entryCount: number;
}

export interface UploadAsset {
  url: string;
  sha256?: string;
  size?: number;
  mimeType?: string;
  fallbackUrls?: string[];
}

export interface BuildComicEventInput {
  metadata: ComicMetadata;
  cbz: UploadAsset & { sha256: string; size: number };
  thumbnail: UploadAsset & { sha256: string };
  content: string;
}

export interface ComicEventDraft {
  kind: typeof COMIC_EVENT_KIND;
  content: string;
  created_at: number;
  tags: string[][];
}

export function getFirstValue(metadata: ComicMetadata, field: ComicInfoField): string {
  return metadata[field]?.[0]?.trim() ?? '';
}

export function setFieldValue(metadata: ComicMetadata, field: ComicInfoField, rawValue: string): void {
  const values = splitComicInfoValue(field, rawValue);
  if (values.length > 0) metadata[field] = values;
  else delete metadata[field];
}

export function splitComicInfoValue(field: ComicInfoField, rawValue: string): string[] {
  const trimmed = rawValue.trim();
  if (!trimmed) return [];
  if (!MULTI_VALUE_FIELDS.has(field)) return [trimmed];
  return trimmed
    .split(/[;,]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function missingRequiredFields(metadata: ComicMetadata): RequiredComicInfoField[] {
  return REQUIRED_FIELDS.filter((field) => !getFirstValue(metadata, field));
}
