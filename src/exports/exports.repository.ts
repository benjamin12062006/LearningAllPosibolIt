import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { isProductValues } from '../evaluations/engine/google-merchant.profile.js';
import type { EvaluationStatus } from '../evaluations/evaluations.types.js';
import { Prisma, type Export } from '../generated/prisma/client.js';
import { isProjectMember } from '../projects/project-access.js';
import { assertCanExport, type EvaluationToExport } from './export-approval.js';
import type { ExportView, NewExport } from './exports.types.js';
import type { ExportableRow } from './products-tsv.js';

type EvaluationToExportRow = {
  status: EvaluationStatus;
  engineVersion: string;
  profileVersion: string;
  validCount: number | null;
  invalidCount: number | null;
  excludedCount: number | null;
  resultChecksum: string | null;
  hasNewerEvaluation: boolean;
};

/** Una evaluación terminada: la base exige los tres conteos juntos. */
type CountedEvaluationRow = EvaluationToExportRow & {
  validCount: number;
  invalidCount: number;
  excludedCount: number;
};

/** Qué evaluación se lee: la del proyecto de este propietario. */
type EvaluationTarget = Pick<
  NewExport,
  'ownerId' | 'projectId' | 'evaluationId'
>;

/** El archivo de una exportación: solo lo ve el servidor. */
export type ExportFile = {
  artifactKey: string;
  byteSize: number;
  rowCount: number;
};

type ArtifactKeyRow = { artifactKey: string };

/** `product_values` llega de `jsonb` sin tipo; se comprueba al leer. */
type StoredValidRow = {
  sourceRow: number;
  externalId: string;
  productValues: unknown;
};

const EXPORT_COLUMNS = Prisma.sql`
  x.id,
  x.evaluation_id AS "evaluationId",
  x.accepted_invalid_count AS "acceptedInvalidCount",
  x.accepted_excluded_count AS "acceptedExcludedCount",
  x.row_count AS "rowCount",
  x.byte_size AS "byteSize",
  x.tsv_checksum AS "tsvChecksum",
  x.created_at AS "createdAt"
`;

/**
 * FOR SHARE sobre la evaluación y su snapshot: borrar una importación o un
 * proyecto los bloquea con FOR UPDATE, así que o el borrado espera a que se
 * guarde la exportación, o esta lectura espera y ya no los encuentra (D3).
 */
const LOCK_FOR_EXPORT = Prisma.sql`FOR SHARE OF e, s`;

/** Claves por consulta en la limpieza: el mismo lote que la de importaciones. */
const ARTIFACT_KEYS_PER_QUERY = 500;

