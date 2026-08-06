import { intent, type IntentAvailability, type Subscription } from '@napplet/sdk';
import type { NoteViewerOpenPayload } from './note-viewer-protocol';
import { isNapDomainPresent } from './runtime-domain';

export const NOTE_ARCHETYPE = 'note' as const;
export const PROFILE_ARCHETYPE = 'profile' as const;
export const COMPOSER_ARCHETYPE = 'composer' as const;

export type GMArchetype =
  typeof NOTE_ARCHETYPE | typeof PROFILE_ARCHETYPE | typeof COMPOSER_ARCHETYPE;

export const NOTE_OPEN_CONVENTION = 'napplet:note/open' as const;
export const PROFILE_OPEN_CONVENTION = 'napplet:profile/open' as const;
export const COMPOSER_OPEN_CONVENTION = 'napplet:composer/open' as const;

export function availableArchetypes(handlers: IntentAvailability[]): Set<string> {
  return new Set(
    handlers.filter((handler) => handler.available).map((handler) => handler.archetype),
  );
}

export async function loadAvailableArchetypes(): Promise<Set<string>> {
  if (!isNapDomainPresent('intent')) return new Set();
  try {
    return availableArchetypes(await intent.handlers());
  } catch {
    return new Set();
  }
}

export function subscribeArchetypeAvailability(
  onChanged: (availability: IntentAvailability) => void,
): Subscription | null {
  if (!isNapDomainPresent('intent')) return null;
  try {
    return intent.onChanged(onChanged);
  } catch {
    return null;
  }
}

async function openIntent(
  archetype: GMArchetype,
  payload: unknown,
  convention: string,
): Promise<boolean> {
  if (!isNapDomainPresent('intent')) return false;
  try {
    const result = await intent.open(archetype, payload, {
      convention,
      behavior: { focus: true, reuse: true },
    });
    return result.ok && result.handled;
  } catch {
    return false;
  }
}

export function openNoteIntent(payload: NoteViewerOpenPayload): Promise<boolean> {
  return openIntent(NOTE_ARCHETYPE, payload, NOTE_OPEN_CONVENTION);
}

export function openProfileIntent(pubkey: string): Promise<boolean> {
  return openIntent(PROFILE_ARCHETYPE, { pubkey }, PROFILE_OPEN_CONVENTION);
}

export function openComposerIntent(payload: unknown): Promise<boolean> {
  return openIntent(COMPOSER_ARCHETYPE, payload, COMPOSER_OPEN_CONVENTION);
}
