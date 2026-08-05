/**
 * Menus and modal dialogs, positioned.
 *
 * theme-xp is explicit that `.xp-menu` is styling only -- "positioning, opening
 * and keyboard handling stay with the napplet, which is the half that has to
 * know about its own state". This is that half, and it doubles as the
 * showcase's proof that the menu classes work in a real interaction rather than
 * only as a static sample.
 *
 * Everything is drawn into `#overlay`, which sits outside the window: the
 * window body scrolls, and a menu clipped by its own container's `overflow`
 * would be a bug the theme would get blamed for.
 */
import { byId, el } from './dom';

export type MenuItem =
  | {
      kind: 'item';
      label: string;
      disabled?: boolean;
      checked?: boolean;
      run: () => void;
    }
  | { kind: 'separator' };

export type Overlay = {
  openMenu(anchor: HTMLElement, items: readonly MenuItem[]): void;
  openDialog(build: (close: () => void) => HTMLElement): void;
  close(): void;
  isOpen(): boolean;
};

export function createOverlay(): Overlay {
  const root = byId<HTMLElement>('overlay');
  let anchored: HTMLElement | null = null;

  function close(): void {
    root.replaceChildren();
    root.hidden = true;
    anchored?.setAttribute('aria-expanded', 'false');
    anchored = null;
  }

  function show(node: HTMLElement): void {
    root.replaceChildren(node);
    root.hidden = false;
  }

  function openMenu(anchor: HTMLElement, items: readonly MenuItem[]): void {
    const wasOpen = anchored === anchor;
    close();
    if (wasOpen) return;

    const menu = el('ul', { class: 'xp-menu', role: 'menu' });
    for (const item of items) {
      if (item.kind === 'separator') {
        menu.append(el('li', { class: 'xp-menu-sep' }));
        continue;
      }
      const li = el('li', { role: 'menuitem' }, item.label);
      if (item.disabled) li.setAttribute('aria-disabled', 'true');
      if (item.checked !== undefined) li.setAttribute('aria-checked', String(item.checked));
      if (!item.disabled) {
        li.addEventListener('click', (event) => {
          event.stopPropagation();
          close();
          item.run();
        });
      }
      menu.append(li);
    }

    show(menu);
    anchored = anchor;
    anchor.setAttribute('aria-expanded', 'true');

    // Hang the menu off the bottom-left of its button, then pull it back inside
    // the frame -- a napplet pane can be narrower than its own menu.
    const box = anchor.getBoundingClientRect();
    menu.style.top = `${box.bottom}px`;
    menu.style.left = `${box.left}px`;
    const overflow = menu.getBoundingClientRect().right - document.documentElement.clientWidth;
    if (overflow > 0) menu.style.left = `${Math.max(0, box.left - overflow - 2)}px`;
  }

  function openDialog(build: (dismiss: () => void) => HTMLElement): void {
    close();
    const backdrop = el('div', { class: 'xs-modal' });
    backdrop.append(build(close));
    show(backdrop);
  }

  // Click-outside and Escape. `#overlay` covers the frame while anything is
  // open, so a click that reaches it is by definition a click outside.
  root.addEventListener('click', (event) => {
    if (event.target === root || (event.target as HTMLElement).classList.contains('xs-modal'))
      close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !root.hidden) close();
  });

  return { openMenu, openDialog, close, isOpen: () => !root.hidden };
}
