import { build } from 'esbuild';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const upstreamRoot = resolve(packageRoot, 'node_modules/jspaint-upstream');
const outputPath = resolve(packageRoot, process.argv[2] ?? 'upstream.generated.html');

const mimeTypes = {
  '.bmp': 'image/bmp',
  '.cur': 'image/x-icon',
  '.css': 'text/css',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const isExternal = (value) => /^(?:[a-z]+:|#|\/\/)/i.test(value);

async function dataUrl(path) {
  const bytes = await readFile(path);
  const mime = mimeTypes[extname(path).toLowerCase()] ?? 'application/octet-stream';
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

async function inlineCss(cssPath) {
  let css = await readFile(cssPath, 'utf8');
  const imports = [...css.matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?\s*;/gi)];
  for (const match of imports) {
    if (isExternal(match[1])) continue;
    try {
      css = css.replace(match[0], await inlineCss(resolve(dirname(cssPath), match[1])));
    } catch {
      // Optional theme imports can remain inert.
    }
  }
  const matches = [...css.matchAll(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g)];
  for (const match of matches) {
    const reference = match[2];
    if (isExternal(reference) || reference.startsWith('data:')) continue;
    try {
      const replacement = `url("${await dataUrl(resolve(dirname(cssPath), reference))}")`;
      css = css.replace(match[0], replacement);
    } catch {
      // Some upstream theme URLs are optional variants. Keep them inert; the
      // default classic theme does not request them during the editor boot.
    }
  }
  return css;
}

async function inlineRuntimeAssets(source) {
  // JS Paint creates cursor, sound, help, and theme URLs at runtime. Replace
  // the concrete upstream-relative strings in the generated program so the
  // opaque production iframe never needs an origin to retrieve them.
  const references = new Set(
    [...source.matchAll(/(?<=["'`(])(?:\.\/)?(?:images|audio|help|styles)\/[A-Za-z0-9_./@%+~ -]+\.(?:bmp|cur|gif|ico|jpe?g|mp3|mp4|ogg|png|svg|wav|webp|woff2?|css)/gi)]
      .map((match) => match[0]),
  );
  for (const reference of references) {
    const cleanReference = reference.replace(/^\.\//, '');
    const assetPath = resolve(upstreamRoot, cleanReference);
    try {
      let replacement;
      if (extname(assetPath).toLowerCase() === '.css') {
        const css = await inlineCss(assetPath);
        replacement = `data:text/css;base64,${Buffer.from(css).toString('base64')}`;
      } else {
        replacement = await dataUrl(assetPath);
      }
      source = source.split(reference).join(replacement);
    } catch {
      // Feature-specific optional files can remain inert. Browser smoke tests
      // report any path that is actually required by the default editor.
    }
  }
  return source;
}

async function buildDynamicAssetMap() {
  const assets = {};
  for (const folder of ['images/cursors', 'help']) {
    for (const entry of await readdir(resolve(upstreamRoot, folder), { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const reference = `${folder}/${entry.name}`;
      assets[reference] = await dataUrl(resolve(upstreamRoot, reference));
    }
  }
  const themes = {};
  for (const entry of await readdir(resolve(upstreamRoot, 'styles/themes'), { withFileTypes: true })) {
    if (!entry.isFile() || extname(entry.name) !== '.css') continue;
    const css = await inlineCss(resolve(upstreamRoot, 'styles/themes', entry.name));
    themes[entry.name] = `data:text/css;base64,${Buffer.from(css).toString('base64')}`;
  }
  return { assets, themes };
}

async function bundleModules(entries, appStateSource, dynamicAssets) {
  const appIndex = entries.indexOf('src/app.js');
  const preAppEntries = appIndex >= 0 ? entries.slice(0, appIndex) : entries;
  const appEntries = appIndex >= 0 ? entries.slice(appIndex) : [];
  const deferredImports = appEntries.reduceRight(
    (chain, entry) => `import(${JSON.stringify(resolve(upstreamRoot, entry))}).then(() => ${chain})`,
    'Promise.resolve()',
  );
  const source = [
    ...preAppEntries.map((entry) => `import ${JSON.stringify(resolve(upstreamRoot, entry))};`),
    appStateSource,
    `${deferredImports}.catch((error) => setTimeout(() => { throw error; }));`,
  ].join('\n');
  const result = await build({
    stdin: { contents: source, resolveDir: upstreamRoot, sourcefile: 'jspaint-modules.js' },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    write: false,
    logLevel: 'warning',
    banner: {
      js: `window.__jspaintAssetURLs=${JSON.stringify(dynamicAssets.assets)};window.__jspaintThemeURLs=${JSON.stringify(dynamicAssets.themes)};`,
    },
    plugins: [{
      name: 'napplet-disable-network-extras',
      setup(builder) {
        builder.onResolve({ filter: /discord-activity-client\.js$/ }, () => ({ path: 'discord-activity-client', namespace: 'napplet-stub' }));
        builder.onLoad({ filter: /.*/, namespace: 'napplet-stub' }, () => ({
          contents: 'export const discordSdk = null; export const newAuth = null; export const guildMember = null; export const handleExternalLinks = () => {}; export const discordActivitySystemHooks = {}; export const shareImage = async () => { throw new Error("Discord sharing is unavailable in a napplet"); };',
          loader: 'js',
        }));
        builder.onLoad({ filter: /\/src\/theme\.js$/ }, async (args) => ({
          contents: (await readFile(args.path, 'utf8')).replace(
            'const href_for = (theme) => `styles/themes/${theme}`;',
            'const href_for = (theme) => window.__jspaintThemeURLs[theme] || window.__jspaintThemeURLs["classic.css"];',
          ),
          loader: 'js',
          resolveDir: dirname(args.path),
        }));
        builder.onLoad({ filter: /\/src\/helpers\.js$/ }, async (args) => ({
          contents: (await readFile(args.path, 'utf8'))
            .replace(
              'return `url(images/cursors/${name}.png) ${coords.join(" ")}, ${fallback}`;',
              'return window.__jspaintAssetURLs[`images/cursors/${name}.png`] ? `url(${window.__jspaintAssetURLs[`images/cursors/${name}.png`]}) ${coords.join(" ")}, ${fallback}` : fallback;',
            )
            .replace(
              'icon_img.src = `help/${file_name}`;',
              'icon_img.src = window.__jspaintAssetURLs[`help/${file_name}`] || "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";',
            ),
          loader: 'js',
          resolveDir: dirname(args.path),
        }));
        builder.onLoad({ filter: /\/src\/menus\.js$/ }, async (args) => ({
          contents: (await readFile(args.path, 'utf8')).replace(
            'export { menus };',
            `// Napplet packaging: omit browser/desktop actions that have no NAP authority.
const unsupportedNappletMenuLabels = new Set([
  "Load From URL",
  "Upload To Imgur",
  "Manage Storage",
  "Print Preview",
  "Page Setup",
  "Print",
  "Set As Wallpaper (Tiled)",
  "Set As Wallpaper (Centered)",
  "Recent File",
]);
for (const menuName of Object.keys(menus)) {
  const supportedItems = menus[menuName].filter((item) => {
    if (item === MENU_DIVIDER) return true;
    const label = typeof item.label === "string" ? item.label.replaceAll("&", "") : "";
    return !unsupportedNappletMenuLabels.has(label);
  });
  menus[menuName] = supportedItems.filter((item, index) => {
    if (item !== MENU_DIVIDER) return true;
    return index > 0 && index < supportedItems.length - 1 && supportedItems[index - 1] !== MENU_DIVIDER;
  });
}

export { menus };`,
          ),
          loader: 'js',
          resolveDir: dirname(args.path),
        }));
        builder.onLoad({ filter: /\/src\/app\.js$/ }, async (args) => ({
          contents: (await readFile(args.path, 'utf8')).replace(
            'const $app = $(E("div")).addClass("jspaint").appendTo("body");',
            'const $app = $(E("div")).addClass("jspaint").appendTo("#napplet-frame");',
          ),
          loader: 'js',
          resolveDir: dirname(args.path),
        }));
      },
    }],
  });
  return result.outputFiles[0].text;
}

async function bundleNappletAdapter() {
  const result = await build({
    entryPoints: [resolve(packageRoot, 'src/upstream-adapter.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    write: false,
    logLevel: 'warning',
  });
  return result.outputFiles[0].text;
}

async function buildXpFrameScript() {
  // Keep the complete shared XP theme inside a shadow root. It can style the
  // outer window border without leaking its button/menu rules into JS Paint.
  const xpCss = (await inlineCss(resolve(packageRoot, '../../lib/theme-xp/src/styles.css')))
    .replace(/:root\b/g, ':host');
  const frameCss = `
    :host { display: block; box-sizing: border-box; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; }
    .window { box-sizing: border-box; display: flex; flex-direction: column; width: 100%; height: 100%; min-width: 0; min-height: 0; }
    .title-bar { flex: 0 0 auto; }
    .title-bar-text { display: flex; align-items: center; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .window-body { flex: 1 1 auto; min-width: 0; min-height: 0; margin: 0 3px; overflow: hidden; }
    slot { display: block; width: 100%; height: 100%; min-width: 0; min-height: 0; }
    ::slotted(.jspaint) { width: 100%; height: 100%; min-width: 0; min-height: 0; }
  `;
  return `
    class NappletXpFrame extends HTMLElement {
      constructor() {
        super();
        const root = this.attachShadow({ mode: "open" });
        root.innerHTML = '<style>' + ${JSON.stringify(xpCss + frameCss)} + '</style>' +
          '<main class="window" aria-label="JS Paint window">' +
          '<div class="title-bar"><div class="title-bar-text">untitled - Paint</div>' +
          '<div class="title-bar-controls"><button aria-label="Minimize" disabled></button>' +
          '<button aria-label="Maximize" disabled></button><button aria-label="Close" disabled></button></div></div>' +
          '<div class="window-body"><slot></slot></div></main>';
      }
    }
    customElements.define("napplet-xp-frame", NappletXpFrame);
    const nappletFrame = document.createElement("napplet-xp-frame");
    nappletFrame.id = "napplet-frame";
    document.body.appendChild(nappletFrame);
  `;
}

let html = await readFile(join(upstreamRoot, 'index.html'), 'utf8');

// Strip comments before link/script discovery so disabled alternate themes and
// experimental modules are not accidentally included.
html = html.replace(/<!--[\s\S]*?-->/g, '');

const stylesheetTags = [...html.matchAll(/<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:stylesheet|alternate stylesheet)["'][^>]*>/gi)];
for (const match of stylesheetTags) {
  const href = match[1];
  const media = /\bmedia=["']([^"']+)["']/i.exec(match[0])?.[1];
  const css = await inlineCss(resolve(upstreamRoot, href));
  html = html.replace(match[0], `<style${media ? ` media="${media}"` : ''}>\n${css}\n</style>`);
}

// Remove install/website metadata that has no meaning inside an opaque srcdoc.
html = html.replace(/<link\b[^>]*rel=["'](?:apple-touch-icon|shortcut icon|icon|mask-icon|manifest)["'][^>]*>/gi, '');
html = html.replace(/<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');

// Inline only image elements from the original document. Do this before
// scripts are inserted so HTML-looking strings inside JavaScript stay intact.
const imageMatches = [...html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)];
for (const match of imageMatches) {
  const source = match[1];
  if (source.startsWith('data:')) continue;
  if (isExternal(source)) {
    // Upstream's hidden news/about markup contains many remote screenshots.
    // They are non-editor content and would otherwise be fetched eagerly.
    html = html.replace(match[0], match[0].replace(/\bsrc=["'][^"']+["']/i, 'src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="'));
    continue;
  }
  try {
    html = html.replace(match[0], match[0].replace(/\bsrc=["'][^"']+["']/i, `src="${await dataUrl(resolve(upstreamRoot, source))}"`));
  } catch {
    // Optional images can remain unresolved until their feature is adapted.
  }
}

const scriptTags = [...html.matchAll(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)><\/script>/gi)];
const moduleEntries = [];
const scriptReplacements = [];
let appStateSource = '';
for (const match of scriptTags) {
  const attributes = `${match[1]} ${match[3]}`;
  const source = match[2];
  if (/\btype=["']module["']/i.test(attributes)) {
    moduleEntries.push(source);
    scriptReplacements.push({ index: match.index, length: match[0].length, value: '' });
    continue;
  }
  let js = await readFile(resolve(upstreamRoot, source), 'utf8');
  if (source === 'src/app-localization.js') {
    // Language packs are separate executable files upstream and cannot be
    // loaded into an opaque single-file napplet. English remains the upstream
    // default; selecting another language reports the packaging limitation.
    js = js.replace(
      /document\.write\(`<script src="\$\{src\}"><\/\$\{""\/\*\(avoiding ending script tag if inlined in HTML\)\*\/\}script>`\);/,
      'console.warn(`Language pack ${src} is not bundled in this napplet.`);',
    );
  }
  if (source === 'src/app-state.js') {
    appStateSource = js;
    scriptReplacements.push({ index: match.index, length: match[0].length, value: '' });
    continue;
  }
  scriptReplacements.push({
    index: match.index,
    length: match[0].length,
    value: `<script>\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`,
  });
}
for (const replacement of scriptReplacements.sort((a, b) => b.index - a.index)) {
  html = html.slice(0, replacement.index) + replacement.value + html.slice(replacement.index + replacement.length);
}

// Upstream app-state.js is a classic global script while the rest of JS Paint
// is ESM. A single-file bundle cannot preserve that separate global lexical
// environment directly, so turn only its top-level declarations into global
// object assignments. All upstream modules then share the same mutable state
// without being evaluated twice.
const globalAppState = appStateSource
  .replace(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/gm, 'window.$1 = ')
  .replace(/^let\s+([A-Za-z_$][\w$]*)\s*;([^\n]*)$/gm, 'window.$1 = undefined;$2');
const dynamicAssets = await buildDynamicAssetMap();
const moduleBundle = await bundleModules(moduleEntries, globalAppState, dynamicAssets);
const nappletAdapter = await bundleNappletAdapter();
const xpFrameScript = await buildXpFrameScript();
html = html.replace('</body>', [
  `<script>\n${xpFrameScript.replace(/<\/script/gi, '<\\/script')}\n</script>`,
  `<script>\n${nappletAdapter.replace(/<\/script/gi, '<\\/script')}\n</script>`,
  `<script>\n${moduleBundle.replace(/<\/script/gi, '<\\/script')}\n</script>`,
  '</body>',
].join('\n'));
html = await inlineRuntimeAssets(html);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, html);
console.log(`Built upstream JS Paint HTML: ${outputPath} (${Buffer.byteLength(html)} bytes)`);