@Injectable()
export class ExportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Exportar: comprobar la evaluación, leer sus productos y guardar la fila.
  // ---------------------------------------------------------------------------

  /** La evaluación del proyecto del propietario con lo que comprueba D1–D3. */
  findEvaluationToExport(
    ownerId: string,
    projectId: string,
    evaluationId: string,
  ): Promise<EvaluationToExport | null> {
    return readEvaluationToExport(
      this.prisma,
      { ownerId, projectId, evaluationId },
      Prisma.empty,
    );
  }

  /** Solo se llama tras comprobar que la evaluación es del propietario. */
  async findByEvaluation(evaluationId: string): Promise<ExportView | null> {
    const rows = await this.prisma.$queryRaw<ExportView[]>`
      SELECT ${EXPORT_COLUMNS}
      FROM estadistica_forms.exports x
      WHERE x.evaluation_id = ${evaluationId}`;
    return rows[0] ?? null;
  }

  /** Productos válidos en orden de `source_row`: como mucho 5.000. */
  async findValidRows(evaluationId: string): Promise<ExportableRow[]> {
    const rows = await this.prisma.$queryRaw<StoredValidRow[]>`
      SELECT
        source_row AS "sourceRow",
        external_id AS "externalId",
        product_values AS "productValues"
      FROM estadistica_forms.evaluation_rows
      WHERE evaluation_id = ${evaluationId}
        AND outcome = 'valid'
      ORDER BY source_row`;
    return rows.map(toExportableRow);
  }

  /**
   * Guarda la exportación si la evaluación sigue pudiéndose exportar con esta
   * aprobación. Devuelve `null` si otra petición guardó antes la exportación de
   * la misma evaluación (índice único, D7).
   */
  async insert(record: NewExport): Promise<ExportView | null> {
    try {
      return await this.insertChecked(record);
    } catch (error) {
      if (isUniqueViolation(error)) {
        return null;
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Consultar y descargar una exportación del propietario.
  // ---------------------------------------------------------------------------

  async findByOwner(
    ownerId: string,
    projectId: string,
    exportId: string,
  ): Promise<ExportView | null> {
    const rows = await this.prisma.$queryRaw<ExportView[]>`
      SELECT ${EXPORT_COLUMNS}
      FROM estadistica_forms.exports x
      JOIN estadistica_forms.projects p ON p.id = x.project_id
      WHERE x.id = ${exportId}
        AND p.id = ${projectId}
        AND ${isProjectMember(ownerId)}`;
    return rows[0] ?? null;
  }

  async findFileByOwner(
    ownerId: string,
    projectId: string,
    exportId: string,
  ): Promise<ExportFile | null> {
    const rows = await this.prisma.$queryRaw<ExportFile[]>`
      SELECT
        x.artifact_key AS "artifactKey",
        x.byte_size AS "byteSize",
        x.row_count AS "rowCount"
      FROM estadistica_forms.exports x
      JOIN estadistica_forms.projects p ON p.id = x.project_id
      WHERE x.id = ${exportId}
        AND p.id = ${projectId}
        AND ${isProjectMember(ownerId)}`;
    return rows[0] ?? null;
  }

  // ---------------------------------------------------------------------------
  // Limpieza de huérfanos al arrancar.
  // ---------------------------------------------------------------------------

  /** De las claves dadas, las que todavía usa alguna exportación. */
  async findReferencedArtifactKeys(keys: string[]): Promise<Set<string>> {
    const referenced = new Set<string>();
    for (let start = 0; start < keys.length; start += ARTIFACT_KEYS_PER_QUERY) {
      const chunk = keys.slice(start, start + ARTIFACT_KEYS_PER_QUERY);
      const rows = await this.prisma.$queryRaw<ArtifactKeyRow[]>`
        SELECT artifact_key AS "artifactKey"
        FROM estadistica_forms.exports
        WHERE artifact_key IN (${Prisma.join(chunk)})`;
      for (const row of rows) {
        referenced.add(row.artifactKey);
      }
    }
    return referenced;
  }

  /**
   * Repite D1–D3 con la evaluación bloqueada: entre la primera comprobación y
   * este momento pudo terminar otra evaluación o borrarse el snapshot.
   */
  private insertChecked(record: NewExport) {
    return this.prisma.$transaction(async (tx) => {
      const evaluation = await readEvaluationToExport(
        tx,
        record,
        LOCK_FOR_EXPORT,
      );
      assertCanExport(evaluation, record.approval);

      // Con la API del modelo, el índice único llega como P2002 (trampa 3 del traspaso).
      const created = await tx.export.create({
        data: {
          id: record.id,
          projectId: record.projectId,
          evaluationId: record.evaluationId,
          approvedResultChecksum: record.approval.resultChecksum,
          acceptedInvalidCount: record.approval.acceptedInvalidCount,
          acceptedExcludedCount: record.approval.acceptedExcludedCount,
          rowCount: record.rowCount,
          artifactKey: record.file.key,
          byteSize: record.file.byteSize,
          tsvChecksum: record.file.checksum,
          createdAt: record.createdAt,
        },
      });
      return toExportView(created);
    });
  }
}

/**
 * La misma lectura sirve fuera de la transacción (sin bloqueo) y dentro de ella
 * (con `LOCK_FOR_EXPORT`). `null`: la evaluación no existe o no es del proyecto
 * del propietario.
 */
async function readEvaluationToExport(
  client: Prisma.TransactionClient,
  target: EvaluationTarget,
  lock: Prisma.Sql,
): Promise<EvaluationToExport | null> {
  const rows = await client.$queryRaw<EvaluationToExportRow[]>(
    evaluationToExportQuery(target, lock),
  );
  return rows[0] ? toEvaluationToExport(rows[0]) : null;
}

/**
 * «Más reciente» ordena por `created_at` (ISO, comparable como texto) y desempata
 * por `id`. Una evaluación posterior `failed` no reemplaza a nadie (D3).
 */
function evaluationToExportQuery(target: EvaluationTarget, lock: Prisma.Sql) {
  return Prisma.sql`
    SELECT
      e.status,
      e.engine_version AS "engineVersion",
      e.profile_version AS "profileVersion",
      e.valid_count AS "validCount",
      e.invalid_count AS "invalidCount",
      e.excluded_count AS "excludedCount",
      e.result_checksum AS "resultChecksum",
      EXISTS (
        SELECT 1
        FROM estadistica_forms.evaluations n
        WHERE n.project_id = e.project_id
          AND n.status IN ('queued', 'running', 'succeeded')
          AND (n.created_at, n.id) > (e.created_at, e.id)
      ) AS "hasNewerEvaluation"
    FROM estadistica_forms.evaluations e
    JOIN estadistica_forms.projects p ON p.id = e.project_id
    JOIN estadistica_forms.catalog_snapshots s
      ON s.project_id = e.project_id AND s.id = e.snapshot_id
    WHERE e.id = ${target.evaluationId}
      AND p.id = ${target.projectId}
      AND ${isProjectMember(target.ownerId)}
    ${lock}`;
}

function toEvaluationToExport(row: EvaluationToExportRow): EvaluationToExport {
  return {
    status: row.status,
    engineVersion: row.engineVersion,
    profileVersion: row.profileVersion,
    counts: toCounts(row),
    resultChecksum: row.resultChecksum,
    hasNewerEvaluation: row.hasNewerEvaluation,
  };
}

function toCounts(row: EvaluationToExportRow) {
  if (!hasCounts(row)) {
    return null;
  }
  return {
    valid: row.validCount,
    invalid: row.invalidCount,
    excluded: row.excludedCount,
  };
}

/** La base exige los tres conteos juntos o ninguno (CHECK de evaluaciones). */
function hasCounts(row: EvaluationToExportRow): row is CountedEvaluationRow {
  return (
    row.validCount !== null &&
    row.invalidCount !== null &&
    row.excludedCount !== null
  );
}

/** Solo el worker escribe estas filas; una forma distinta es un error del backend. */
function toExportableRow(row: StoredValidRow): ExportableRow {
  if (!isProductValues(row.productValues)) {
    throw new Error(
      `La fila ${row.sourceRow} tiene valores con forma inválida.`,
    );
  }
  return { externalId: row.externalId, values: row.productValues };
}

/** Sin `artifactKey` ni la suma aprobada: no forman parte de la respuesta. */
function toExportView(record: Export): ExportView {
  return {
    id: record.id,
    evaluationId: record.evaluationId,
    acceptedInvalidCount: record.acceptedInvalidCount,
    acceptedExcludedCount: record.acceptedExcludedCount,
    rowCount: record.rowCount,
    byteSize: record.byteSize,
    tsvChecksum: record.tsvChecksum,
    createdAt: record.createdAt,
  };
}

function isUniqueViolation(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
