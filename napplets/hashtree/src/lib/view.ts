/** View-model types shared between the app shell and its components. */

import type { PreviewKind } from './mime.js';

export type SortKey = 'name' | 'size' | 'kind';

export interface PreviewState {
  /** The hash this preview belongs to, so a stale result can be discarded. */
  readonly hash: string;
  readonly kind: PreviewKind;
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly url: string | null;
  readonly text: string | null;
  /** True when only the head of a large text file was fetched. */
  readonly truncated: boolean;
  readonly error: string | null;
  readonly loaded: number;
  readonly total: number;
}
