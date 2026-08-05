/**
 * The half of a NAP-THEME payload that is bytes rather than colours.
 *
 * `fonts.body`, `fonts.title` and `background` are `{ name, url }` / `{ url,
 * mode, mime }` -- URLs the shell expects the napplet to render. A napplet has
 * no network: `<link href>`, `@font-face { src: url(https://…) }` and
 * `<img src>` all have nothing to fetch from an opaque origin, and `fetch` is
 * off the table entirely. NAP-RESOURCE is the sanctioned way to turn one of
 * those URLs into bytes, so it is what makes the optional half of NAP-THEME
 * work at all.
 *
 * This lives in the napplet rather than in `@napplelets/theme-xp` deliberately:
 * the theme package needs only the `theme` domain, and folding this in would
 * make every consumer declare `resource` too. If it earns its way upstream it
 * lifts out whole.
 *
 * Every path degrades. No resource domain, a policy refusal, a font that will
 * not parse -- each one reports itself and leaves the previous look standing,
 * because a themed napplet that renders is better than a correct one that does
 * not.
 */
import { resource } from '@napplet/sdk';
import type { Theme } from '@napplet/sdk';

import { explainResourceFailure, resourceErrorCode } from './resource-errors';
import { hasDomain } from './shell';

export type AssetState =
  /** The payload does not carry this field. Optional means optional. */
  | { status: 'absent' }
  /** The payload carries it, but this shell injected no resource domain. */
  | { status: 'no-resource' }
  | { status: 'loading' }
  | { status: 'ready'; detail: string }
  | { status: 'failed'; detail: string };

export type ThemeAssets = {
  bodyFont: AssetState;
  titleFont: AssetState;
  background: AssetState & { objectUrl?: string };
};

const IDLE: ThemeAssets = {
  bodyFont: { status: 'absent' },
  titleFont: { status: 'absent' },
  background: { status: 'absent' },
};

/**
 * Every resource call goes through here, and every one of them is inside an
 * `async` function on purpose: a hollow `resource` object throws synchronously
 * on `bytes(...)`, and inside async that surfaces as a rejection the normal
 * failure path already handles, instead of an exception at the call site.
 */
async function fetchBytes(url: string, signal: AbortSignal): Promise<Blob> {
  return resource.bytes(url, { signal });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('decode-failed'));
    reader.readAsDataURL(blob);
  });
}

function formatBytes(size: number): string {
  return size >= 1024 ? `${Math.round(size / 1024)} kB` : `${size} B`;
}

/**
 * Loads a shell font and registers it under the family name the shell gave.
 *
 * The bytes go in as a `data:` URL rather than an object URL. Both are
 * same-document references, but `FontFace` resolves its `src` as CSS, and a
 * blob URL in an opaque-origin document is exactly the kind of thing a shell's
 * `font-src` policy declines; a `data:` URL sidesteps the question. Fonts are
 * small enough for the copy not to matter.
 */
async function loadFont(name: string, url: string, signal: AbortSignal): Promise<string> {
  const blob = await fetchBytes(url, signal);
  if (signal.aborted) throw new DOMException('superseded', 'AbortError');
  const dataUrl = await blobToDataUrl(blob);

  // Not every environment has the CSS Font Loading API; without it the family
  // name still resolves if the host happens to have the font installed.
  if (typeof FontFace === 'undefined') return `${formatBytes(blob.size)}, not registered`;

  const face = new FontFace(name, `url(${dataUrl})`);
  await face.load();
  if (signal.aborted) throw new DOMException('superseded', 'AbortError');
  document.fonts.add(face);
  return `${formatBytes(blob.size)}, registered as “${name}”`;
}

/**
 * Fetches and applies the byte-backed parts of a theme.
 *
 * Every apply supersedes the last: a `theme.changed` push that arrives while an
 * earlier font is still in flight aborts it, so the window can never end up
 * wearing half of one theme and half of another.
 */
export function createThemeAssets(onChange: (assets: ThemeAssets) => void): {
  apply(theme: Theme | null): void;
  dispose(): void;
} {
  let assets: ThemeAssets = { ...IDLE };
  let inflight: AbortController | null = null;
  let objectUrl: string | null = null;

  const publish = (patch: Partial<ThemeAssets>): void => {
    assets = { ...assets, ...patch };
    onChange(assets);
  };

  const releaseObjectUrl = (): void => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  };

  function apply(theme: Theme | null): void {
    inflight?.abort();
    const controller = new AbortController();
    inflight = controller;
    const { signal } = controller;

    const bodyFont = theme?.fonts?.body;
    const titleFont = theme?.fonts?.title;
    const background = theme?.background;
    const wanted = [bodyFont, titleFont, background].some((field) => Boolean(field?.url));
    const canFetch = hasDomain('resource');

    releaseObjectUrl();
    publish({
      bodyFont: initialState(Boolean(bodyFont?.url), canFetch),
      titleFont: initialState(Boolean(titleFont?.url), canFetch),
      background: initialState(Boolean(background?.url), canFetch),
    });

    if (!wanted || !canFetch) return;

    if (bodyFont?.url && bodyFont.name) {
      void loadFont(bodyFont.name, bodyFont.url, signal)
        .then((detail) => {
          if (!signal.aborted) publish({ bodyFont: { status: 'ready', detail } });
        })
        .catch((error: unknown) => {
          if (!signal.aborted) publish({ bodyFont: failure(error) });
        });
    }

    if (titleFont?.url && titleFont.name) {
      void loadFont(titleFont.name, titleFont.url, signal)
        .then((detail) => {
          if (!signal.aborted) publish({ titleFont: { status: 'ready', detail } });
        })
        .catch((error: unknown) => {
          if (!signal.aborted) publish({ titleFont: failure(error) });
        });
    }

    if (background?.url) {
      void fetchBytes(background.url, signal)
        .then((blob) => {
          if (signal.aborted) return;
          releaseObjectUrl();
          objectUrl = URL.createObjectURL(blob);
          publish({
            background: {
              status: 'ready',
              detail: `${formatBytes(blob.size)}, ${blob.type || background.mime || 'unknown type'}`,
              objectUrl,
            },
          });
        })
        .catch((error: unknown) => {
          if (!signal.aborted) publish({ background: failure(error) });
        });
    }
  }

  return {
    apply,
    dispose() {
      inflight?.abort();
      inflight = null;
      releaseObjectUrl();
    },
  };
}

function initialState(present: boolean, canFetch: boolean): AssetState {
  if (!present) return { status: 'absent' };
  return canFetch ? { status: 'loading' } : { status: 'no-resource' };
}

function failure(error: unknown): AssetState {
  // An abort is this napplet superseding its own request, not a shell failure.
  if (error instanceof DOMException && error.name === 'AbortError') return { status: 'loading' };
  const code = resourceErrorCode(error);
  return { status: 'failed', detail: `${code} — ${explainResourceFailure(code)}` };
}

export function describeAsset(state: AssetState): { value: string; tone: 'ok' | 'muted' | 'warn' } {
  switch (state.status) {
    case 'absent':
      return { value: 'not sent — optional', tone: 'muted' };
    case 'no-resource':
      return {
        value: 'sent, but this shell injected no resource domain — the bytes cannot be fetched',
        tone: 'warn',
      };
    case 'loading':
      return { value: 'fetching through resource.bytes…', tone: 'muted' };
    case 'ready':
      return { value: state.detail, tone: 'ok' };
    case 'failed':
      return { value: state.detail, tone: 'warn' };
  }
}
