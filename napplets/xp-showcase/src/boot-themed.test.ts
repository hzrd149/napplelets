/**
 * Boots the real napplet against a shell that sends a complete NAP-THEME
 * payload -- name, colours, both fonts, and a wallpaper -- and checks that
 * every field arrives somewhere a reader can see it.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { $, DARK_THEME, LIGHT_THEME, boot, installDom, installShell, text } from './test/harness';
import type { FakeShell } from './test/harness';

let shell: FakeShell;

beforeAll(async () => {
  installDom();
  shell = installShell({
    theme: DARK_THEME,
    configValues: { windowFrame: false, skin: '98' },
  });
  await boot();
  // Let theme.get, config.get, storage.getItem and the resource fetches settle.
  await vi.waitFor(() => expect(text('theme-source')).toContain('theme.get'));
});

describe('NAP-THEME payload', () => {
  it('names the shell’s theme in the title bar', () => {
    expect(text('window-title')).toBe('XP Theme Showcase — Luna Dark');
  });

  it('reports where the payload came from', () => {
    expect(text('theme-source')).toContain('theme.get');
  });

  it('lists every field the shell sent, including the optional ones', () => {
    const facts = text('theme-facts');
    expect(facts).toContain('Luna Dark');
    expect(facts).toContain('Tahoma');
    expect(facts).toContain('Trebuchet MS');
    expect(facts).toContain('image/jpeg');
  });

  it('shows the three colours as swatches', () => {
    const swatches = $('theme-colors').querySelectorAll('.xs-swatch');
    expect(swatches).toHaveLength(3);
    expect($('theme-colors').textContent).toContain('#d8c36a');
  });

  it('says the dark path re-derives the tokens XP hardcodes light', () => {
    expect(text('theme-verdict')).toMatch(/^Dark theme/);
  });

  it('summarises the theme in the status bar', () => {
    expect(text('status-theme')).toBe('Theme: Luna Dark');
  });
});

describe('the byte-backed half of the payload', () => {
  it('fetches both fonts and the wallpaper through resource.bytes', () => {
    expect(shell.fetched).toEqual([
      'https://example.com/tahoma.woff2',
      'https://example.com/trebuchet.woff2',
      'https://example.com/bliss.jpg',
    ]);
  });

  it('hangs the wallpaper behind the window at the shell’s own background-size', async () => {
    await vi.waitFor(() => expect($('app').classList.contains('xs-has-wallpaper')).toBe(true));
    expect($('app').style.backgroundImage).toContain('blob:fake/');
    expect($('app').style.backgroundSize).toBe('cover');
  });

  it('reports each asset’s load result rather than failing silently', async () => {
    await vi.waitFor(() => expect(text('theme-assets')).toContain('image/jpeg'));
    expect(text('theme-assets')).not.toContain('not sent');
  });
});

describe('shell-owned config', () => {
  it('drops the window chrome when the host says it draws its own', () => {
    expect($('root-window').classList.contains('xp-frameless')).toBe(true);
    expect(text('frame-state')).toContain('Window frame: off');
  });

  it('opens with the skin the placement chose', () => {
    expect(text('status-skin')).toBe('Skin: Windows 98');
  });
});

describe('live theme changes', () => {
  it('counts theme.changed pushes and re-renders from them', async () => {
    shell.pushTheme(LIGHT_THEME);
    await vi.waitFor(() => expect(text('theme-source')).toContain('theme.changed'));
    expect(text('theme-source')).toContain('1 push');
    expect(text('window-title')).toBe('XP Theme Showcase — Luna');
    expect(text('theme-verdict')).toMatch(/^Light theme/);

    shell.pushTheme(DARK_THEME);
    await vi.waitFor(() => expect(text('theme-source')).toContain('2 pushes'));
  });

  it('drops the previous theme’s wallpaper when the new one has none', async () => {
    shell.pushTheme(LIGHT_THEME);
    await vi.waitFor(() => expect($('app').classList.contains('xs-has-wallpaper')).toBe(false));
    expect(text('theme-assets')).toContain('not sent');
  });
});

describe('the derived-token table', () => {
  it('lists every token the mapping writes', () => {
    const rows = $('token-table').querySelectorAll('tr:not(.xs-token-group)');
    expect(rows.length).toBeGreaterThan(30);
    expect($('token-table').textContent).toContain('--xp-title-bar-bg');
    expect($('token-table').textContent).toContain('--xp-frame-inner-br');
  });
});

describe('chrome', () => {
  it('opens the skin menu from the menu bar and marks the active skin', () => {
    $('menu-bar').querySelector<HTMLButtonElement>('[data-menu="view"]')?.click();
    const menu = $('overlay').querySelector('.xp-menu');
    expect(menu).not.toBeNull();
    const checked = menu?.querySelector('[aria-checked="true"]');
    expect(checked?.textContent).toBe('Windows 98');
  });

  it('switches skin from the menu and remembers the choice', async () => {
    const items = [...$('overlay').querySelectorAll<HTMLElement>('.xp-menu li')];
    items.find((item) => item.textContent === 'XP (Luna)')?.click();
    expect(text('status-skin')).toBe('Skin: XP (Luna)');
    await vi.waitFor(() => expect(shell.stored['view-state']).toContain('"skin":"xp"'));
  });

  it('asks the shell to open its settings', () => {
    $('menu-bar').querySelector<HTMLButtonElement>('[data-menu="shell"]')?.click();
    const items = [...$('overlay').querySelectorAll<HTMLElement>('.xp-menu li')];
    items.find((item) => item.textContent === 'Settings…')?.click();
    expect(shell.openedSettings).toBe(1);
  });

  it('switches tabs and persists which one is open', async () => {
    $('tab-icons').click();
    expect($('panel-icons').hidden).toBe(false);
    expect($('panel-theme').hidden).toBe(true);
    await vi.waitFor(() => expect(shell.stored['view-state']).toContain('"tab":"icons"'));
  });

  it('renders the icon sample', () => {
    expect($('icon-grid').querySelectorAll('.xs-icon').length).toBeGreaterThan(10);
    expect(text('icon-note')).toContain('125');
  });
});
