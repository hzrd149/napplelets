/**
 * Boots against the shell shape that actually broke this napplet once: domain
 * objects that are present but empty.
 *
 * The NAP conformance reference shell injects `napplet[domain] = {}` for every
 * domain a manifest declares, so `napplet.theme` is truthy while
 * `napplet.theme.get` is not a function. A presence check alone sails straight
 * into a TypeError at boot, which is why every call goes through `attempt`.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { $, boot, installDom, installShell, text } from './test/harness';

beforeAll(async () => {
  installDom();
  installShell({ hollowTheme: true, resourceError: 'blocked-by-policy: host not allowed' });
  await boot();
  await vi.waitFor(() => expect(text('theme-source')).toContain('not callable'));
});

describe('with a hollow theme domain', () => {
  it('boots rather than throwing', () => {
    expect($('root-window')).toBeTruthy();
  });

  it('says the domain is there but the method is not', () => {
    expect(text('theme-source')).toContain('theme.get is not callable');
  });

  it('falls back to authentic Luna and the plain title', () => {
    expect(text('window-title')).toBe('XP Theme Showcase');
    expect($('app').classList.contains('xs-has-wallpaper')).toBe(false);
  });

  it('still renders the gallery', () => {
    expect($('token-table').querySelectorAll('tr').length).toBeGreaterThan(30);
  });
});
