/**
 * The tab strip.
 *
 * XP.css styles `menu[role="tablist"]` and `[role="tabpanel"]` but wires
 * nothing, so selection and panel visibility are ours. Arrow-key roving is part
 * of the ARIA tabs pattern and costs six lines, so it is here rather than a
 * TODO -- a napplet in a tiny pane is exactly where keyboard navigation earns
 * its keep.
 */
import { byId } from './dom';
import { isTabId } from '../lib/view-state';
import type { TabId } from '../lib/view-state';

export function installTabs(onChange: (tab: TabId) => void): (tab: TabId) => void {
  const tablist = byId<HTMLElement>('tablist');
  const tabs = [...tablist.querySelectorAll<HTMLButtonElement>('button[role="tab"]')];

  const select = (tab: TabId, focus = false): void => {
    for (const button of tabs) {
      const id = button.id.replace(/^tab-/, '');
      const selected = id === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(`panel-${id}`);
      if (panel) panel.hidden = !selected;
      if (selected && focus) button.focus();
    }
  };

  const tabIdOf = (button: HTMLButtonElement): TabId | null => {
    const id = button.id.replace(/^tab-/, '');
    return isTabId(id) ? id : null;
  };

  for (const [index, button] of tabs.entries()) {
    button.addEventListener('click', () => {
      const tab = tabIdOf(button);
      if (!tab) return;
      // Both, always: `select` is the visible half and `onChange` is the
      // remembered half. Doing only the second is a tab strip that highlights
      // a tab it never opened.
      select(tab);
      onChange(tab);
    });
    button.addEventListener('keydown', (event) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const next = tabs[(index + step + tabs.length) % tabs.length];
      const tab = next ? tabIdOf(next) : null;
      if (tab) {
        onChange(tab);
        select(tab, true);
      }
    });
  }

  return select;
}
