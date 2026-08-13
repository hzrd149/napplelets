/**
 * The four ways a file leaves this napplet.
 *
 * The one that does not exist: handing the shell a `blob:` object URL. The
 * napplet runs in an `allow-scripts`-only srcdoc iframe with an opaque origin,
 * so `URL.createObjectURL` produces a URL only this document can resolve.
 * Object URLs therefore stay inside the preview pane, and NAP-LINK is given the
 * real `https://<server>/<hash>` URL — which only exists when the file is a
 * single unencrypted blob.
 */

import { fs, intent, link, media } from '@napplet/sdk';
import type { MediaAction, MediaMetadata } from '@napplet/sdk';
import { extensionOf, mimeForName } from './mime.js';
import { hasMethod } from './nap.js';
import { LINK_BLOB } from './manifest.js';
import type { TreeTarget } from './tree.js';

export type ActionOutcome = { ok: true; detail?: string } | { ok: false; error: string };

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * A file has a plain Blossom URL only when it is stored as one unencrypted blob.
 * A chunked file has no single URL, and an encrypted one would hand the server's
 * ciphertext to the browser, which cannot decrypt it.
 */
export function directBlobUrl(
  target: TreeTarget,
  servers: readonly string[],
): string | null {
  if (target.type !== LINK_BLOB || target.key !== null) return null;
  const server = servers[0];
  if (server === undefined) return null;
  const extension = target.name === null ? null : extensionOf(target.name);
  return extension === null
    ? `${server}/${target.hash}`
    : `${server}/${target.hash}.${extension}`;
}

/** Why the "open in browser" action is unavailable, phrased for the user. */
export function directBlobUrlBlocker(target: TreeTarget): string | null {
  if (target.key !== null) {
    return 'This file is encrypted, so a browser tab would only receive ciphertext.';
  }
  if (target.type !== LINK_BLOB) {
    return 'This file is split across chunks, so it has no single Blossom URL.';
  }
  return null;
}

