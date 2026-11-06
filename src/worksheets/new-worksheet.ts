import { randomUUID } from 'node:crypto';
import type { PlannedColumn } from './column-plan.js';
import { normalizeName } from './worksheet-columns.js';

/** Esquema 1 y revisión 1: la hoja nace con una versión de cada cosa. */
const INITIAL_SCHEMA_VERSION = 1;
const INITIAL_SEQUENCE = 1;

/** Todo lo que se inserta al crear una hoja, ya calculado. */
export type NewWorksheet = Readonly<{
  worksheetId: string;
  name: string;
  nameNormalized: string;
  schemaVersion: number;
  columns: readonly PlannedColumn[];
  initialRevision: Readonly<{
    revisionId: string;
    sequence: number;
    schemaVersion: number;
    rowCount: number;
  }>;
}>;

/**
 * Fábrica de la hoja (C15): da ID a la hoja y arma la revisión inicial vacía,
 * sin tocar la base. Las columnas llegan ya validadas y con sus IDs desde
 * `planColumns` (E3.3).
 */
export function buildNewWorksheet(
  name: string,
  columns: readonly PlannedColumn[],
): NewWorksheet {
  return {
    worksheetId: randomUUID(),
    name,
    nameNormalized: normalizeName(name),
    schemaVersion: INITIAL_SCHEMA_VERSION,
    columns,
    initialRevision: {
      revisionId: randomUUID(),
      sequence: INITIAL_SEQUENCE,
      schemaVersion: INITIAL_SCHEMA_VERSION,
      rowCount: 0,
    },
  };
}
