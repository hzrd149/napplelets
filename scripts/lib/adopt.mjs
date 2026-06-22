// Adopt a freshly generated napplet into the monorepo's DRY layout: drop the
// per-package copies of the shared authoring context (kept once at the repo
// root) and repoint the package's tsconfig + agent docs at the root.
//
// This is deliberately written as deterministic replacement rather than regex
// patching of upstream text, so it stays correct across @napplet/boilerplate
// versions even if their local doc layout changes.
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Pinned because @kehto/cli ships unusable `workspace:*` deps; the matching
// version pins live in the root pnpm-workspace.yaml `overrides`.
const KEHTO_CLI_VERSION = '0.2.0';

function titleFromName(name) {
  return name
    .split('-')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

export async function adoptNapplet(dir, { name, title } = {}) {
  const displayTitle = title?.trim() || titleFromName(name);

  // 1. Remove duplicated shared context — it lives once at the repo root.
  for (const shared of ['docs', '.codex', 'LICENSE']) {
    await rm(join(dir, shared), { recursive: true, force: true });
  }

  // 1b. Wire the Kehto `paja` host shell: add @kehto/cli + a `shell` script.
  const pkgPath = join(dir, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  pkg.scripts = {
    ...pkg.scripts,
    shell:
      'kehto paja --target-url http://127.0.0.1:5173 -- vite --host 127.0.0.1 --port 5173 --strictPort',
  };
  pkg.devDependencies = {
    '@kehto/cli': KEHTO_CLI_VERSION,
    ...pkg.devDependencies,
  };
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

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
- [\`../../.codex/skills/\`](../../.codex/skills) — napplet-author, napplet-verify

This package is the napplet side of the shell boundary only. Do not add shell or
host code, direct \`fetch\`/\`WebSocket\`/storage, or \`window.nostr\` here.
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

Imports \`@napplet/shim\` once at the entry point, then uses \`@napplet/sdk\` for
shell services, declaring the NAPs it uses in \`vite.config.ts\` (\`requires\`).

Shared authoring context lives at the repo root: [\`../../docs/\`](../../docs).
See [\`../../AGENTS.md\`](../../AGENTS.md) before changing protocol-facing behavior.
`,
  );

  return { dir, name, title: displayTitle };
}