export async function openInBrowser(url: string, label?: string): Promise<ActionOutcome> {
  if (!hasMethod('link', 'open')) {
    return { ok: false, error: 'This shell does not provide NAP-LINK.' };
  }
  try {
    const result = await link.open(url, label === undefined ? {} : { label });
    return result.status === 'opened'
      ? { ok: true }
      : { ok: false, error: 'The shell declined to open the link.' };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

/** RFC 4648 base64, which is what NAP-FS writes expect. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000; // chunked so a large file does not blow the argument limit
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + step));
  }
  return btoa(binary);
}

/**
 * Save assembled bytes to disk through the shell's picker.
 *
 * This is the export path that works for chunked and encrypted files, since the
 * bytes are already decrypted and concatenated in memory.
 */
export async function saveToDisk(
  bytes: Uint8Array,
  suggestedName: string,
): Promise<ActionOutcome> {
  if (!hasMethod('fs', 'pickSaveFile') || !hasMethod('fs', 'write')) {
    return { ok: false, error: 'This shell does not provide NAP-FS, so files cannot be saved.' };
  }
  try {
    const limits = hasMethod('fs', 'info') ? (await fs.info()).limits : null;
    if (limits !== null && bytes.length > limits.maxWriteBytes) {
      return {
        ok: false,
        error: `This shell caps writes at ${limits.maxWriteBytes} bytes; this file is ${bytes.length}.`,
      };
    }

    const picked = await fs.pickSaveFile({
      suggestedName,
      description: `Save ${suggestedName} from the hashtree`,
    });
    const entry = picked.entries[0];
    if (entry === undefined) return { ok: false, error: 'No destination was chosen.' };

    const result = await fs.write(entry.path, bytesToBase64(bytes));
    return { ok: true, detail: `Wrote ${result.bytesWritten} bytes to ${entry.path}.` };
  } catch (error) {
    // A cancelled picker is an error in NAP-FS, not an empty success.
    return { ok: false, error: describe(error) };
  }
}

export interface MediaSessionHandle {
  update(state: 'playing' | 'paused' | 'stopped' | 'buffering', position?: number): void;
  close(): void;
}

/**
 * Register a media session for an audio/video preview.
 *
 * NAP-MEDIA is session control, not playback: the element in the preview pane
 * does the playing, and this mirrors its state so the shell (and the OS media
 * keys behind it) can drive it. `owner: 'napplet'` says exactly that.
 */
export function startMediaSession(
  element: HTMLMediaElement,
  metadata: MediaMetadata,
): MediaSessionHandle | null {
  if (!hasMethod('media', 'createSession')) return null;

  const capabilities: MediaAction[] = ['play', 'pause', 'stop', 'seek'];
  let sessionId: string | null = null;
  let closed = false;
  let unsubscribe: (() => void) | null = null;

  void (async () => {
    try {
      const result = await media.createSession({
        owner: 'napplet',
        metadata,
        capabilities,
      });
      if (closed || result.sessionId === undefined) return;
      sessionId = result.sessionId;

      const subscription = media.onCommand(sessionId, (action, value) => {
        switch (action) {
          case 'play':
            void element.play().catch(() => undefined);
            break;
          case 'pause':
            element.pause();
            break;
          case 'stop':
            element.pause();
            element.currentTime = 0;
            break;
          case 'seek':
            if (typeof value === 'number') element.currentTime = value;
            break;
          case 'volume':
            if (typeof value === 'number') element.volume = Math.min(1, Math.max(0, value));
            break;
          default:
            break;
        }
      });
      unsubscribe = () => subscription.close();
    } catch {
      // A shell that declines the session just means no transport controls.
    }
  })();

  return {
    update(status, position) {
      if (sessionId === null || closed) return;
      try {
        media.reportState(sessionId, {
          status,
          ...(position === undefined ? {} : { position }),
          ...(Number.isFinite(element.duration) ? { duration: element.duration } : {}),
        });
      } catch {
        // Ignore: state reporting is advisory.
      }
    },
    close() {
      closed = true;
      unsubscribe?.();
      if (sessionId === null) return;
      try {
        media.destroySession(sessionId);
      } catch {
        // Ignore.
      }
      sessionId = null;
    },
  };
}

export function mediaMetadataFor(name: string, treeLabel: string): MediaMetadata {
  const mime = mimeForName(name);
  return {
    title: name,
    album: treeLabel,
    mediaType: mime.startsWith('video/') ? 'video' : 'audio',
  };
}

/**
 * Offer the file to another napplet. Availability is probed first so the UI can
 * hide an action no installed napplet can service.
 */
export async function intentAvailableFor(archetype: string): Promise<boolean> {
  if (!hasMethod('intent', 'available')) return false;
  try {
    return (await intent.available(archetype)).available;
  } catch {
    return false;
  }
}

export async function handOff(
  archetype: string,
  convention: string,
  payload: unknown,
): Promise<ActionOutcome> {
  if (!hasMethod('intent', 'open')) {
    return { ok: false, error: 'This shell does not provide NAP-INTENT.' };
  }
  try {
    const result = await intent.open(archetype, payload, {
      convention,
      behavior: { focus: true, reuse: true },
    });
    return result.ok && result.handled
      ? { ok: true }
      : { ok: false, error: result.error ?? 'No napplet handled the request.' };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

/**
 * Copy text, falling back to a selection the user can copy by hand.
 *
 * The clipboard API needs a permission this sandbox often will not grant, so a
 * failure here is expected rather than exceptional.
 */
export async function copyText(value: string): Promise<ActionOutcome> {
  try {
    await navigator.clipboard.writeText(value);
    return { ok: true };
  } catch {
    return { ok: false, error: 'The shell blocked clipboard access — select the text to copy it.' };
  }
}
