#!/usr/bin/env node
/**
 * Turns the vendored Windows icon bitmaps into inlinable data URIs.
 *
 * Napplets load via `iframe.srcdoc` at an opaque origin and are built to a
 * single self-contained file, so an icon has to be a data URI or it cannot be
 * an icon at all.
 *
 * Two outputs, because the trade-off differs:
 *
 *   src/generated/icons.ts    one `export const` per icon. ES module bindings,
 *                             so a bundler drops every icon the napplet does
 *                             not import. THIS IS THE ONE TO USE.
 *   src/generated/icons.css   the same set as `.xp-icon-*` background-image
 *                             rules. CSS cannot be tree-shaken, so importing it
 *                             costs the full ~293kB no matter how many icons the
 *                             napplet actually shows.
 *
 * Source: ShizukuIchi/winXP (MIT, Copyright (c) 2019 Shizuku Yang). The bitmaps
 * are Microsoft's artwork -- see NOTICE.md before shipping them anywhere.
 *
 * Run `node scripts/generate-icons.mjs`, or `--check` to verify the committed
 * output still matches vendor/windows-icons/.
 */
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, '');
const vendorDir = join(packageRoot, 'vendor', 'windows-icons');
const outDir = join(packageRoot, 'src', 'generated');

const BANNER = `/**
 * GENERATED FILE, DO NOT EDIT.
 *
 * Regenerate with: pnpm --filter @napplelets/theme-xp generate
 *
 * Windows icon bitmaps from ShizukuIchi/winXP
 *   MIT, Copyright (c) 2019 Shizuku Yang
 *   https://github.com/ShizukuIchi/winXP
 *
 * The artwork itself is Microsoft's. winXP's own README states: "The Windows XP
 * name, artwork, trademark are surely property of Microsoft. This project is
 * provided for educational purposes only. It is not affiliated with and has not
 * been approved by Microsoft." The same applies downstream. See NOTICE.md.
 */`;

/** `676(32x32).png` -> `{ id: '676', size: 32 }`; `ie-paper.png` -> `{ id: 'ie-paper' }`. */
function parseName(file) {
  const stem = file.replace(/\.png$/i, '');
  const sized = /^(.*?)\((\d+)x(\d+)\)$/.exec(stem);
  return sized ? { id: sized[1], size: Number(sized[2]) } : { id: stem, size: null };
}

function camelize(value) {
  const camel = value
    .replace(/[^A-Za-z0-9]+(.)?/g, (_, chr) => (chr ? chr.toUpperCase() : ''))
    .replace(/^[^A-Za-z_$]/, (chr) => `icon${chr}`);
  return camel || 'icon';
}

/**
 * Picks a stable identifier per file.
 *
 * winXP's own `import x from 'assets/windowsIcons/…'` statements are the only
 * record of what these resource IDs mean, and several files carry more than one
 * alias (`676(32x32).png` is both `computer` and `computerLarge`), while several
 * distinct files share one alias (`17(32x32).png` and `549(32x32).png` are both
 * `printer`). So:
 *
 *   1. Base name = the alias matching the filename if there is one, else the
 *      first alphabetically, else a synthesised `icon<id>_<size>`.
 *   2. When files collide on a base, a file whose own name *is* that base keeps
 *      it -- `ie.png` outranks `896(16x16).png` for `ie`.
 *   3. The rest are disambiguated by pixel size when that is what distinguishes
 *      them (`notepad16` / `notepad32`), and by resource ID when it is not
 *      (`printer17` / `printer549`, both 32x32).
 */
