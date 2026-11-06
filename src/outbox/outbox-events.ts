import { randomUUID } from 'node:crypto';
import type { FinalFolder } from '../artifacts/artifact.store.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { ArtifactsDeletePayload } from './outbox.types.js';

/**
 * Guarda en el outbox, **dentro de la transacción del llamante**, que hay que
 * borrar estos archivos (plan jobs&files, D8 y D9). Si la transacción se
 * deshace, el evento tampoco existe; si confirma, el relay los borrará aunque el
 * proceso caiga justo después. Sin claves no guarda nada.
 */
export async function enqueueArtifactsDelete(
  tx: Prisma.TransactionClient,
  folder: FinalFolder,
  keys: readonly string[],
) {
  if (keys.length === 0) {
    return;
  }
  const payload: ArtifactsDeletePayload = { folder, keys };
  await tx.$executeRaw`
    INSERT INTO estadistica_forms.outbox_events (id, type, payload, created_at)
    VALUES (
      ${randomUUID()},
      'artifacts.delete',
      ${JSON.stringify(payload)}::jsonb,
      ${new Date().toISOString()}
    )`;
}
