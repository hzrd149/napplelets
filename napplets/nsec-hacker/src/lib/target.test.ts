/**
 * Shell-boundary tests. The reference conformance shell injects a hollow `{}`
 * for declared domains, so "identity is present" and "identity is usable" are
 * different questions -- these cover absent, hollow, and populated shells.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveTarget, subscribeTarget } from './target.js';

const TARGET = 'ab'.repeat(32);
const shell = globalThis as unknown as { napplet?: unknown };

afterEach(() => {
  delete shell.napplet;
});

describe('resolveTarget', () => {
  it('is null with no shell at all', async () => {
    await expect(resolveTarget()).resolves.toBeNull();
  });

  it('is null for a hollow identity domain', async () => {
    shell.napplet = { identity: {} };
    await expect(resolveTarget()).resolves.toBeNull();
  });

  it('returns the hex pubkey from a populated shell', async () => {
    shell.napplet = { identity: { getPublicKey: async () => TARGET } };
    await expect(resolveTarget()).resolves.toBe(TARGET);
  });

  it('lowercases what the shell hands back', async () => {
    shell.napplet = { identity: { getPublicKey: async () => TARGET.toUpperCase() } };
    await expect(resolveTarget()).resolves.toBe(TARGET);
  });

  it('is null when the user is signed out', async () => {
    shell.napplet = { identity: { getPublicKey: async () => '' } };
    await expect(resolveTarget()).resolves.toBeNull();
  });

  it('is null for a malformed pubkey rather than passing it through', async () => {
    shell.napplet = { identity: { getPublicKey: async () => 'npub1notahexkey' } };
    await expect(resolveTarget()).resolves.toBeNull();
  });

  it('is null when the shell call throws', async () => {
    shell.napplet = {
      identity: {
        getPublicKey: async () => {
          throw new Error('denied');
        },
      },
    };
    await expect(resolveTarget()).resolves.toBeNull();
  });
});

describe('subscribeTarget', () => {
  it('delivers an immediate first result', async () => {
    shell.napplet = { identity: { getPublicKey: async () => TARGET } };
    const seen: (string | null)[] = [];
    const stop = subscribeTarget((t) => seen.push(t));
    await vi.waitFor(() => expect(seen).toEqual([TARGET]));
    stop();
  });

  it('re-reads the target when the identity changes', async () => {
    let current = TARGET;
    const listeners: (() => void)[] = [];
    shell.napplet = {
      identity: {
        getPublicKey: async () => current,
        onChanged: (cb: () => void) => {
          listeners.push(cb);
          return { close: () => undefined };
        },
      },
    };

    const seen: (string | null)[] = [];
    const stop = subscribeTarget((t) => seen.push(t));
    await vi.waitFor(() => expect(seen).toHaveLength(1));

    current = '';
    listeners.forEach((fire) => fire());
    await vi.waitFor(() => expect(seen).toEqual([TARGET, null]));
    stop();
  });

  it('closes the shell subscription on teardown', async () => {
    const close = vi.fn();
    shell.napplet = {
      identity: {
        getPublicKey: async () => TARGET,
        onChanged: () => ({ close }),
      },
    };
    subscribeTarget(() => undefined)();
    expect(close).toHaveBeenCalledOnce();
  });

  it('drops results that arrive after teardown', async () => {
    shell.napplet = { identity: { getPublicKey: async () => TARGET } };
    const seen: (string | null)[] = [];
    subscribeTarget((t) => seen.push(t))();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(seen).toEqual([]);
  });
});
