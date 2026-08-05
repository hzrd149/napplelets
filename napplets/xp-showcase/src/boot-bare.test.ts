/**
 * Boots the same napplet against a shell that offers nothing.
 *
 * This is the case the NAP conformance runner puts every napplet in, and the
 * one theme-xp is designed around: no theme domain means authentic Luna from
 * CSS, not a half-applied palette and not a blank pane. Everything that does
 * not depend on the shell has to keep working.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { $, boot, installDom, installShell, text } from './test/harness';

beforeAll(async () => {
  installDom();
  installShell({ omit: ['theme', 'config', 'storage', 'resource'] });
  await boot();
  await vi.waitFor(() => expect(text('theme-source')).not.toBe('Waiting for the shell…'));
});

describe('with no shell domains at all', () => {
  it('boots', () => {
    expect($('root-window')).toBeTruthy();
  });

  it('says there is no theme domain instead of pretending there is', () => {
    expect(text('theme-source')).toContain('No theme domain');
    expect(text('status-theme')).toBe('Theme: none (Luna)');
  });

  it('explains why the palette is authentic Luna', () => {
    expect(text('theme-verdict')).toMatch(/no fallback palette/i);
  });

  it('keeps the plain title, because there is no theme name to add', () => {
    expect(text('window-title')).toBe('XP Theme Showcase');
  });

  it('shows no colour swatches it cannot back up', () => {
    expect($('theme-colors').textContent).toContain('—');
  });

  it('keeps the window chrome, and says why the setting could not be read', () => {
    expect($('root-window').classList.contains('xp-frameless')).toBe(false);
    expect(text('frame-state')).toContain('No config domain');
  });

  it('still renders the token catalogue', () => {
    expect($('token-table').querySelectorAll('tr').length).toBeGreaterThan(30);
  });

  it('still renders the component gallery and the icons', () => {
    expect($('panel-controls').querySelectorAll('fieldset').length).toBeGreaterThan(3);
    expect($('icon-grid').querySelectorAll('.xs-icon').length).toBeGreaterThan(10);
  });

  it('disables the menu items that would need a shell', () => {
    $('menu-bar').querySelector<HTMLButtonElement>('[data-menu="shell"]')?.click();
    const items = [...$('overlay').querySelectorAll<HTMLElement>('.xp-menu li')];
    const settings = items.find((item) => item.textContent === 'Settings…');
    expect(settings?.getAttribute('aria-disabled')).toBe('true');
  });

  it('still switches skin, because that needs nothing from the shell', () => {
    $('menu-bar').querySelector<HTMLButtonElement>('[data-menu="view"]')?.click();
    const items = [...$('overlay').querySelectorAll<HTMLElement>('.xp-menu li')];
    items.find((item) => item.textContent === 'Windows 98')?.click();
    expect(text('status-skin')).toBe('Skin: Windows 98');
  });
});
