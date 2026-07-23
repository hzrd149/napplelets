import { describe, expect, it } from 'vitest';
import { normalizeBooleanLike, normalizeIssueNumber, normalizeTextValue } from './normalization';

describe('normalization', () => {
  it('normalizes text-like ComicInfo values', () => {
    expect(normalizeTextValue('DC Comics')).toBe('dc-comics');
    expect(normalizeTextValue('Batman / Superman')).toBe('batman-superman');
    expect(normalizeTextValue("Tom King’s & Co.")).toBe('tom-kings-and-co');
  });

  it('normalizes issue numbers', () => {
    expect(normalizeIssueNumber('001')).toBe('1');
    expect(normalizeIssueNumber('1.BEY')).toBe('1-bey');
    expect(normalizeIssueNumber('0.5')).toBe('0-5');
  });

  it('normalizes boolean-like values', () => {
    expect(normalizeBooleanLike('YesAndRightToLeft')).toBe('yes-and-right-to-left');
    expect(normalizeBooleanLike('false')).toBe('no');
  });
});
