import { randomUUID } from 'node:crypto';
import {
  normalizeName,
  type ColumnDefinition,
  type ColumnType,
} from './worksheet-columns.js';

/** Esquema 1 y revisión 1: la hoja nace con una versión de cada cosa. */
const INITIAL_SCHEMA_VERSION = 1;
const INITIAL_SEQUENCE = 1;

export type NewColumn = Readonly<{
  columnId: string;
  name: string;
  nameNormalized: string;
  type: ColumnType;
  position: number;
  required: boolean;
}>;

/** Todo lo que se inserta al crear una hoja, ya calculado. */
export type NewWorksheet = Readonly<{
  worksheetId: string;
  name: string;
  nameNormalized: string;
  schemaVersion: number;
  columns: readonly NewColumn[];
  initialRevision: Readonly<{
    revisionId: string;
    sequence: number;
    schemaVersion: number;
    rowCount: number;
  }>;
}>;

/** Índices de las columnas cuyo nombre ya apareció antes en la lista. */
export function duplicateColumnPositions(
  columns: readonly ColumnDefinition[],
): number[] {
  const seen = new Set<string>();
  const duplicates: number[] = [];
  columns.forEach((column, position) => {
    const key = normalizeName(column.name);
    if (seen.has(key)) {
      duplicates.push(position);
    }
    seen.add(key);
  });
  return duplicates;
}

/**
 * Fábrica de la hoja (C15): arma IDs, posiciones, nombres normalizados y la
 * revisión inicial vacía, sin tocar la base. El llamador ya comprobó que no hay
 * nombres de columna repetidos (`duplicateColumnPositions`).
 */
export function buildNewWorksheet(
  name: string,
  columns: readonly ColumnDefinition[],
): NewWorksheet {
  return {
    worksheetId: randomUUID(),
    name,
    nameNormalized: normalizeName(name),
    schemaVersion: INITIAL_SCHEMA_VERSION,
    columns: columns.map((column, position) => ({
      columnId: randomUUID(),
      name: column.name,
      nameNormalized: normalizeName(column.name),
      type: column.type,
      position,
      required: column.required,
    })),
    initialRevision: {
      revisionId: randomUUID(),
      sequence: INITIAL_SEQUENCE,
      schemaVersion: INITIAL_SCHEMA_VERSION,
      rowCount: 0,
    },
  };
}
