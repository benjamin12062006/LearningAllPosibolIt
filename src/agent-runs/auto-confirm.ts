import { createHash } from 'node:crypto';

/**
 * Si lo que prepara la IA se confirma solo, en el chat de la web y en el MCP
 * (ampliación del 2026-11-15). Se activa con `AI_AUTO_CONFIRM=true`: entonces
 * cada escritura se aplica en la misma llamada, en nombre de la persona y con
 * sus permisos. Sin la variable, la persona confirma cada propuesta.
 */
export const AI_AUTO_CONFIRM = Symbol('AI_AUTO_CONFIRM');

export function aiAutoConfirmFrom(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return env.AI_AUTO_CONFIRM?.trim().toLowerCase() === 'true';
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
