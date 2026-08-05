/**
 * The reader's own view state: which tab is open, which skin they picked.
 *
 * This is deliberately separate from config. The placement decides which skin
 * the showcase *opens* with; whoever is looking at it may then flip skins to
 * compare them, and that is a preference of theirs, not a change to the
 * placement. So it goes to NAP-STORAGE, and it takes precedence for this
 * reader only.
 *
 * Parsing is total: storage is shared with older builds of this napplet, so
 * anything unrecognised degrades to "no preference" rather than throwing.
 */
import { isSkinName } from './skins';
import type { SkinName } from './skins';

export const TAB_IDS = ['theme', 'controls', 'windows', 'dialogs', 'icons'] as const;

export type TabId = (typeof TAB_IDS)[number];

export type ViewState = {
  /** null means "no preference yet" -- config's default still applies. */
  skin: SkinName | null;
  tab: TabId;
};

export const STORAGE_KEY = 'view-state';

export const DEFAULT_VIEW_STATE: ViewState = { skin: null, tab: 'theme' };

export function isTabId(value: unknown): value is TabId {
  return typeof value === 'string' && (TAB_IDS as readonly string[]).includes(value);
}

export function parseViewState(raw: string | null): ViewState {
  if (!raw) return { ...DEFAULT_VIEW_STATE };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_VIEW_STATE };
  }
  if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_VIEW_STATE };

  const { skin, tab } = parsed as { skin?: unknown; tab?: unknown };
  return {
    skin: isSkinName(skin) ? skin : null,
    tab: isTabId(tab) ? tab : DEFAULT_VIEW_STATE.tab,
  };
}

export function serializeViewState(state: ViewState): string {
  return JSON.stringify(state);
}

/**
 * The reader's pick wins; otherwise the placement's; otherwise the XP default,
 * which is also what the schema declares.
 */
export function resolveSkin(stored: SkinName | null, configured: unknown): SkinName {
  if (stored) return stored;
  if (isSkinName(configured)) return configured;
  return 'xp';
}
