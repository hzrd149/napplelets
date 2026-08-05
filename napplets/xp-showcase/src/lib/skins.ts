/**
 * The three theme-xp skins, swapped at runtime.
 *
 * They are mutually exclusive stylesheets -- each one pulls in the shared font
 * and patch layers plus its own chrome -- so switching means *replacing* the
 * document's skin, not stacking a second one on top. One <style> element whose
 * textContent is rewritten does exactly that.
 *
 * `?inline` hands us the compiled CSS as a string instead of letting Vite inject
 * it, which is what makes the swap possible. All three are therefore in the
 * built artifact; that is the cost of shipping a skin picker, and it is why an
 * ordinary napplet imports one skin the normal way instead of copying this.
 */
import xpSkin from '@napplelets/theme-xp/styles.css?inline';
import skin98 from '@napplelets/theme-xp/98.css?inline';
import guiSkin from '@napplelets/theme-xp/gui.css?inline';
import taskbarCss from '@napplelets/theme-xp/taskbar.css?inline';

export type SkinName = 'xp' | '98' | 'gui';

export const SKIN_ORDER: readonly SkinName[] = ['xp', '98', 'gui'];

export const SKINS: Record<SkinName, { css: string; label: string; note: string }> = {
  xp: {
    css: xpSkin,
    label: 'XP (Luna)',
    note: 'The default. Gradient title bars, rounded frames, the only skin with a styled <progress>.',
  },
  '98': {
    css: skin98,
    label: 'Windows 98',
    note: 'Same component API, flat chrome and hard bevels, and the pixel font throughout rather than only in the status bar. No <progress> styling — that component exists only in the XP theme upstream.',
  },
  gui: {
    css: guiSkin,
    label: 'GUI base',
    note: "Upstream's shared layer with neither skin applied. `--surface` is literally `lightblue` until a shell theme lands on it — which makes it the clearest view of what NAP-THEME actually re-tints.",
  },
};

export function isSkinName(value: unknown): value is SkinName {
  return typeof value === 'string' && value in SKINS;
}

/**
 * Installs the skin and taskbar stylesheets and returns a setter.
 *
 * Both are *prepended* to <head>, so they sort before this napplet's own
 * `styles.css` and the layout rules there win on equal specificity. The taskbar
 * is skin-independent and never changes, so it is written once.
 */
export function installSkins(): (name: SkinName) => void {
  const skinStyle = document.createElement('style');
  const taskbarStyle = document.createElement('style');
  taskbarStyle.textContent = taskbarCss;
  document.head.prepend(taskbarStyle);
  document.head.prepend(skinStyle);

  return (name: SkinName) => {
    skinStyle.textContent = SKINS[name].css;
  };
}
