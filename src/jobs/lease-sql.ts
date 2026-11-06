import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';

/**
 * Lo que identifica un reclamo: la fila del trabajo y el token que recibió al
 * reclamarla. Cada reclamo nuevo genera un token nuevo.
 */
export type JobClaim = Readonly<{ id: string; token: string }>;

/**
 * El reclamo ya no es el vigente: venció su lease y otro proceso lo recuperó,
 * o el trabajo terminó por otro camino. Quien lo recibe no escribe nada más.
 */
export class LostClaimError extends Error {
  constructor() {
    super('El reclamo del trabajo ya no es el vigente.');
    this.name = 'LostClaimError';
  }
}

/** Token de una ejecución (fencing, F3 de jobs&files). */
export function newExecutionToken() {
  return randomUUID();
}

/** `now() + ms`, con el reloj de la base y no el del proceso. */
export function nowPlus(ms: number) {
  return Prisma.sql`now() + ${ms} * interval '1 millisecond'`;
}

/**
 * Solo el reclamo vigente puede escribir: mismo token, todavía `running` y con
 * el lease sin vencer. Comprobar solo el token no basta: entre que vence el
 * lease y otro worker lo recupera, el token antiguo seguiría valiendo.
 *
 * Usa los nombres de columna comunes de las tablas de trabajos (`id`,
 * `execution_token`, `status`, `lease_until`), sin alias de tabla.
 */
export function claimIsCurrent(claim: JobClaim) {
  return Prisma.sql`
    id = ${claim.id}
    AND execution_token = ${claim.token}
    AND status = 'running'
    AND lease_until > now()
  `;
}
