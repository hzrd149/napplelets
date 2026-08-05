/**
 * A fake shell, for booting the real napplet without a browser.
 *
 * `src/main.ts` runs its wiring at import time against the markup in
 * `index.html`, so the only honest way to test that wiring is to put the real
 * markup in the document, inject a `window.napplet`, and import the module.
 * That catches the whole class of bug a unit test on a helper cannot: an id
 * renamed in one file and not the other.
 *
 * Reading `index.html` off disk rather than restating it here is the point --
 * a test with its own copy of the markup passes forever.
 */
import { vi } from 'vitest';

// `?raw` rather than fs: under vitest the module graph is served over http, so
// `import.meta.url` is not a file URL and `readFileSync` has nothing to open.
import indexHtml from '../../index.html?raw';
import type { Theme } from '@napplet/sdk';

export const DARK_THEME: Theme = {
  colors: { background: '#101211', text: '#f4f0df', primary: '#d8c36a' },
  fonts: {
    body: { name: 'Tahoma', url: 'https://example.com/tahoma.woff2' },
    title: { name: 'Trebuchet MS', url: 'https://example.com/trebuchet.woff2' },
  },
  background: { url: 'https://example.com/bliss.jpg', mode: 'cover', mime: 'image/jpeg' },
  title: 'Luna Dark',
};

export const LIGHT_THEME: Theme = {
  colors: { background: '#ece9d8', text: '#222222', primary: '#0050ee' },
  title: 'Luna',
};

export type FakeShell = {
  /** Pushes a `theme.changed`, the way a shell does when the user switches theme. */
  pushTheme(theme: Theme): void;
  /** Every url `resource.bytes` was asked for, in order. */
  fetched: string[];
  /** Whatever the napplet last wrote to storage. */
  stored: Record<string, string>;
  openedSettings: number;
};

export type ShellOptions = {
  theme?: Theme;
  /** Present but hollow -- a domain object with no callable methods on it. */
  hollowTheme?: boolean;
  configValues?: Record<string, unknown>;
  /** Reject every resource fetch with this shim-style message. */
  resourceError?: string;
  omit?: readonly ('theme' | 'config' | 'storage' | 'resource')[];
  storedState?: string | null;
};

export function installDom(): void {
  document.documentElement.innerHTML = indexHtml
    .replace(/^[\s\S]*?<html[^>]*>/i, '')
    .replace(/<\/html>[\s\S]*$/i, '')
    // The module script is what the test is about to import by hand; leaving
    // the tag in would have jsdom try to fetch `/src/main.ts` as well.
    .replace(/<script[\s\S]*?<\/script>/gi, '');

  // jsdom implements neither, and the napplet uses both: one to report the
  // frame size, one to show a themed wallpaper.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  let objectUrls = 0;
  URL.createObjectURL = () => `blob:fake/${++objectUrls}`;
  URL.revokeObjectURL = () => undefined;
}

export function installShell(options: ShellOptions = {}): FakeShell {
  const omitted = new Set(options.omit ?? []);
  const shell: FakeShell = {
    pushTheme: () => undefined,
    fetched: [],
    stored: {},
    openedSettings: 0,
  };

  let onThemeChanged: ((theme: Theme) => void) | null = null;
  shell.pushTheme = (theme) => onThemeChanged?.(theme);

  const napplet: Record<string, unknown> = {};

  if (!omitted.has('theme')) {
    napplet.theme = options.hollowTheme
      ? {}
      : {
          get: () => Promise.resolve(options.theme ?? LIGHT_THEME),
          onChanged: (handler: (theme: Theme) => void) => {
            onThemeChanged = handler;
            return { close: () => undefined };
          },
        };
  }

  if (!omitted.has('config')) {
    napplet.config = {
      get: () => Promise.resolve(options.configValues ?? {}),
      subscribe: () => ({ close: () => undefined }),
      openSettings: () => {
        shell.openedSettings += 1;
      },
    };
  }

  if (!omitted.has('storage')) {
    napplet.storage = {
      getItem: (key: string) =>
        Promise.resolve(key === 'view-state' ? (options.storedState ?? null) : null),
      setItem: (key: string, value: string) => {
        shell.stored[key] = value;
        return Promise.resolve();
      },
    };
  }

  if (!omitted.has('resource')) {
    napplet.resource = {
      bytes: (url: string) => {
        shell.fetched.push(url);
        if (options.resourceError) return Promise.reject(new Error(options.resourceError));
        return Promise.resolve(new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' }));
      },
    };
  }

  vi.stubGlobal('napplet', napplet);
  return shell;
}

/** Boots the napplet. Import is dynamic because main.ts wires on import. */
export async function boot(): Promise<void> {
  await import('../main');
}

export const $ = (id: string): HTMLElement => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return element;
};

export const text = (id: string): string => $(id).textContent ?? '';
