/**
 * xp-showcase -- every feature of @napplelets/theme-xp, driven by a live
 * NAP-THEME payload.
 *
 * Two things are going on and they are worth keeping apart:
 *
 *   1. `installThemeClient()` is the *integration*. It subscribes to the
 *      shell's theme and maps three colours onto the whole XP token surface.
 *      Any napplet using this theme writes that one line and stops.
 *
 *   2. Everything else here is the *showcase*. It subscribes a second time
 *      purely to report what arrived, applies the parts of a NAP-THEME payload
 *      that are bytes rather than colours (fonts, wallpaper -- see
 *      lib/theme-assets.ts), and lays the components out. Two `theme.get`
 *      round-trips at boot is the honest cost of showing the integration
 *      working rather than reimplementing it.
 */
import './styles.css';

import { config, storage, themeGet, themeOnChanged } from '@napplet/sdk';
import type { Theme } from '@napplet/sdk';
import { installThemeClient } from '@napplelets/theme-xp';
import { startButton } from '@napplelets/theme-xp/icons';

import { attempt, hasDomain } from './lib/shell';
import { SKINS, SKIN_ORDER, installSkins } from './lib/skins';
import type { SkinName } from './lib/skins';
import { createThemeAssets } from './lib/theme-assets';
import type { ThemeAssets } from './lib/theme-assets';
import { summarize } from './lib/theme-report';
import type { ThemeSource } from './lib/theme-report';
import {
  DEFAULT_VIEW_STATE,
  STORAGE_KEY,
  parseViewState,
  resolveSkin,
  serializeViewState,
} from './lib/view-state';
import type { TabId, ViewState } from './lib/view-state';
import { byId, el } from './ui/dom';
import { ICONS, renderIcons } from './ui/icons-panel';
import { createOverlay } from './ui/overlay';
import type { MenuItem } from './ui/overlay';
import { installTabs } from './ui/tabs';
import { renderThemePanel, renderTokenTable } from './ui/theme-panel';

// Domain presence, read once. A missing domain disables its own feature and
// nothing else; a *hollow* one is handled at each call site by `attempt`. See
// lib/shell.ts for why those are two different problems.
const hasTheme = hasDomain('theme');
const hasConfig = hasDomain('config');
const hasStorage = hasDomain('storage');

/*-------------------------------------------*\
    State
\*-------------------------------------------*/

let theme: Theme | null = null;
let source: ThemeSource = hasTheme ? { kind: 'pending' } : { kind: 'unavailable' };
let assets: ThemeAssets = {
  bodyFont: { status: 'absent' },
  titleFont: { status: 'absent' },
  background: { status: 'absent' },
};
let view: ViewState = { ...DEFAULT_VIEW_STATE };
let configuredSkin: unknown;
/** null until config answers, so the frame does not flicker off and back on. */
let windowFrame: boolean | null = null;

const setSkinStyles = installSkins();
const overlay = createOverlay();

/*-------------------------------------------*\
    Rendering
\*-------------------------------------------*/

function renderTheme(): void {
  renderThemePanel(theme, source, assets);
  renderTokenTable();

  // `theme.title` is the shell's name for its own theme -- surfacing it in the
  // title bar is the smallest honest way to show it arrived.
  byId('window-title').textContent = theme?.title
    ? `XP Theme Showcase — ${theme.title}`
    : 'XP Theme Showcase';

  // A shell title font only becomes real once its bytes are registered; until
  // then the family name would resolve to nothing and silently fall back.
  const titleFont = theme?.fonts?.title?.name;
  byId<HTMLElement>('window-title').style.fontFamily =
    assets.titleFont.status === 'ready' && titleFont
      ? `"${titleFont}", "Trebuchet MS", Arial, sans-serif`
      : '';

  const app = byId<HTMLElement>('app');
  const wallpaper = assets.background.objectUrl;
  app.classList.toggle('xs-has-wallpaper', Boolean(wallpaper));
  app.style.backgroundImage = wallpaper ? `url("${wallpaper}")` : '';
  app.style.backgroundSize = wallpaper ? theme?.background?.mode || 'cover' : '';

  byId('status-theme').textContent = summarize(theme, source);
}

