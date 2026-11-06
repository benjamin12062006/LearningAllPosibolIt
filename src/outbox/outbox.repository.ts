import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  claimIsCurrent,
  newExecutionToken,
  nowPlus,
} from '../jobs/lease-sql.js';
import { retryDelay, type RetryOptions } from '../jobs/retry-delay.js';
import type { ClaimedOutboxEvent } from './outbox.types.js';

type IdRow = { id: string };

type ExpiredEventRow = { id: string; attempts: number };

type ReadyEventRow = Omit<ClaimedOutboxEvent, 'token'>;

/** Código guardado cuando un lease vence sin que el relay termine el evento. */
const LEASE_EXPIRED = 'OUTBOX_LEASE_EXPIRED';

/**
 * La tabla `outbox_events` vista por el relay (plan jobs&files, D8). Los
 * eventos se insertan desde la transacción de cada feature con
 * `outbox-events.ts`; aquí solo se reclaman y se cierran.
 */
@Injectable()
export class OutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Un evento `running` con el lease vencido: el relay que lo llevaba cayó.
   * Cuenta como un fallo temporal más, como en las demás colas.
   */
  recoverExpiredLeases(retry: RetryOptions): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const expired = await tx.$queryRaw<ExpiredEventRow[]>`
        SELECT id, attempts
        FROM estadistica_forms.outbox_events
        WHERE status = 'running'
          AND lease_until <= now()
        FOR UPDATE SKIP LOCKED`;
      for (const event of expired) {
        const attempts = event.attempts + 1;
        if (attempts >= retry.maxAttempts) {
          await tx.$executeRaw`
            UPDATE estadistica_forms.outbox_events
            SET ${failedAssignments(attempts, LEASE_EXPIRED)}
            WHERE id = ${event.id}`;
        } else {
          await tx.$executeRaw`
            UPDATE estadistica_forms.outbox_events
            SET ${pendingAssignments(attempts, retryDelay(attempts, retry))}
            WHERE id = ${event.id}`;
        }
      }
      return expired.length;
    });
  }

  /**
   * Toma el evento pendiente más antiguo con un token nuevo y su lease.
   * `skip`: los que el relay ya atendió en la pasada actual.
   */
  claim(
    leaseMs: number,
    skip: readonly string[] = [],
  ): Promise<ClaimedOutboxEvent | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<ReadyEventRow[]>`
        SELECT id, type, payload, attempts
        FROM estadistica_forms.outbox_events
        WHERE status = 'pending'
          AND (run_after IS NULL OR run_after <= now())
          AND id <> ALL(${[...skip]}::text[])
        ORDER BY created_at, id
        LIMIT 1
        FOR UPDATE SKIP LOCKED`;
      const event = rows[0];
      if (!event) {
        return null;
      }

      const token = newExecutionToken();
      await tx.$executeRaw`
        UPDATE estadistica_forms.outbox_events
        SET
          status = 'running',
          lease_until = ${nowPlus(leaseMs)},
          execution_token = ${token}
        WHERE id = ${event.id}`;
      return { ...event, token };
    });
  }

  /** El efecto está hecho: `done` es el recibo. `false` si el reclamo caducó. */
  async complete(event: ClaimedOutboxEvent) {
    const changed = await this.prisma.$queryRaw<IdRow[]>`
      UPDATE estadistica_forms.outbox_events
      SET
        status = 'done',
        processed_at = ${new Date().toISOString()},
        lease_until = NULL,
        execution_token = NULL
      WHERE ${claimIsCurrent(event)}
      RETURNING id`;
    return changed.length === 1;
  }

  /** Fallo temporal: vuelve a `pending` dentro de `delayMs`. */
  async retryLater(
    event: ClaimedOutboxEvent,
    attempts: number,
    delayMs: number,
  ) {
    const changed = await this.prisma.$queryRaw<IdRow[]>`
      UPDATE estadistica_forms.outbox_events
      SET ${pendingAssignments(attempts, delayMs)}
      WHERE ${claimIsCurrent(event)}
      RETURNING id`;
    return changed.length === 1;
  }

  /** Al apagar: vuelve a `pending` ya, sin gastar un intento. */
  release(event: ClaimedOutboxEvent) {
    return this.retryLater(event, event.attempts, 0);
  }

  /** Fallo definitivo: queda `failed` con su código para revisarlo. */
  async fail(event: ClaimedOutboxEvent, attempts: number, code: string) {
    const changed = await this.prisma.$queryRaw<IdRow[]>`
      UPDATE estadistica_forms.outbox_events
      SET ${failedAssignments(attempts, code)}
      WHERE ${claimIsCurrent(event)}
      RETURNING id`;
    return changed.length === 1;
  }
}

function pendingAssignments(attempts: number, delayMs: number) {
  return Prisma.sql`
    status = 'pending',
    attempts = ${attempts},
    run_after = ${nowPlus(delayMs)},
    lease_until = NULL,
    execution_token = NULL
  `;
}

function failedAssignments(attempts: number, code: string) {
  return Prisma.sql`
    status = 'failed',
    attempts = ${attempts},
    error = ${JSON.stringify({ code })}::jsonb,
    processed_at = ${new Date().toISOString()},
    lease_until = NULL,
    execution_token = NULL
  `;
}
