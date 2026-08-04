/**
 * theme-xp kitchen sink.
 *
 * Not a napplet -- there is no shell here. It drives `buildXpThemeVariables`
 * directly so the re-tinting can be eyeballed, and swaps the three skins at
 * runtime by replacing one <style> element.
 */
import xpSkin from '../src/styles.css?inline';
import skin98 from '../src/98.css?inline';
import guiSkin from '../src/gui.css?inline';
import taskbarCss from '../src/taskbar.css?inline';

import { buildXpThemeVariables } from '../src/xp-theme';
import {
  computer32,
  error32,
  folder48,
  ie16,
  notepad32,
  printer17,
  startButton,
  user,
} from '../src/generated/icons';

const SKINS: Record<string, { css: string; label: string }> = {
  xp: { css: xpSkin, label: 'XP' },
  '98': { css: skin98, label: '98' },
  gui: { css: guiSkin, label: 'GUI' },
};

const skinStyle = document.createElement('style');
const taskbarStyle = document.createElement('style');
taskbarStyle.textContent = taskbarCss;
document.head.append(skinStyle, taskbarStyle);

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/* ── Skin switching ──────────────────────────────────────────────────── */

function setSkin(name: string): void {
  const skin = SKINS[name] ?? SKINS.xp!;
  skinStyle.textContent = skin.css;
  $('skin-label').textContent = `Skin: ${skin.label}`;
}

/* ── Fake host theme ─────────────────────────────────────────────────── */

/** Mirrors the client's own bookkeeping: drop what the last apply set. */
let managed: string[] = [];

function applyTheme(background: string, text: string, primary: string): void {
  const variables = buildXpThemeVariables({ background, text, primary });
  const style = document.documentElement.style;
  for (const name of managed) if (!(name in variables)) style.removeProperty(name);
  for (const [name, value] of Object.entries(variables)) style.setProperty(name, value);
  managed = Object.keys(variables);
  document.documentElement.dataset.xpTheme =
    variables['color-scheme'] === 'dark' ? 'dark' : 'light';
  $('status-line').textContent = `Host theme: bg ${background} · text ${text} · primary ${primary}`;
}

function resetTheme(): void {
  const style = document.documentElement.style;
  for (const name of managed) style.removeProperty(name);
  managed = [];
  document.documentElement.dataset.xpTheme = 'light';
  $('status-line').textContent = 'Authentic Luna — no host theme applied.';
}

$('apply').addEventListener('click', () => {
  applyTheme(
    $<HTMLInputElement>('bg').value,
    $<HTMLInputElement>('fg').value,
    $<HTMLInputElement>('pri').value,
  );
});

$('reset').addEventListener('click', resetTheme);

$('preset').addEventListener('change', (event) => {
  const value = (event.target as HTMLSelectElement).value;
  if (!value) {
    resetTheme();
    return;
  }
  const [background, text, primary] = value.split('|') as [string, string, string];
  $<HTMLInputElement>('bg').value = background;
  $<HTMLInputElement>('fg').value = text;
  $<HTMLInputElement>('pri').value = primary;
  applyTheme(background, text, primary);
});

$('skin').addEventListener('change', (event) => setSkin((event.target as HTMLSelectElement).value));

/* ── Narrow-frame squeeze ────────────────────────────────────────────── */

$('narrow').addEventListener('change', (event) => {
  const on = (event.target as HTMLInputElement).checked;
  // The narrow layer keys off the viewport, so shrink the frame the way a host
  // shell would rather than just the window element.
  document.body.style.maxWidth = on ? '320px' : '';
  document.body.style.borderRight = on ? '2px dashed #888' : '';
});

const reportSize = (): void => {
  $('size-label').textContent =
    `${Math.round(document.body.clientWidth)}×${Math.round(document.body.clientHeight)}px`;
};
new ResizeObserver(reportSize).observe(document.body);

/* ── Tabs ────────────────────────────────────────────────────────────── */

const tabs = [
  ...document.querySelectorAll<HTMLButtonElement>('menu[role="tablist"] button[role="tab"]'),
];
for (const tab of tabs) {
  tab.addEventListener('click', () => {
    for (const other of tabs) {
      const panelId = other.getAttribute('aria-controls');
      const selected = other === tab;
      other.setAttribute('aria-selected', String(selected));
      if (panelId) $(panelId).hidden = !selected;
    }
  });
}

/* ── Icons ───────────────────────────────────────────────────────────── */

$('dialog-icon').style.backgroundImage = `url(${error32})`;

// taskbar.css ships a CSS-drawn start button so it stands alone; point it at the
// real bitmap, which is the one part of winXP's chrome that is not CSS.
const start = document.querySelector<HTMLElement>('.xp-start-button');
start?.classList.add('is-bitmap');
start?.style.setProperty('--xp-start-button-image', `url(${startButton})`);

const sample: [string, string][] = [
  ['computer32', computer32],
  ['folder48', folder48],
  ['notepad32', notepad32],
  ['printer17', printer17],
  ['error32', error32],
  ['ie16', ie16],
  ['user', user],
];

$('icon-grid').innerHTML = sample
  .map(
    ([name, uri]) =>
      `<span style="display:inline-flex;flex-direction:column;align-items:center;gap:4px;width:88px;margin:6px">
         <img src="${uri}" alt="${name}" style="image-rendering:pixelated" />
         <small>${name}</small>
       </span>`,
  )
  .join('');

/* ── Clock ───────────────────────────────────────────────────────────── */

const tick = (): void => {
  $('clock').textContent = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
};
tick();
setInterval(tick, 30_000);

setSkin('xp');
reportSize();