function renderSkin(): void {
  const skin = resolveSkin(view.skin, configuredSkin);
  setSkinStyles(skin);
  byId('status-skin').textContent = `Skin: ${SKINS[skin].label}`;
  // Token values are skin-defaults until a theme overrides them, so the table
  // has to be re-read whenever the skin underneath it changes.
  renderTokenTable();
}

function renderFrame(): void {
  const frameless = windowFrame === false;
  byId('root-window').classList.toggle('xp-frameless', frameless);
  byId('frame-state').textContent = frameless
    ? 'Window frame: off — .xp-frameless, set by the shell. The title bar and border are gone; the status bar stays, because it is the napplet’s own surface rather than window chrome.'
    : hasConfig
      ? 'Window frame: on. Set the Window frame setting to false and the title bar and border drop away.'
      : 'Window frame: on. No config domain in this shell, so the setting cannot be read — the default stands.';
}

/*-------------------------------------------*\
    NAP-THEME
\*-------------------------------------------*/

// (1) The integration. One line; everything the theme package promises.
installThemeClient();

// (2) The report. A second subscription, so the tab shows what the client above
//     is acting on rather than a guess at it.
const themeAssets = createThemeAssets((next) => {
  assets = next;
  renderTheme();
});

function acceptTheme(next: Theme, kind: 'get' | 'changed'): void {
  theme = next;
  source =
    kind === 'get'
      ? { kind: 'get' }
      : { kind: 'changed', count: source.kind === 'changed' ? source.count + 1 : 1 };
  themeAssets.apply(next);
  renderTheme();
}

function failTheme(message: string): void {
  source = { kind: 'error', message };
  renderTheme();
}

function readTheme(): void {
  if (!hasTheme) return;
  source = { kind: 'pending' };
  renderTheme();

  // `attempt` covers a theme domain that exists but has no callable `get` --
  // the state the conformance reference shell puts every napplet in.
  const pending = attempt(() => themeGet());
  if (!pending) {
    failTheme('the theme domain is present but theme.get is not callable');
    return;
  }
  void pending
    .then((next) => acceptTheme(next, 'get'))
    .catch((error: unknown) => failTheme(error instanceof Error ? error.message : String(error)));
}

let themeSubscription: { close(): void } | undefined;

if (hasTheme) {
  readTheme();
  themeSubscription = attempt(() => themeOnChanged((next) => acceptTheme(next, 'changed')));
}

// Two things the browser will not clean up on its own: the object URL behind
// the wallpaper, and the theme subscription.
window.addEventListener('beforeunload', () => {
  themeAssets.dispose();
  themeSubscription?.close();
});

/*-------------------------------------------*\
    Config and storage
\*-------------------------------------------*/

function applyConfig(values: Record<string, unknown>): void {
  windowFrame = values.windowFrame !== false;
  configuredSkin = values.skin;
  renderFrame();
  renderSkin();
}

if (hasConfig) {
  attempt(() => config.get())
    ?.then(applyConfig)
    .catch(() => undefined);
  attempt(() => config.subscribe((values) => applyConfig(values as Record<string, unknown>)));
}

function persistView(): void {
  if (!hasStorage) return;
  attempt(() => storage.setItem(STORAGE_KEY, serializeViewState(view)))?.catch(() => undefined);
}

/*-------------------------------------------*\
    Chrome
\*-------------------------------------------*/

const selectTab = installTabs((tab: TabId) => {
  view = { ...view, tab };
  persistView();
});

function setSkin(skin: SkinName): void {
  view = { ...view, skin };
  renderSkin();
  persistView();
}

