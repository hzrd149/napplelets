/**
 * The icon set.
 *
 * A curated sample, not all 125, and that is the point rather than a shortcut.
 * `@napplelets/theme-xp/icons` exports one ES binding per icon so a bundler
 * drops what you do not import -- importing every one costs ~244 kB of base64,
 * and `theme-xp/icons.css` costs that unconditionally because CSS cannot be
 * tree-shaken. Napplet artifacts are content-addressed and published to Nostr,
 * which means permanently; the artwork is Microsoft's, and NOTICE.md in the
 * theme package asks you to think about that before shipping it. A showcase
 * that quietly inlined the lot would be demonstrating the wrong lesson.
 *
 * These names come from winXP's own imports, which is why most of them mean
 * something.
 */
import {
  cd,
  computer32,
  error32,
  folder48,
  folderOpen,
  help,
  ie16,
  info,
  keyboard,
  mediaPlayer32,
  network,
  notepad32,
  paint32,
  printer17,
  run,
  search,
  security,
  sound,
  user,
  windowsLogo,
} from '@napplelets/theme-xp/icons';

import { byId, el, replaceChildren } from './dom';

const SAMPLE: readonly (readonly [string, string])[] = [
  ['computer32', computer32],
  ['folder48', folder48],
  ['folderOpen', folderOpen],
  ['notepad32', notepad32],
  ['paint32', paint32],
  ['mediaPlayer32', mediaPlayer32],
  ['ie16', ie16],
  ['printer17', printer17],
  ['network', network],
  ['search', search],
  ['run', run],
  ['cd', cd],
  ['sound', sound],
  ['keyboard', keyboard],
  ['security', security],
  ['user', user],
  ['windowsLogo', windowsLogo],
  ['error32', error32],
  ['help', help],
  ['info', info],
];

export const ICONS = { error32, help, info } as const;

export function renderIcons(): void {
  byId('icon-note').textContent =
    `${SAMPLE.length} of the 125 vendored icons. They are ES module bindings, so a napplet that imports three ships three — this one ships ${SAMPLE.length}. Importing theme-xp/icons.css instead would ship all 125 (~244 kB) whether you show them or not. Read NOTICE.md first: the artwork is Microsoft's, and a published napplet artifact is permanent.`;

  replaceChildren(
    byId('icon-grid'),
    SAMPLE.map(([name, uri]) => {
      const cell = el('div', { class: 'xs-icon' });
      cell.append(el('img', { src: uri, alt: name }), el('span', { title: name }, name));
      return cell;
    }),
  );
}
