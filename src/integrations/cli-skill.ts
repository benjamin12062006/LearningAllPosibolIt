import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';

const SKILL_NAME = 'ktsu-cli';
const SKILL_FILES = [
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
] as const;

export async function readCliSkill() {
  const directory = join(process.cwd(), 'skills', SKILL_NAME);
  try {
    const files = await Promise.all(
      SKILL_FILES.map(async (path) => ({
        path,
        content: await readFile(join(directory, path), 'utf8'),
      })),
    );
    return { name: SKILL_NAME, files };
  } catch {
    throw apiError(ErrorCodes.INTEGRATIONS_UNAVAILABLE);
  }
}
