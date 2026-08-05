import { describe, expect, it } from 'vitest';

import {
  describeColors,
  describePalette,
  describePayload,
  describeSource,
  hasUsableColors,
  summarize,
} from './theme-report';
import type { ThemeSource } from './theme-report';
import type { Theme } from '@napplet/sdk';

const LIGHT: Theme = {
  colors: { background: '#ece9d8', text: '#222222', primary: '#0050ee' },
};

const DARK: Theme = {
  colors: { background: '#101211', text: '#f4f0df', primary: '#d8c36a' },
};

const FULL: Theme = {
  colors: LIGHT.colors,
  fonts: {
    body: { name: 'Tahoma', url: 'https://example.com/tahoma.woff2' },
    title: { name: 'Trebuchet MS', url: 'https://example.com/trebuchet.woff2' },
  },
  background: { url: 'https://example.com/bliss.jpg', mode: 'cover', mime: 'image/jpeg' },
  title: 'Luna',
};

const GET: ThemeSource = { kind: 'get' };

describe('hasUsableColors', () => {
  it('accepts three #rrggbb colours', () => {
    expect(hasUsableColors(LIGHT)).toBe(true);
  });

  it('rejects a null payload', () => {
    expect(hasUsableColors(null)).toBe(false);
  });

  it.each([
    ['a named colour', 'rebeccapurple'],
    ['an rgb() function', 'rgb(1, 2, 3)'],
    ['shorthand hex', '#fff'],
    ['hex with alpha', '#ece9d8ff'],
    ['an empty string', ''],
  ])('rejects %s, because the XP token mapping cannot use it', (_label, primary) => {
    expect(hasUsableColors({ colors: { ...LIGHT.colors, primary } })).toBe(false);
  });

  it('rejects a non-string the shell should not have sent', () => {
    const rogue = { colors: { ...LIGHT.colors, text: 42 } } as unknown as Theme;
    expect(hasUsableColors(rogue)).toBe(false);
  });
});

describe('describeColors', () => {
  it('reports each colour and whether it is usable', () => {
    expect(describeColors(LIGHT)).toEqual([
      { name: 'background', value: '#ece9d8', valid: true },
      { name: 'text', value: '#222222', valid: true },
      { name: 'primary', value: '#0050ee', valid: true },
    ]);
  });

  it('keeps an unusable value visible rather than hiding it', () => {
    const swatches = describeColors({ colors: { ...LIGHT.colors, primary: 'papayawhip' } });
    expect(swatches[2]).toEqual({ name: 'primary', value: 'papayawhip', valid: false });
  });

  it('renders a dash for a missing payload', () => {
    expect(describeColors(null).map((swatch) => swatch.value)).toEqual(['—', '—', '—']);
  });
});

describe('describePayload', () => {
  it('is empty when nothing has arrived', () => {
    expect(describePayload(null)).toEqual([]);
  });

  it('reports every optional field the shell left out as optional, not broken', () => {
    const tones = Object.fromEntries(describePayload(LIGHT).map((f) => [f.label, f.tone]));
    expect(tones).toEqual({
      title: 'muted',
      colors: 'ok',
      'fonts.body': 'muted',
      'fonts.title': 'muted',
      background: 'muted',
    });
  });

  it('reports every field of a full payload', () => {
    const facts = Object.fromEntries(describePayload(FULL).map((f) => [f.label, f.value]));
    expect(facts.title).toBe('Luna');
    expect(facts['fonts.body']).toBe('Tahoma — https://example.com/tahoma.woff2');
    expect(facts['fonts.title']).toBe('Trebuchet MS — https://example.com/trebuchet.woff2');
    expect(facts.background).toBe('image/jpeg, mode cover');
  });

  it('flags colours it cannot map as a warning', () => {
    const colors = describePayload({ colors: { ...LIGHT.colors, text: 'black' } }).find(
      (fact) => fact.label === 'colors',
    );
    expect(colors?.tone).toBe('warn');
  });

  it('does not claim a font is present when only the name is', () => {
    const theme = { colors: LIGHT.colors, fonts: { body: { name: '', url: '' } } } as Theme;
    const body = describePayload(theme).find((fact) => fact.label === 'fonts.body');
    expect(body?.tone).toBe('muted');
  });
});

describe('describePalette', () => {
  it('explains that no theme domain means authentic Luna from CSS', () => {
    expect(describePalette(null, { kind: 'unavailable' })).toMatch(/no fallback palette/i);
  });

  it('explains that unusable colours are dropped whole, not half-applied', () => {
    const theme = { colors: { ...LIGHT.colors, primary: 'blue' } };
    expect(describePalette(theme, GET)).toMatch(/authentic Luna/i);
  });

  it('separates dark from light, because the dark path re-derives more', () => {
    expect(describePalette(DARK, GET)).toMatch(/^Dark theme/);
    expect(describePalette(LIGHT, GET)).toMatch(/^Light theme/);
  });

  it('leads with "not following" over anything the payload says', () => {
    // The payload is perfectly good here; it is just not on the window, and
    // describing its dark palette would explain a window that is not dark.
    expect(describePalette(DARK, GET, false)).toMatch(/^Not following/);
    expect(describePalette(null, { kind: 'unavailable' }, false)).toMatch(/^Not following/);
  });
});

describe('describeSource', () => {
  it('counts pushes so a live theme change is visible', () => {
    expect(describeSource({ kind: 'changed', count: 1 }).value).toContain('1 push ');
    expect(describeSource({ kind: 'changed', count: 3 }).value).toContain('3 pushes');
  });

  it('marks a failed get as a warning and keeps the reason', () => {
    const fact = describeSource({ kind: 'error', message: 'timed out' });
    expect(fact.tone).toBe('warn');
    expect(fact.value).toContain('timed out');
  });

  it('does not treat an absent domain as an error', () => {
    expect(describeSource({ kind: 'unavailable' }).tone).toBe('muted');
  });
});

describe('summarize', () => {
  it('prefers the shell’s own name for its theme', () => {
    expect(summarize(FULL, GET)).toBe('Theme: Luna');
  });

  it('falls back to the primary colour when the shell sent no name', () => {
    expect(summarize(LIGHT, GET)).toBe('Theme: #0050ee');
  });

  it('says so plainly when there is no theme domain', () => {
    expect(summarize(null, { kind: 'unavailable' })).toBe('Theme: none (Luna)');
  });

  it('reports Luna when a live theme is deliberately not being followed', () => {
    expect(summarize(FULL, GET, false)).toBe('Theme: not followed (Luna)');
  });
});
