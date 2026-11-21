import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';

// Skills que la web muestra y deja copiar en Integraciones. Cada lista es
// explícita para no publicar por accidente un archivo nuevo de la carpeta; el
// e2e comprueba que cubre todos los archivos de cada skill.
const PUBLISHED_SKILLS = {
  'ktsu-cli': [
    'SKILL.md',
    'references/acceso.md',
    'references/comandos.md',
    'references/operaciones.md',
    'references/feed.md',
    'scripts/ktsu-cli/package.json',
    'scripts/ktsu-cli/bin/ktsu.mjs',
    'scripts/ktsu-cli/lib/http.mjs',
    'scripts/ktsu-cli/lib/keychain.mjs',
    'scripts/ktsu-cli/lib/oauth.mjs',
  ],
  'ktsu-mcp': [
    'SKILL.md',
    'references/conexion.md',
    'references/herramientas.md',
  ],
} as const;

export type PublishedSkillName = keyof typeof PUBLISHED_SKILLS;

export async function readPublishedSkill(name: PublishedSkillName) {
  const directory = join(process.cwd(), 'skills', name);
  try {
    const files = await Promise.all(
      PUBLISHED_SKILLS[name].map(async (path) => ({
        path,
        content: await readFile(join(directory, path), 'utf8'),
      })),
    );
    return { name, files };
  } catch {
    throw apiError(ErrorCodes.INTEGRATIONS_UNAVAILABLE);
  }
}
