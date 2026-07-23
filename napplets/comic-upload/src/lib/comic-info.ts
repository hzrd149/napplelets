import { COMIC_INFO_FIELDS, MULTI_VALUE_FIELDS, type ComicInfoField, type ComicMetadata } from './comic';

function decodeXmlText(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function splitValues(field: ComicInfoField, value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (!MULTI_VALUE_FIELDS.has(field)) return [trimmed];
  return trimmed
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseWithDom(xml: string): ComicMetadata | null {
  if (typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) return null;
  const metadata: ComicMetadata = {};
  for (const field of COMIC_INFO_FIELDS) {
    const node = doc.querySelector(field);
    const value = node?.textContent?.trim();
    if (!value) continue;
    const values = splitValues(field, value);
    if (values.length > 0) metadata[field] = values;
  }
  return metadata;
}

function parseWithRegex(xml: string): ComicMetadata {
  const metadata: ComicMetadata = {};
  for (const field of COMIC_INFO_FIELDS) {
    const match = new RegExp(`<${field}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${field}>`, 'i').exec(xml);
    if (!match?.[1]) continue;
    const values = splitValues(field, decodeXmlText(match[1]));
    if (values.length > 0) metadata[field] = values;
  }
  return metadata;
}

export function parseComicInfoXml(xml: string): ComicMetadata {
  return parseWithDom(xml) ?? parseWithRegex(xml);
}
