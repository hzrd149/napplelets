const NON_ALNUM_RUN = /[^\p{L}\p{N}]+/gu;

export function normalizeTextValue(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase()
    .replaceAll('&', 'and')
    .replaceAll("'", '')
    .replaceAll('’', '')
    .replace(NON_ALNUM_RUN, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function normalizeIssueNumber(value: string): string {
  const folded = value.normalize('NFKC').trim().toLocaleLowerCase();
  const withoutLeadingZeroes = /^\d+$/.test(folded) ? String(Number(folded)) : folded;
  return withoutLeadingZeroes.replace(NON_ALNUM_RUN, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

export function normalizeLanguage(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase();
}

export function normalizeBooleanLike(value: string): string {
  const normalized = normalizeTextValue(value);
  if (normalized === 'yesandrighttoleft' || normalized === 'yes-and-right-to-left') return 'yes-and-right-to-left';
  if (normalized === 'true' || normalized === 'yes') return 'yes';
  if (normalized === 'false' || normalized === 'no') return 'no';
  if (normalized === 'unknown') return 'unknown';
  return normalized;
}

export function normalizeFieldValue(field: string, value: string): string {
  if (field === 'number') return normalizeIssueNumber(value);
  if (field === 'language') return normalizeLanguage(value);
  if (field === 'manga' || field === 'black-and-white') return normalizeBooleanLike(value);
  return normalizeTextValue(value);
}
