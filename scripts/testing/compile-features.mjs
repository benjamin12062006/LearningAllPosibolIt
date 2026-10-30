import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
// Evita ejecutar salidas antiguas de specs eliminados o renombrados.
rmSync(new URL('../../.test-build/', import.meta.url), {
  recursive: true,
  force: true,
});
for (const args of [
  [
    'node_modules/prisma/build/index.js',
    'generate',
    '--config',
    'scripts/testing/prisma-generate.config.mjs',
  ],
  ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.features.json'],
]) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
