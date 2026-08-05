import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VIEW_STATE,
  isTabId,
  parseViewState,
  resolveSkin,
  serializeViewState,
} from './view-state';

describe('parseViewState', () => {
  it('round-trips what it wrote', () => {
    const state = { skin: '98' as const, tab: 'icons' as const };
    expect(parseViewState(serializeViewState(state))).toEqual(state);
  });

  it('treats nothing stored as no preference', () => {
    expect(parseViewState(null)).toEqual(DEFAULT_VIEW_STATE);
  });

  it.each([
    ['malformed JSON', 'not json'],
    ['a JSON scalar', '"xp"'],
    ['a JSON array', '[]'],
    ['null', 'null'],
  ])('degrades %s to the default rather than throwing', (_label, raw) => {
    expect(parseViewState(raw)).toEqual(DEFAULT_VIEW_STATE);
  });

  it('drops a skin an older or newer build wrote', () => {
    expect(parseViewState('{"skin":"vista","tab":"theme"}').skin).toBeNull();
  });

  it('drops a tab that no longer exists', () => {
    expect(parseViewState('{"skin":"gui","tab":"relays"}')).toEqual({ skin: 'gui', tab: 'theme' });
  });

  it('keeps the half it understands', () => {
    expect(parseViewState('{"tab":"windows"}')).toEqual({ skin: null, tab: 'windows' });
  });
});

describe('isTabId', () => {
  it('accepts the five panels and nothing else', () => {
    expect(isTabId('dialogs')).toBe(true);
    expect(isTabId('Dialogs')).toBe(false);
    expect(isTabId(undefined)).toBe(false);
  });
});

describe('resolveSkin', () => {
  it('lets the reader’s choice beat the placement default', () => {
    expect(resolveSkin('gui', 'xp')).toBe('gui');
  });

  it('falls back to the placement default when the reader has not chosen', () => {
    expect(resolveSkin(null, '98')).toBe('98');
  });

  it('falls back to XP when config sent nothing usable', () => {
    expect(resolveSkin(null, undefined)).toBe('xp');
    expect(resolveSkin(null, 'vista')).toBe('xp');
    expect(resolveSkin(null, 7)).toBe('xp');
  });
});
