import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';

/**
 * Recibos de operaciones idempotentes y eventos de auditoría (la parte de E2
 * que necesita E4, plan changesets 01). Son funciones que reciben la
 * transacción de quien hace el cambio: el estado, el evento y el recibo se
 * confirman juntos o no se confirma nada (C22).
 */

export type ReceiptKey = Readonly<{
  organizationId: string;
  actorId: string;
  operation: string;
  resourceId: string;
  idempotencyKey: string;
}>;

export type StoredReceipt = Readonly<{
  payloadHash: string;
  result: unknown;
}>;

/**
 * El recibo de esta clave, si ya existe. Se bloquea: un reintento simultáneo
 * con la misma clave espera a que la primera petición confirme o deshaga.
 */
export async function findReceipt(
  tx: Prisma.TransactionClient,
  key: ReceiptKey,
): Promise<StoredReceipt | null> {
  const rows = await tx.$queryRaw<StoredReceipt[]>(Prisma.sql`
    SELECT
      payload_hash AS "payloadHash",
      result
    FROM estadistica_forms.operation_receipts
    WHERE organization_id = ${key.organizationId}
      AND actor_id = ${key.actorId}
      AND operation = ${key.operation}
      AND resource_id = ${key.resourceId}
      AND idempotency_key = ${key.idempotencyKey}
    FOR UPDATE
  `);
  return rows[0] ?? null;
}

export async function saveReceipt(
  tx: Prisma.TransactionClient,
  key: ReceiptKey,
  receipt: Readonly<{ payloadHash: string; result: unknown; now: string }>,
) {
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO estadistica_forms.operation_receipts
      (organization_id, actor_id, operation, resource_id, idempotency_key,
       payload_hash, result, created_at)
    VALUES (
      ${key.organizationId},
      ${key.actorId},
      ${key.operation},
      ${key.resourceId},
      ${key.idempotencyKey},
      ${receipt.payloadHash},
      ${JSON.stringify(receipt.result)}::jsonb,
      ${receipt.now}
    )
  `);
}

export type AuditEvent = Readonly<{
  organizationId: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  details: Readonly<Record<string, unknown>>;
  now: string;
}>;

/** Solo se añaden eventos; ninguna ruta los edita ni los borra. */
export async function recordAuditEvent(
  tx: Prisma.TransactionClient,
  event: AuditEvent,
) {
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO estadistica_forms.audit_events
      (id, organization_id, actor_id, action, resource_type, resource_id,
       details, created_at)
    VALUES (
      ${randomUUID()},
      ${event.organizationId},
      ${event.actorId},
      ${event.action},
      ${event.resourceType},
      ${event.resourceId},
      ${JSON.stringify(event.details)}::jsonb,
      ${event.now}
    )
  `);
}
