import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  intent: { handlers: vi.fn(), onChanged: vi.fn(), open: vi.fn() },
}));

vi.mock('@napplet/sdk', () => sdk);

import {
  availableArchetypes,
  COMPOSER_OPEN_CONVENTION,
  loadAvailableArchetypes,
  NOTE_OPEN_CONVENTION,
  openComposerIntent,
  openNoteIntent,
  openProfileIntent,
  PROFILE_OPEN_CONVENTION,
} from './intent-client';

beforeEach(() => {
  sdk.intent.handlers.mockReset();
  sdk.intent.open.mockReset();
  Object.defineProperty(window, 'napplet', {
    configurable: true,
    value: { intent: {} },
  });
});

describe('intent archetype availability', () => {
  it('keeps only available archetypes', () => {
    const result = availableArchetypes([
      { archetype: 'profile', available: true, candidates: [], hasDefault: true },
      { archetype: 'note', available: false, candidates: [], hasDefault: false },
    ]);
    expect([...result]).toEqual(['profile']);
  });

  it('loads the installed archetype catalog through NAP-INTENT', async () => {
    sdk.intent.handlers.mockResolvedValue([
      { archetype: 'note', available: true, candidates: [], hasDefault: true },
    ]);
    await expect(loadAvailableArchetypes()).resolves.toEqual(new Set(['note']));
  });
});

describe('intent dispatch', () => {
  beforeEach(() => {
    sdk.intent.open.mockResolvedValue({ ok: true, action: 'open', handled: true });
  });

  it('opens the note archetype using the note convention', async () => {
    const payload = { target: { type: 'event' as const, id: 'a'.repeat(64) } };
    await expect(openNoteIntent(payload)).resolves.toBe(true);
    expect(sdk.intent.open).toHaveBeenCalledWith('note', payload, {
      convention: NOTE_OPEN_CONVENTION,
      behavior: { focus: true, reuse: true },
    });
  });

  it('opens profile and composer archetypes with their conventions', async () => {
    await openProfileIntent('a'.repeat(64));
    await openComposerIntent({ intent: 'reply' });
    expect(sdk.intent.open).toHaveBeenNthCalledWith(
      1,
      'profile',
      { pubkey: 'a'.repeat(64) },
      { convention: PROFILE_OPEN_CONVENTION, behavior: { focus: true, reuse: true } },
    );
    expect(sdk.intent.open).toHaveBeenNthCalledWith(
      2,
      'composer',
      { intent: 'reply' },
      { convention: COMPOSER_OPEN_CONVENTION, behavior: { focus: true, reuse: true } },
    );
  });
});
