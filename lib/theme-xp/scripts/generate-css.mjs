#!/usr/bin/env node
/**
 * Rebuilds XP.css from its own sources with CSS custom properties intact.
 *
 * Upstream's `build.js` runs `postcss-css-variables`, which flattens every
 * `var()` at build time -- `dist/XP.css` contains zero custom properties and no
 * `:root` block, so the published package cannot be re-themed at runtime. We run
 * the same chain minus the plugins that destroy what we need:
 *
 *   postcss-import      keep   resolves the @import graph
 *   postcss-nested      keep   the sources use `&` nesting
 *   postcss-inline-svg  keep   resolves svg-load() to data URIs
 *   postcss-css-variables  DROP  this is what flattens var()
 *   postcss-calc           DROP  cannot reduce calc() containing var(); native CSS handles it
 *   postcss-copy           DROP  replaced by the font inliner below
 *   cssnano                DROP  keeps output readable and diffable; consumers' Vite minifies
 *
 * `@font-face` is hoisted out of the three theme files into a shared
 * `fonts.css` whose `url()`s are base64 `data:` URIs -- napplets are loaded via
 * `iframe.srcdoc` at an opaque origin, so a relative font URL resolves to
 * nothing and silently falls back to Arial.
 *
 * Run `node scripts/generate-css.mjs` to write, `--check` to verify the
 * committed output still matches the installed xp.css.
 */
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import postcss from 'postcss';
import postcssImport from 'postcss-import';
import postcssInlineSvg from 'postcss-inline-svg';
import postcssNested from 'postcss-nested';

const require = createRequire(import.meta.url);
const packageRoot = dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, '');
const upstreamRoot = dirname(require.resolve('xp.css/package.json'));
const outDir = join(packageRoot, 'src', 'generated');

const upstream = JSON.parse(await readFile(join(upstreamRoot, 'package.json'), 'utf8'));

/** Only woff2 is emitted: upstream's two "Pixelated MS Sans Serif" faces use two
 * separate `src:` declarations, so the second (woff2) always wins and the woff
 * line is dead code. Shipping woff too would double ~13kB of base64 for nothing. */
const FONTS = [
  { family: 'Pixelated MS Sans Serif', file: 'ms_sans_serif.woff2', weight: 'normal' },
  { family: 'Pixelated MS Sans Serif', file: 'ms_sans_serif_bold.woff2', weight: 'bold' },
  { family: 'Perfect DOS VGA 437 Win', file: 'PerfectDOSVGA437Win.woff2', weight: 'normal' },
];

const TARGETS = [
  { entry: 'gui/index.scss', out: 'gui.css', label: 'GUI.css (unthemed base)' },
  { entry: 'themes/XP/index.scss', out: 'xp.css', label: 'XP.css (Luna)' },
  { entry: 'themes/98/index.scss', out: '98.css', label: '98.css' },
];

function banner(label) {
  return `/*!
 * ${label} -- GENERATED FILE, DO NOT EDIT.
 *
 * Regenerate with: pnpm --filter @napplelets/theme-xp generate
 *
 * Rebuilt from xp.css@${upstream.version} sources with CSS custom properties
 * preserved (upstream's published dist flattens them away).
 *
 * XP.css is MIT licensed:
 *   Copyright (c) 2020 Adam Hammad, Jordan Scales
 *   https://github.com/botoxparty/XP.css/blob/main/LICENSE
 */
`;
}

async function buildFontsCss() {
  const faces = [];
  for (const { family, file, weight } of FONTS) {
    const bytes = await readFile(join(upstreamRoot, 'gui', 'fonts', 'converted', file));
    faces.push(
      [
        '@font-face {',
        `    font-family: "${family}";`,
        `    src: url("data:font/woff2;base64,${bytes.toString('base64')}") format("woff2");`,
        `    font-weight: ${weight};`,
        '    font-style: normal;',
        '}',
      ].join('\n'),
    );
  }
  return `${banner('theme-xp fonts')}
/*
 * The font files are inlined as data URIs on purpose: napplets load via
 * iframe.srcdoc at an opaque origin, where a relative url() cannot resolve.
 *
 * The "Pixelated MS Sans Serif" recreation is by "lou" (via FontStruct) and is
 * licensed CC BY-SA 3.0 -- a different license from XP.css's MIT. See NOTICE.md.
 */
${faces.join('\n')}
`;
}

async function buildThemeCss({ entry, label }) {
  const from = join(upstreamRoot, entry);
  const css = await readFile(from, 'utf8');
  const result = await postcss([postcssImport(), postcssNested(), postcssInlineSvg()]).process(
    css,
    { from },
  );

  const root = result.root;
  // @font-face lives in the shared fonts.css so the ~40kB of base64 is stored
  // once rather than three times.
  root.walkAtRules('font-face', (rule) => rule.remove());

  return `${banner(label)}\n${root.toString().trim()}\n`;
}

async function main() {
  const check = process.argv.includes('--check');
  const outputs = new Map();

  outputs.set('fonts.css', await buildFontsCss());
  for (const target of TARGETS) {
    outputs.set(target.out, await buildThemeCss(target));
  }

  if (check) {
    const stale = [];
    for (const [name, content] of outputs) {
      let current = null;
      try {
        current = await readFile(join(outDir, name), 'utf8');
      } catch {
        // missing counts as stale
      }
      if (current !== content) stale.push(name);
    }
    if (stale.length) {
      console.error(
        `generate-css: ${stale.join(', ')} ${stale.length === 1 ? 'is' : 'are'} out of date ` +
          `with xp.css@${upstream.version}.\n` +
          `Run: pnpm --filter @napplelets/theme-xp generate`,
      );
      process.exit(1);
    }
    console.log(`generate-css: up to date with xp.css@${upstream.version}`);
    return;
  }

  await mkdir(outDir, { recursive: true });
  for (const [name, content] of outputs) {
    await writeFile(join(outDir, name), content);
    const bytes = Buffer.byteLength(content);
    console.log(
      `generate-css: wrote ${relative(packageRoot, join(outDir, name))} (${(bytes / 1024).toFixed(1)}kB)`,
    );
  }
}

await main();
