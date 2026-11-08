/**
 * Plazo de las transacciones que guardan o leen un borrador de hoja entero.
 * Importar el máximo (5.000 filas × 200 columnas) son 48,6 MB de operaciones.
 * Medido en C4 del plan de cierre: la transacción de crear la importación tarda
 * unos 7,3 s en PGlite y 2,2 s en PostgreSQL 15.2. El plazo por defecto de
 * Prisma (5 s) no alcanza en PGlite y deja poco margen fuera de él.
 */
export const LONG_TRANSACTION_TIMEOUT_MS = 30_000;

/** Opciones de `$transaction` para esas transacciones. */
export const LONG_TRANSACTION = {
  timeout: LONG_TRANSACTION_TIMEOUT_MS,
} as const;