function assignNames(files, aliases) {
  const chosen = new Map();
  for (const file of files) {
    const { id, size } = parseName(file);
    const names = aliases[file] ?? [];
    const stemCamel = camelize(id);
    const exact = names.find((n) => n.toLowerCase() === stemCamel.toLowerCase());
    // `111(32x32).png` with no alias -> `icon111_32`; the underscore keeps the
    // resource ID and the pixel size legible instead of running them together.
    const synthesised = `icon${camelize(id).replace(/^icon/, '')}${size ? `_${size}` : ''}`;
    const base = exact ?? names[0] ?? synthesised;
    chosen.set(file, { base, size, id, claimsBase: Boolean(exact) });
  }

  const byBase = new Map();
  for (const [file, info] of chosen) {
    if (!byBase.has(info.base)) byBase.set(info.base, []);
    byBase.get(info.base).push(file);
  }

  const final = new Map();
  const taken = new Set();
  for (const [base, group] of [...byBase].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const sorted = group.sort();
    if (sorted.length === 1) {
      taken.add(base);
      final.set(sorted[0], base);
      continue;
    }

    const claimants = sorted.filter((f) => chosen.get(f).claimsBase);
    const keeper = claimants.length === 1 ? claimants[0] : null;
    if (keeper) {
      taken.add(base);
      final.set(keeper, base);
    }

    const rest = sorted.filter((f) => f !== keeper);
    const sizes = rest.map((f) => chosen.get(f).size);
    const sizesDisambiguate =
      sizes.every((s) => s !== null) && new Set(sizes).size === sizes.length;

    for (const file of rest) {
      const { size, id } = chosen.get(file);
      const name = sizesDisambiguate ? `${base}${size}` : `${base}${id}`;
      let candidate = name;
      let n = 2;
      while (taken.has(candidate)) candidate = `${name}_${n++}`;
      taken.add(candidate);
      final.set(file, candidate);
    }
  }
  return final;
}

async function build() {
  const entries = (await readdir(vendorDir)).sort();
  const files = entries.filter((f) => /\.png$/i.test(f));
  const skipped = entries.filter((f) => !/\.png$/i.test(f) && f !== 'names.json');
  const aliases = JSON.parse(await readFile(join(vendorDir, 'names.json'), 'utf8'));

  const names = assignNames(files, aliases);
  const rows = [];
  for (const file of files) {
    const bytes = await readFile(join(vendorDir, file));
    rows.push({
      name: names.get(file),
      file,
      uri: `data:image/png;base64,${bytes.toString('base64')}`,
    });
  }
  rows.sort((a, b) => (a.name < b.name ? -1 : 1));

  const ts = [
    BANNER,
    '',
    ...rows.flatMap(({ name, file, uri }) => [
      `/** \`${file}\` */`,
      `export const ${name} = '${uri}';`,
      '',
    ]),
    '/** Every icon name this module exports. */',
    `export type XpIconName =\n${rows.map(({ name }) => `  | '${name}'`).join('\n')};`,
    '',
  ].join('\n');

  const css = [
    BANNER.replace('/**', '/*!').replace(/^ \*/gm, ' *'),
    '',
    '/*',
    ' * Importing this file costs every icon, because CSS cannot be tree-shaken.',
    " * Prefer `import { computer } from '@napplelets/theme-xp/icons'` and set",
    ' * the background-image yourself -- a bundler will then keep only what you use.',
    ' */',
    '',
    ...rows.map(
      ({ name, uri }) =>
        `.xp-icon-${name} {\n    background-image: url('${uri}');\n    background-repeat: no-repeat;\n    background-position: center;\n}`,
    ),
    '',
  ].join('\n');

  return {
    outputs: new Map([
      ['icons.ts', ts],
      ['icons.css', css],
    ]),
    rows,
    skipped,
  };
}

async function main() {
  const check = process.argv.includes('--check');
  const { outputs, rows, skipped } = await build();

  if (skipped.length) {
    // Not silent: ICO support in background-image is uneven across browsers and
    // converting would pull in an image dependency, so these are left behind.
    console.log(`generate-icons: skipped ${skipped.length} non-PNG file(s): ${skipped.join(', ')}`);
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
        `generate-icons: ${stale.join(', ')} ${stale.length === 1 ? 'is' : 'are'} out of date ` +
          `with vendor/windows-icons/.\nRun: pnpm --filter @napplelets/theme-xp generate`,
      );
      process.exit(1);
    }
    console.log(`generate-icons: up to date (${rows.length} icons)`);
    return;
  }

  await mkdir(outDir, { recursive: true });
  for (const [name, content] of outputs) {
    await writeFile(join(outDir, name), content);
    console.log(
      `generate-icons: wrote src/generated/${name} (${(Buffer.byteLength(content) / 1024).toFixed(1)}kB)`,
    );
  }
  console.log(`generate-icons: ${rows.length} icons`);
}

await main();
