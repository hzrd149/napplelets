// Adopt a freshly generated napplet into the monorepo's DRY layout: drop the
// per-package copies of the shared authoring context (kept once at the repo
// root) and repoint the package's tsconfig + agent docs at the root.
//
// This is deliberately written as deterministic replacement rather than regex
// patching of upstream text, so it stays correct across @napplet/boilerplate
// versions even if their local doc layout changes.
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Napplet folder names double as deploy `d` tags in @napplet/cli monorepo mode.
const D_TAG_PATTERN = /^[a-z0-9-]{1,13}$/;
const SHIM_PACKAGE = '@napplet/shim';
const CURRENT_NAPPLET_PACKAGES = {
  '@napplet/sdk': '^0.24.4',
  '@napplet/conformance-cli': '^0.2.15',
  '@napplet/vite-plugin': '^0.11.3',
};
const STATIC_SHIM_IMPORT =
  /^[\t ]*import(?:[\t ]+[^'"\r\n]+[\t ]+from)?[\t ]*['"]@napplet\/shim(?:\/[^'"]*)?['"];?[\t ]*(?:\/\/[^\r\n]*)?\r?\n?/gm;

function titleFromName(name) {
  return name
    .split('-')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

export async function adoptNapplet(dir, { name, title } = {}) {
  const displayTitle = title?.trim() || titleFromName(name);

  // 1. Remove duplicated shared context and the standalone template's guidance
  // test. Repo-level guidance and its validation live once at the root.
  for (const shared of ['docs', '.codex', 'tests/guidance.test.mjs', 'LICENSE']) {
    await rm(join(dir, shared), { recursive: true, force: true });
  }

  // 1b. Pin a memorable dev port (napplet Vite on 3001). Deploy is driven by
  // @napplet/cli at the repo root in monorepo mode; package-level build,
  // type-check, verify, and conformance scripts remain useful for filtered runs.
  // The folder name is the deploy `d` tag, so it must be a valid tag.
  if (!D_TAG_PATTERN.test(name)) {
    console.warn(
      `warning: "${name}" is not a valid napplet d tag (^[a-z0-9-]{1,13}$, no trailing '-').\n` +
        '         `napplet deploy --all` will reject it — rename the folder before deploying.',
    );
  }
  const pkgPath = join(dir, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  for (const dependencyGroup of ['dependencies', 'devDependencies']) {
    if (!pkg[dependencyGroup]) continue;
    delete pkg[dependencyGroup][SHIM_PACKAGE];
  }
  pkg.dependencies = {
    ...pkg.dependencies,
    '@napplet/sdk': CURRENT_NAPPLET_PACKAGES['@napplet/sdk'],
  };
  pkg.devDependencies = {
    ...pkg.devDependencies,
    '@napplet/conformance-cli': CURRENT_NAPPLET_PACKAGES['@napplet/conformance-cli'],
    '@napplet/vite-plugin': CURRENT_NAPPLET_PACKAGES['@napplet/vite-plugin'],
  };
  const scripts = { ...pkg.scripts };
  delete scripts['test:guidance'];
  pkg.scripts = {
    ...scripts,
    dev: 'vite --host 127.0.0.1 --port 3001 --strictPort',
    verify: 'pnpm type-check && pnpm build',
  };
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  // Runtime injection replaced app-owned bootstrap. Keep this normalization
  // while the published generator can still clone older template revisions.
  const mainPath = join(dir, 'src', 'main.ts');
  const mainSource = await readFile(mainPath, 'utf8');
  const normalizedMain = mainSource.replace(STATIC_SHIM_IMPORT, '');
  if (normalizedMain.includes(SHIM_PACKAGE)) {
    throw new Error(
      `${mainPath} still references ${SHIM_PACKAGE}; remove the app-owned runtime bootstrap`,
    );
  }
  if (normalizedMain !== mainSource) {
    await writeFile(mainPath, normalizedMain);
  }

  // 2. Extend the shared base tsconfig instead of carrying a full copy.
  await writeFile(
    join(dir, 'tsconfig.json'),
    `${JSON.stringify(
      { extends: '../../tsconfig.base.json', include: ['src', 'vite.config.ts'] },
      null,
      2,
    )}\n`,
  );

  // 3. Replace the per-package agent guide with a stub pointing at the root.
  await writeFile(
    join(dir, 'AGENTS.md'),
    `# ${displayTitle} — napplet

Part of the [napplelets](../../README.md) monorepo. Repo-wide agent guidance and
the shared NIP-5D authoring context live at the root:

- [\`../../AGENTS.md\`](../../AGENTS.md) — boundaries, workflow, verification
- [\`../../docs/\`](../../docs) — NIP-5D, boundaries, design patterns, NAP proposals
- [\`../../.agents/skills/\`](../../.agents/skills) — napplet design, build, and verification

This package is the napplet side of the shell boundary only. Do not add shell or
host code, direct \`fetch\`/\`WebSocket\`/storage, \`window.nostr\`, or an app-owned
\`@napplet/shim\` import here. The runtime injects \`window.napplet\` before app code.
`,
  );

  // 4. Replace the per-package README with a short monorepo-aware stub.
  await writeFile(
    join(dir, 'README.md'),
    `# ${displayTitle}

A NIP-5D napplet in the [napplelets](../../README.md) monorepo.

\`\`\`bash
pnpm --filter ${name} dev               # local dev server
pnpm --filter ${name} verify            # type-check + single-file build
pnpm --filter ${name} test:conformance  # NAP conformance check
\`\`\`

The runtime injects \`window.napplet\`; app code uses \`@napplet/sdk\` for shell
services. For current Kehto/Paja compatibility, \`vite.config.ts\` declares every
used NAP because the host derives injected grants from that list; degradable paths
still use injected property presence and fallbacks.

Shared authoring context lives at the repo root: [\`../../docs/\`](../../docs).
See [\`../../AGENTS.md\`](../../AGENTS.md) before changing protocol-facing behavior.
`,
  );

  return { dir, name, title: displayTitle };
}
