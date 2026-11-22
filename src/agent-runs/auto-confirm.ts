import { createHash } from 'node:crypto';

/**
 * Las escrituras se aplican en la misma llamada, en nombre de la persona y con
 * sus permisos: en el chat de la web, el MCP, la CLI y cualquier integración
 * (plan 05 de cli, 2026-11-21). No hay interruptor en producción. Solo la
 * suite (`NODE_ENV=test`) puede pedir el flujo con propuesta pendiente con
 * `AI_AUTO_CONFIRM=false`, para seguir probando esa ruta.
 */
export const AI_AUTO_CONFIRM = Symbol('AI_AUTO_CONFIRM');

export function aiAutoConfirmFrom(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const manualInTests =
    env.NODE_ENV === 'test' &&
    env.AI_AUTO_CONFIRM?.trim().toLowerCase() === 'false';
  return !manualInTests;
}

/**
 * Un UUID estable por llamada: las confirmaciones lo usan como clave
 * idempotente (y algunas como ID del recurso), así que repetir la misma
 * llamada de una ejecución no crea el efecto dos veces.
 */
export function confirmationIdOf(runId: string, callId: string): string {
  const hex = createHash('sha256').update(`${runId}:${callId}`).digest('hex');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}
