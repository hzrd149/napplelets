/**
 * The Theme tab: the shell's own NAP-THEME payload, rendered back at it.
 *
 * Nothing here is a mock-up. Every value on this tab is either a field the
 * shell sent over `theme.get` / `theme.changed`, a load result from
 * `resource.bytes`, or a computed custom property read off `<html>` -- so the
 * tab and the window around it can never disagree.
 */
import { byId, el, replaceChildren } from './dom';
import { describeAsset } from '../lib/theme-assets';
import type { ThemeAssets } from '../lib/theme-assets';
import {
  describeColors,
  describePalette,
  describePayload,
  describeSource,
} from '../lib/theme-report';
import type { Fact, ThemeSource } from '../lib/theme-report';
import { TOKEN_GROUPS, readToken } from '../lib/tokens';
import type { Theme } from '@napplet/sdk';

function factRows(facts: readonly Fact[]): Node[] {
  return facts.flatMap((fact) => [
    el('dt', {}, fact.label),
    el('dd', { class: `xs-${fact.tone}` }, fact.value),
  ]);
}

function assetFact(label: string, assets: ThemeAssets, key: keyof ThemeAssets): Fact {
  const { value, tone } = describeAsset(assets[key]);
  return { label, value, tone };
}

export function renderThemePanel(
  theme: Theme | null,
  source: ThemeSource,
  assets: ThemeAssets,
  following: boolean,
): void {
  byId<HTMLInputElement>('follow-theme').checked = following;

  const sourceFact = describeSource(source);
  const sourceLine = byId('theme-source');
  sourceLine.textContent = sourceFact.value;
  sourceLine.className = `xs-note xs-${sourceFact.tone}`;

  replaceChildren(byId('theme-facts'), factRows(describePayload(theme)));

  replaceChildren(
    byId('theme-colors'),
    describeColors(theme).map((swatch) => {
      const wrapper = el('div', { class: 'xs-swatch' });
      const chip = el('div', { class: 'xs-swatch-chip' });
      // A swatch of an unusable colour would be a lie -- the window is not
      // wearing it. Leave the chip empty and let the label say why.
      if (swatch.valid) chip.style.background = swatch.value;
      wrapper.append(
        chip,
        el('strong', {}, swatch.value),
        el(
          'span',
          { class: 'xs-swatch-name' },
          swatch.valid ? swatch.name : `${swatch.name} · unusable`,
        ),
      );
      return wrapper;
    }),
  );

  byId('theme-verdict').textContent = describePalette(theme, source, following);

  replaceChildren(
    byId('theme-assets'),
    factRows([
      assetFact('fonts.body', assets, 'bodyFont'),
      assetFact('fonts.title', assets, 'titleFont'),
      assetFact('background', assets, 'background'),
    ]),
  );

  const preview = byId<HTMLElement>('wallpaper-preview');
  const wallpaper = assets.background.objectUrl;
  preview.hidden = !wallpaper;
  if (wallpaper) {
    preview.style.backgroundImage = `url("${wallpaper}")`;
    preview.style.backgroundSize = theme?.background?.mode || 'cover';
  }
}

/**
 * The derived-token table, read live off `<html>`.
 *
 * Re-run on every theme change *and* every skin change: the 98 and GUI skins
 * define a different subset of these, and a token a skin never declares should
 * read as absent rather than as the last skin's value.
 */
export function renderTokenTable(): void {
  const rows: Node[] = [];

  for (const group of TOKEN_GROUPS) {
    const head = el('tr', { class: 'xs-token-group' });
    head.append(el('th', { colspan: '4' }, group.title));
    rows.push(head);

    for (const token of group.tokens) {
      const value = readToken(token.name);
      const row = el('tr');

      const chipCell = el('td');
      if (token.swatch !== false && value) {
        const chip = el('span', { class: 'xs-token-chip' });
        chip.style.background = value;
        chipCell.append(chip);
      }

      row.append(
        chipCell,
        el('td', {}, token.name),
        el('td', { class: 'xs-token-value', title: value }, value || 'not set by this skin'),
        el('td', { class: 'xs-token-value' }, token.note),
      );
      rows.push(row);
    }
  }

  replaceChildren(byId('token-table'), rows);
}
