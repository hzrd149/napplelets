import { describe, expect, it } from 'vitest';
import { describeDiff, diffNpub, NPUB_PREFIX } from './diff.js';

const A = `${NPUB_PREFIX}abcdef`;
const B = `${NPUB_PREFIX}abxdyf`;

describe('diffNpub', () => {
  it('splits off the shared npub1 prefix so it cannot flatter the score', () => {
    const diff = diffNpub(A, B);
    expect(diff.prefix).toBe(NPUB_PREFIX);
    expect(diff.total).toBe(6);
    expect(diff.guess).toHaveLength(6);
  });

  it('marks agreeing positions as hits', () => {
    const diff = diffNpub(A, B);
    expect(diff.guess.map((c) => c.hit)).toEqual([true, true, false, true, false, true]);
    expect(diff.hits).toBe(4);
  });

  it('reports the guess characters verbatim', () => {
    expect(
      diffNpub(A, B)
        .guess.map((c) => c.char)
        .join(''),
    ).toBe('abcdef');
  });

  it('marks the target side with the same alignment', () => {
    const diff = diffNpub(A, B);
    expect(diff.target.map((c) => c.char).join('')).toBe('abxdyf');
    expect(diff.target.map((c) => c.hit)).toEqual([true, true, false, true, false, true]);
  });

  it('scores an identical pair as a full match', () => {
    const diff = diffNpub(A, A);
    expect(diff.hits).toBe(diff.total);
    expect(diff.guess.every((c) => c.hit)).toBe(true);
  });

  it('scores a fully disjoint pair as zero', () => {
    const diff = diffNpub(`${NPUB_PREFIX}aaaa`, `${NPUB_PREFIX}bbbb`);
    expect(diff.hits).toBe(0);
  });

  it('keeps no shared prefix when an input is not an npub', () => {
    const diff = diffNpub('nsec1abc', `${NPUB_PREFIX}abc`);
    expect(diff.prefix).toBe('');
  });

  it('compares over the overlap and still shows surplus characters', () => {
    const diff = diffNpub(`${NPUB_PREFIX}abcdef`, `${NPUB_PREFIX}abc`);
    expect(diff.total).toBe(3);
    expect(diff.hits).toBe(3);
    // The three surplus guess characters are shown, and cannot count as hits.
    expect(diff.guess).toHaveLength(6);
    expect(diff.guess.slice(3).every((c) => c.hit)).toBe(false);
  });

  it('handles empty bodies without dividing by zero', () => {
    const diff = diffNpub(NPUB_PREFIX, NPUB_PREFIX);
    expect(diff.total).toBe(0);
    expect(diff.hits).toBe(0);
  });
});

describe('describeDiff', () => {
  it('summarises a partial match', () => {
    expect(describeDiff(diffNpub(A, B))).toBe('4 of 6 characters match');
  });

  it('calls out a total match', () => {
    expect(describeDiff(diffNpub(A, A))).toBe('all 6 characters match');
  });

  it('says so when there is nothing to compare', () => {
    expect(describeDiff(diffNpub(NPUB_PREFIX, NPUB_PREFIX))).toBe('nothing to compare');
  });
});