function aboutDialog(dismiss: () => void): HTMLElement {
  const dialog = el('div', { class: 'window xp-dialog' });

  const titleBar = el('div', { class: 'title-bar' });
  titleBar.append(el('div', { class: 'title-bar-text' }, 'About XP Theme Showcase'));
  const controls = el('div', { class: 'title-bar-controls' });
  const closeButton = el('button', { 'aria-label': 'Close' });
  closeButton.addEventListener('click', dismiss);
  controls.append(closeButton);
  titleBar.append(controls);

  const body = el('div', { class: 'window-body' });
  const dialogBody = el('div', { class: 'xp-dialog-body' });
  const icon = el('div', { class: 'xp-dialog-icon' });
  icon.style.backgroundImage = `url(${ICONS.info})`;
  dialogBody.append(
    icon,
    el(
      'p',
      { class: 'xp-dialog-message' },
      'A kitchen sink for @napplelets/theme-xp: every component, all three skins, the opt-in taskbar, and the token mapping that turns a three-colour NAP-THEME payload into Luna. The icons are Microsoft artwork — see NOTICE.md in the theme package before shipping them.',
    ),
  );
  const buttons = el('div', { class: 'xp-dialog-buttons' });
  const ok = el('button', {}, 'OK');
  ok.addEventListener('click', dismiss);
  buttons.append(ok);
  body.append(dialogBody, buttons);

  dialog.append(titleBar, body);
  return dialog;
}

function menuItems(name: string): MenuItem[] {
  const active = resolveSkin(view.skin, configuredSkin);
  switch (name) {
    case 'view':
      return [
        ...SKIN_ORDER.map((skin): MenuItem => ({
          kind: 'item',
          label: SKINS[skin].label,
          checked: skin === active,
          run: () => setSkin(skin),
        })),
        { kind: 'separator' },
        {
          kind: 'item',
          label: 'Forget my skin choice',
          disabled: !hasStorage || view.skin === null,
          run: () => {
            view = { ...view, skin: null };
            renderSkin();
            persistView();
          },
        },
      ];
    case 'shell':
      return [
        {
          kind: 'item',
          label: 'Settings…',
          disabled: !hasConfig,
          run: () => attempt(() => config.openSettings()),
        },
        { kind: 'separator' },
        {
          kind: 'item',
          label: 'Re-read theme (theme.get)',
          disabled: !hasTheme,
          run: readTheme,
        },
      ];
    default:
      return [
        {
          kind: 'item',
          label: 'About XP Theme Showcase',
          run: () => overlay.openDialog(aboutDialog),
        },
      ];
  }
}

for (const button of byId('menu-bar').querySelectorAll<HTMLButtonElement>('button[data-menu]')) {
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    overlay.openMenu(button, menuItems(button.dataset.menu ?? ''));
  });
}

byId('help-button').addEventListener('click', () => overlay.openDialog(aboutDialog));

/*-------------------------------------------*\
    Static furniture
\*-------------------------------------------*/

byId<HTMLElement>('dialog-icon-error').style.backgroundImage = `url(${ICONS.error32})`;
byId<HTMLElement>('dialog-icon-help').style.backgroundImage = `url(${ICONS.help})`;

// taskbar.css draws a CSS approximation of the start button so it works on its
// own; point it at the real bitmap, which is the one piece of XP chrome that
// was never CSS. `.is-bitmap` also silences the element's text -- the artwork
// already has "start" painted into it.
const start = byId<HTMLElement>('start-button');
start.classList.add('is-bitmap');
start.style.setProperty('--xp-start-button-image', `url(${startButton})`);

renderIcons();

const clock = byId('clock');
const tick = (): void => {
  clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};
tick();
setInterval(tick, 30_000);

// The frame size, reported back. A napplet is handed whatever pane the shell
// has -- a sidebar, a tile, a full window -- so the showcase says which one it
// is currently surviving.
const sizeField = byId('status-size');
const reportSize = (): void => {
  sizeField.textContent = `${Math.round(document.documentElement.clientWidth)}×${Math.round(
    document.documentElement.clientHeight,
  )}`;
};
new ResizeObserver(reportSize).observe(document.documentElement);
reportSize();

/*-------------------------------------------*\
    First paint
\*-------------------------------------------*/

renderSkin();
renderFrame();
renderTheme();
selectTab(view.tab);

if (hasStorage) {
  attempt(() => storage.getItem(STORAGE_KEY))
    ?.then((raw) => {
      view = parseViewState(raw);
      renderSkin();
      selectTab(view.tab);
    })
    .catch(() => undefined);
}
