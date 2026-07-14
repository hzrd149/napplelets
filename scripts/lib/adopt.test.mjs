import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { adoptNapplet } from './adopt.mjs';

const shimPackage = ['@napplet', 'shim'].join('/');

test('adopts old boilerplate without app-owned runtime bootstrap', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'napplelets-adopt-'));

  try {
    await Promise.all([
      mkdir(join(dir, 'src'), { recursive: true }),
      mkdir(join(dir, 'docs'), { recursive: true }),
      mkdir(join(dir, '.codex'), { recursive: true }),
      mkdir(join(dir, 'tests'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        join(dir, 'package.json'),
        `${JSON.stringify(
          {
            name: 'old-napplet',
            scripts: {
              dev: 'vite',
              build: 'vite build',
              'type-check': 'tsc --noEmit',
              verify: 'pnpm test:guidance && pnpm type-check && pnpm build',
              'test:guidance': 'node --test tests/guidance.test.mjs',
              'test:conformance': 'pnpm build && napplet-conformance ./dist',
            },
            dependencies: {
              '@napplet/sdk': '^0.12.0',
              [shimPackage]: '^0.13.0',
            },
            devDependencies: {
              '@napplet/conformance-cli': '^0.2.1',
              '@napplet/vite-plugin': '^0.8.1',
            },
          },
          null,
          2,
        )}\n`,
      ),
      writeFile(
        join(dir, 'src/main.ts'),
        `import '${shimPackage}'; // legacy app bootstrap\nimport { identity } from '@napplet/sdk';\nvoid identity;\n`,
      ),
      writeFile(join(dir, 'docs/context-map.md'), '# duplicated docs\n'),
      writeFile(join(dir, '.codex/README.md'), '# duplicated skills\n'),
      writeFile(join(dir, 'tests/guidance.test.mjs'), '// standalone-only guidance test\n'),
      writeFile(join(dir, 'LICENSE'), 'MIT\n'),
    ]);

    await adoptNapplet(dir, { name: 'test-napplet', title: 'Test Napplet' });

    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    assert.equal(pkg.dependencies[shimPackage], undefined);
    assert.equal(pkg.dependencies['@napplet/sdk'], '^0.24.4');
    assert.equal(pkg.devDependencies['@napplet/conformance-cli'], '^0.2.15');
    assert.equal(pkg.devDependencies['@napplet/vite-plugin'], '^0.11.3');
    assert.equal(pkg.scripts['test:guidance'], undefined);
    assert.equal(pkg.scripts.verify, 'pnpm type-check && pnpm build');
    assert.equal(pkg.scripts['test:conformance'], 'pnpm build && napplet-conformance ./dist');

    const main = await readFile(join(dir, 'src/main.ts'), 'utf8');
    assert.doesNotMatch(main, new RegExp(shimPackage));
    assert.match(main, /from '@napplet\/sdk'/);

    const readme = await readFile(join(dir, 'README.md'), 'utf8');
    assert.match(readme, /runtime injects `window\.napplet`/);
    assert.match(readme, /uses `@napplet\/sdk`/);

    await assert.rejects(access(join(dir, 'docs')));
    await assert.rejects(access(join(dir, '.codex')));
    await assert.rejects(access(join(dir, 'tests/guidance.test.mjs')));
    await assert.rejects(access(join(dir, 'LICENSE')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
