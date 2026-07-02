import { describe, it, expect } from 'vitest';
import { containsGM } from './gm-detection';

describe('containsGM', () => {
  it('matches a bare "GM"', () => {
    expect(containsGM('GM')).toBe(true);
    expect(containsGM('gm')).toBe(true);
    expect(containsGM('Gm everyone')).toBe(true);
  });

  it('matches "good morning" (case-insensitive, any inner whitespace)', () => {
    expect(containsGM('good morning')).toBe(true);
    expect(containsGM('Good Morning frens')).toBe(true);
    expect(containsGM('GOOD   MORNING')).toBe(true);
  });

  it('matches GM surrounded by punctuation', () => {
    expect(containsGM('gm!')).toBe(true);
    expect(containsGM('...gm...')).toBe(true);
    expect(containsGM('(gm)')).toBe(true);
    expect(containsGM('say "gm" back')).toBe(true);
    expect(containsGM('gm—frens')).toBe(true);
  });

  it('does not match letters embedded in a larger word', () => {
    expect(containsGM('magma')).toBe(false);
    expect(containsGM('imgmt')).toBe(false);
    expect(containsGM('agmark')).toBe(false);
    expect(containsGM('goodmorning')).toBe(false); // needs whitespace between words
  });

  it('does not match unrelated content', () => {
    expect(containsGM('hello world')).toBe(false);
    expect(containsGM('https://example.com/gmail')).toBe(false);
    expect(containsGM('')).toBe(false);
  });

  it('finds GM anywhere in a longer note', () => {
    expect(containsGM('what a beautiful day, gm to all of you')).toBe(true);
    expect(containsGM('first coffee then good morning thread')).toBe(true);
  });
});
