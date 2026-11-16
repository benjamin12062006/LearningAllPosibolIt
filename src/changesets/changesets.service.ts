import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { parseIdempotencyKey } from '../common/http/idempotency-key.js';
import { fetchWindow, resolvePage, toPage } from '../common/http/pagination.js';
import { publicError } from '../common/http/public-error.js';
import { UsersService } from '../users/users.service.js';
import { evaluateRow } from '../worksheets/row-evaluation.js';
import { exceedsRowLimit } from '../worksheets/worksheet-columns.js';
import type {
  ProjectScope,
  WorksheetColumn,
} from '../worksheets/worksheets.types.js';
import {
  compareOperations,
  contentHash,
  countByStatus,
  resultingRows,
  rowCountChange,
  type DiffEntry,
  type SchemaDrift,
} from './changeset-diff.js';
import {
  isRowOperation,
  mentionedRowIds,
  normalizeOperations,
  type Operation,
  type OperationIssue,
  type RowValues,
} from './changeset-operations.js';
import {
  planConversion,
  retypedColumnIds,
  type ColumnConversion,
  type ConversionPlan,
} from './changeset-conversion.js';
import { isSchemaOperation, resultingColumns } from './changeset-schema.js';
import { inverseOperations } from './changeset-revert.js';
import type {
  ApplyChangesetDto,
  ChangesetListQueryDto,
  ConflictResolutionDto,
  DecisionDto,
} from './changesets.dto.js';
import {
  ChangesetsRepository,
  HeadChangedError,
} from './changesets.repository.js';
import type { Changeset, RevisionPointer } from './changesets.types.js';

/** `If-Match: "3"`: la versión del borrador que se editó (F45). */
const IF_MATCH_PATTERN = /^"(\d+)"$/;

/** Problemas que impiden enviar: celdas que no cumplen su columna (D5). */
const BLOCKING_PROBLEMS = new Set(['CELL_REQUIRED', 'CELL_VALUE_INVALID']);

/** Lo que una persona ve antes de enviar o aprobar (D4). */
export type EditsRequest = Readonly<{
  changesetId?: string;
  operations: readonly unknown[];
}>;

/** El borrador que se continúa, tal como estaba al preparar. */
type DraftPointer = Readonly<{
  id: string;
  title: string;
  draftVersion: number;
}>;

export type CheckedEdits = Readonly<{
  changeset: DraftPointer | null;
  baseRevisionId: string;
  previousOperationCount: number;
  /** Todas las del borrador resultante, ya normalizadas. */
  operations: readonly Operation[];
}>;

export type ConfirmedEdits = Readonly<{
  changeset: DraftPointer | null;
  baseRevisionId: string;
  title: string;
  operations: readonly unknown[];
}>;

export type ChangesetReview = Readonly<{
  baseRevisionId: string;
  headRevisionId: string;
  contentHash: string;
  entries: readonly DiffEntry[];
  counts: ReturnType<typeof countByStatus>;
  /** Filas vivas que tendría la hoja si se aplicara sobre la revisión actual. */
  resultingRowCount: number;
  problems: readonly Readonly<{
    rowId: string;
    columnId: string;
    code: string;
  }>[];
  /**
   * Lo que hace cada cambio de tipo (C5): celdas convertidas e incompatibles.
   * Cada incompatible aparece además en `problems`.
   */
  columnConversions: readonly ColumnConversion[];
}>;

/**
 * Borradores de hojas (E4): guardar sin perder cambios, revisar, aprobar,
 * aplicar de forma atómica e idempotente, resolver conflictos y revertir.
 * Las reglas de cada transición están en el repositorio, dentro de su
 * transacción; aquí se preparan los datos que no dependen del estado vivo.
 */
@Injectable()
export class ChangesetsService {
  constructor(
    private readonly usersService: UsersService,
    private readonly repository: ChangesetsRepository,
  ) {}

  async create(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    worksheetId: string,
    title: string,
  ) {
    const user = await this.usersService.findCurrent(identity);
    const head = await this.requireHead(user.id, scope, worksheetId);
    return this.repository.create(user.id, scope, {
      worksheetId,
      title,
      source: 'manual',
      base: head,
      operations: [],
    });
  }

  async find(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    changesetId: string,
  ) {
    const user = await this.usersService.findCurrent(identity);
    return this.requireChangeset(user.id, scope, changesetId);
  }

  /** Borradores de una hoja (H2): de cualquier autor, como al leer uno. */
  async findByWorksheet(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    worksheetId: string,
    query: ChangesetListQueryDto,
  ) {
    const user = await this.usersService.findCurrent(identity);
    await this.requireHead(user.id, scope, worksheetId);

    const page = resolvePage(query);
    const rows = await this.repository.findByWorksheet(
      user.id,
      scope,
      worksheetId,
      fetchWindow(page),
      query.status,
    );
    return toPage(rows, page);
  }

  /** Guardar (D3): sin `If-Match` 428, con otra versión 412. */
  async saveOperations(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    changesetId: string,
    ifMatch: string | undefined,
    input: readonly unknown[],
  ) {
    const expectedVersion = parseIfMatch(ifMatch);
    const user = await this.usersService.findCurrent(identity);
    const changeset = await this.requireChangeset(user.id, scope, changesetId);

    const operations = await this.normalizeOrReject(
      scope,
      changeset.worksheetId,
      baseOf(changeset),
      input,
    );
    return this.repository.saveOperations(
      user.id,
      scope,
      changesetId,
      expectedVersion,
      operations,
    );
  }

  async review(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    changesetId: string,
  ): Promise<ChangesetReview> {
    const user = await this.usersService.findCurrent(identity);
    const changeset = await this.requireChangeset(user.id, scope, changesetId);
    return this.buildReview(user.id, scope, changeset);
  }

  /** Enviar (D5): sobre el head actual, sin conflictos y sin problemas. */
  async submit(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    changesetId: string,
    draftVersion: number,
  ) {
    const user = await this.usersService.findCurrent(identity);
    const changeset = await this.requireChangeset(user.id, scope, changesetId);
    // Antes que los problemas: no tiene sentido validar un contenido que la
    // persona ya no tiene delante. El repositorio lo repite bajo bloqueo.
    if (changeset.draftVersion !== draftVersion) {
      throw apiError(ErrorCodes.CHANGESET_STALE);
    }
    const review = await this.buildReview(user.id, scope, changeset);

    if (review.headRevisionId !== changeset.baseRevisionId) {
      throw apiError(ErrorCodes.CHANGESET_BASE_OUTDATED);
    }
    assertNoBlockingProblems(review);
    // Aviso temprano: aplicar lo vuelve a comprobar con la hoja bloqueada.
    if (exceedsRowLimit(review.resultingRowCount)) {
      throw apiError(ErrorCodes.WORKSHEET_ROW_LIMIT_EXCEEDED);
    }
    return this.repository.submit(
      user.id,
      scope,
      changesetId,
      draftVersion,
      review.contentHash,
    );
  }

  async reopen(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    changesetId: string,
    draftVersion: number,
  ) {
    const user = await this.usersService.findCurrent(identity);
    return this.repository.reopen(user.id, scope, changesetId, draftVersion);
  }

  async cancel(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    changesetId: string,
  ) {
    const user = await this.usersService.findCurrent(identity);
    return this.repository.cancel(user.id, scope, changesetId);
  }

  async decide(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    changesetId: string,
    input: DecisionDto,
  ) {
    const user = await this.usersService.findCurrent(identity);
    return this.repository.decide(user.id, scope, changesetId, {
      decision: input.decision,
      contentHash: input.contentHash,
      draftVersion: input.draftVersion,
      expectedHeadRevisionId: input.expectedHeadRevisionId,
      reason: input.reason ?? null,
    });
  }

  /**
   * Aplicar (D8). El recibo se guarda por la huella del cuerpo: reintentar con
   * la misma clave devuelve el mismo resultado; con otro cuerpo, 422 (F47).
   */
  async apply(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    changesetId: string,
    idempotencyKey: string | undefined,
    input: ApplyChangesetDto,
  ) {
    const key = parseIdempotencyKey(idempotencyKey);
    const user = await this.usersService.findCurrent(identity);
    try {
      return await this.repository.apply(user.id, scope, changesetId, {
        idempotencyKey: key,
        payloadHash: payloadHashOf(input),
        contentHash: input.contentHash,
        expectedHeadRevisionId: input.expectedHeadRevisionId,
      });
    } catch (error) {
      await this.recordConflictIfHeadChanged(
        error,
        scope,
        changesetId,
        user.id,
      );
      throw error;
    }
  }

  /**
   * Rebase (D9): lo ya hecho o sin cambio se descarta; cada conflicto necesita
   * una elección. Sin elección para alguno, 409 y el borrador no cambia. Lo que
   * queda se vuelve a validar sobre el head: elegir la propuesta para una fila
   * que otra persona borró no la resucita (400, como al guardar).
   */
  async rebase(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    changesetId: string,
    draftVersion: number,
    resolutions: readonly ConflictResolutionDto[],
  ) {
    const user = await this.usersService.findCurrent(identity);
    const changeset = await this.requireChangeset(user.id, scope, changesetId);
    const head = await this.requireHead(user.id, scope, changeset.worksheetId);
    const { entries } = await this.compareWithHead(scope, changeset, head);

    const kept = keepAfterRebase(changeset.operations, entries, resolutions);
    const operations = await this.normalizeOrReject(
      scope,
      changeset.worksheetId,
      head,
      kept,
    );
    return this.repository.rebase(user.id, scope, changesetId, {
      expectedVersion: draftVersion,
      head,
      operations,
    });
  }

  /** Propuesta de reversión (D10): un borrador nuevo; nunca mueve el head atrás. */
  async proposeRevert(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    revisionId: string,
  ) {
    const user = await this.usersService.findCurrent(identity);
    const revision = await this.repository.findRevisionChanges(
      user.id,
      scope,
      revisionId,
    );
    if (!revision) {
      throw apiError(ErrorCodes.WORKSHEET_REVISION_NOT_FOUND);
    }
    const head = await this.requireHead(user.id, scope, revision.worksheetId);
    const headRows = await this.repository.findRowsAt(
      scope,
      revision.worksheetId,
      head.sequence,
      revision.changes.map(({ rowId }) => rowId),
    );

    const operations = inverseOperations(revision.changes, headRows);
    if (operations.length === 0) {
      throw apiError(ErrorCodes.REVERT_NOTHING_TO_UNDO);
    }
    return this.repository.create(user.id, scope, {
      worksheetId: revision.worksheetId,
      title: `Revertir la revisión ${revision.sequence}`,
      source: 'revert',
      base: head,
      operations,
    });
  }

  /**
   * Lo que prepara el asistente (plan 09 del asistente, etapa 2). Con
   * `changesetId`, las operaciones nuevas van detrás de las que ya tiene el
   * borrador y se validan juntas, como al guardar; sin él, sobre la revisión
   * actual. No escribe nada.
   */
  async checkEdits(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    worksheetId: string,
    request: EditsRequest,
  ): Promise<CheckedEdits> {
    const user = await this.usersService.findCurrent(identity);
    if (!request.changesetId) {
      const head = await this.requireHead(user.id, scope, worksheetId);
      return {
        changeset: null,
        baseRevisionId: head.id,
        previousOperationCount: 0,
        operations: await this.normalizeOrReject(
          scope,
          worksheetId,
          head,
          request.operations,
        ),
      };
    }

    const changeset = await this.requireEditableDraft(
      user.id,
      scope,
      worksheetId,
      request.changesetId,
    );
    return {
      changeset: {
        id: changeset.id,
        title: changeset.title,
        draftVersion: changeset.draftVersion,
      },
      baseRevisionId: changeset.baseRevisionId,
      previousOperationCount: changeset.operations.length,
      operations: await this.normalizeOrReject(
        scope,
        worksheetId,
        baseOf(changeset),
        [...changeset.operations, ...request.operations],
      ),
    };
  }

  /**
   * Guarda lo que la persona confirmó de `checkEdits`. En un borrador
   * existente, con la versión que vio (412 si otro guardó después). En uno
   * nuevo, sobre la misma revisión que vio: si la hoja avanzó, 409 y se
   * prepara otra vez.
   */
  async saveEdits(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    worksheetId: string,
    edits: ConfirmedEdits,
  ): Promise<Changeset> {
    if (edits.changeset) {
      return this.saveOperations(
        identity,
        scope,
        edits.changeset.id,
        `"${edits.changeset.draftVersion}"`,
        edits.operations,
      );
    }

    const user = await this.usersService.findCurrent(identity);
    const head = await this.requireHead(user.id, scope, worksheetId);
    if (head.id !== edits.baseRevisionId) {
      throw apiError(ErrorCodes.CHANGESET_BASE_OUTDATED);
    }
    const operations = await this.normalizeOrReject(
      scope,
      worksheetId,
      head,
      edits.operations,
    );
    return this.repository.create(user.id, scope, {
      worksheetId,
      title: edits.title,
      source: 'ai',
      base: head,
      operations,
    });
  }

  // ── Pasos internos ──

  /** Solo un borrador sin enviar admite operaciones, y debe ser de esta hoja. */
  private async requireEditableDraft(
    userId: string,
    scope: ProjectScope,
    worksheetId: string,
    changesetId: string,
  ): Promise<Changeset> {
    const changeset = await this.requireChangeset(userId, scope, changesetId);
    if (changeset.worksheetId !== worksheetId) {
      throw apiError(ErrorCodes.CHANGESET_NOT_FOUND);
    }
    if (changeset.status !== 'draft') {
      throw apiError(ErrorCodes.CHANGESET_STATE_INVALID);
    }
    return changeset;
  }

  private async requireChangeset(
    userId: string,
    scope: ProjectScope,
    changesetId: string,
  ): Promise<Changeset> {
    const changeset = await this.repository.findChangeset(
      userId,
      scope,
      changesetId,
    );
    if (!changeset) {
      throw apiError(ErrorCodes.CHANGESET_NOT_FOUND);
    }
    return changeset;
  }

  private async requireHead(
    userId: string,
    scope: ProjectScope,
    worksheetId: string,
  ): Promise<RevisionPointer> {
    const head = await this.repository.findHead(userId, scope, worksheetId);
    if (!head) {
      throw apiError(ErrorCodes.WORKSHEET_NOT_FOUND);
    }
    return head;
  }

  /**
   * Valida las operaciones contra una revisión publicada. Una revisión es
   * inmutable: leerla fuera de la transacción es seguro.
   */
  private async normalizeOrReject(
    scope: ProjectScope,
    worksheetId: string,
    base: Pick<RevisionPointer, 'sequence' | 'schemaVersion'>,
    input: readonly unknown[],
  ): Promise<readonly Operation[]> {
    const columns = await this.repository.findColumns(
      scope,
      worksheetId,
      base.schemaVersion,
    );
    const baseRows = await this.repository.findRowsAt(
      scope,
      worksheetId,
      base.sequence,
      mentionedRowIds(input),
    );
    const savedAt = new Date().toISOString();
    const result = normalizeOperations(input, {
      columns,
      baseRows,
      // Una fila insertada sin clave va detrás de las de este momento.
      defaultSortKey: (index) => `${savedAt}#${String(index).padStart(4, '0')}`,
    });
    if (!result.ok) {
      throw validationError(result.issues);
    }
    return result.operations;
  }

  private async buildReview(
    userId: string,
    scope: ProjectScope,
    changeset: Changeset,
  ): Promise<ChangesetReview> {
    const head = await this.requireHead(userId, scope, changeset.worksheetId);
    const { entries, baseRows, headRows, baseColumns } =
      await this.compareWithHead(scope, changeset, head);
    const columns = resultingColumns(
      baseColumns,
      changeset.operations.filter(isSchemaOperation),
    );
    const { conversion, rows } = await this.previewConversion(
      scope,
      changeset,
      baseColumns,
      baseRows,
    );
    return {
      baseRevisionId: changeset.baseRevisionId,
      headRevisionId: head.id,
      contentHash: contentHash({
        worksheetId: changeset.worksheetId,
        baseRevisionId: changeset.baseRevisionId,
        baseSchemaVersion: changeset.baseSchemaVersion,
        operations: changeset.operations,
      }),
      entries,
      counts: countByStatus(entries),
      resultingRowCount:
        head.rowCount + rowCountChange(changeset.operations, headRows),
      problems: blockingProblems(
        columns,
        rowsToCheck(changeset.operations, conversion, rows),
      ),
      columnConversions: conversion.conversions,
    };
  }

  /**
   * La conversión de los cambios de tipo sobre la revisión base: para ella hay
   * que leer todas las filas con valor en esas columnas, no solo las que el
   * borrador menciona.
   */
  private async previewConversion(
    scope: ProjectScope,
    changeset: Changeset,
    baseColumns: readonly WorksheetColumn[],
    mentionedRows: RowValues,
  ): Promise<Readonly<{ conversion: ConversionPlan; rows: RowValues }>> {
    const columnIds = retypedColumnIds(changeset.operations);
    const rows: RowValues =
      columnIds.length === 0
        ? mentionedRows
        : new Map([
            ...mentionedRows,
            ...(await this.repository.findRowsWithValuesAt(
              scope,
              changeset.worksheetId,
              changeset.baseSequence,
              columnIds,
            )),
          ]);
    return {
      conversion: planConversion(changeset.operations, baseColumns, rows),
      rows,
    };
  }

  /** Base, revisión actual y propuesta de cada operación, con el esquema de ambas. */
  private async compareWithHead(
    scope: ProjectScope,
    changeset: Changeset,
    head: RevisionPointer,
  ) {
    const { worksheetId } = changeset;
    const rowIds = changeset.operations
      .filter(isRowOperation)
      .map(({ rowId }) => rowId);
    const [baseColumns, headColumns, baseRows, headRows] = await Promise.all([
      this.repository.findColumns(
        scope,
        worksheetId,
        changeset.baseSchemaVersion,
      ),
      this.repository.findColumns(scope, worksheetId, head.schemaVersion),
      this.repository.findRowsAt(
        scope,
        worksheetId,
        changeset.baseSequence,
        rowIds,
      ),
      this.repository.findRowsAt(scope, worksheetId, head.sequence, rowIds),
    ]);
    const drift = schemaDrift(changeset, head, baseColumns, headColumns);
    return {
      entries: compareOperations(
        changeset.operations,
        baseRows,
        headRows,
        drift,
      ),
      baseRows,
      headRows,
      baseColumns,
    };
  }

  /** El conflicto se registra después del rollback, en su propia transacción. */
  private async recordConflictIfHeadChanged(
    error: unknown,
    scope: ProjectScope,
    changesetId: string,
    userId: string,
  ) {
    if (!(error instanceof HeadChangedError)) {
      return;
    }
    await this.repository.markConflicted(scope, changesetId, userId);
    throw apiError(ErrorCodes.WORKSHEET_HEAD_CHANGED);
  }
}

function baseOf(changeset: Changeset) {
  return {
    sequence: changeset.baseSequence,
    schemaVersion: changeset.baseSchemaVersion,
  };
}

function parseIfMatch(ifMatch: string | undefined): number {
  if (ifMatch === undefined) {
    throw apiError(ErrorCodes.CHANGESET_VERSION_REQUIRED);
  }
  const match = IF_MATCH_PATTERN.exec(ifMatch.trim());
  if (!match) {
    throw apiError(ErrorCodes.CHANGESET_VERSION_MISMATCH);
  }
  return Number(match[1]);
}

function payloadHashOf(input: ApplyChangesetDto) {
  const canonical = [input.contentHash, input.expectedHeadRevisionId];
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * Las filas cuyo resultado se valida: las que tocan el borrador y la
 * conversión y, con su valor de antes, las que tienen un incompatible.
 */
function rowsToCheck(
  operations: readonly Operation[],
  conversion: ConversionPlan,
  baseRows: RowValues,
) {
  const rows = resultingRows(
    [...operations, ...conversion.operations],
    baseRows,
  );
  for (const { rowId } of conversion.incompatible) {
    const base = baseRows.get(rowId);
    if (base && !rows.has(rowId)) {
      rows.set(rowId, { ...base });
    }
  }
  return rows;
}

function blockingProblems(
  columns: readonly WorksheetColumn[],
  rows: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
) {
  const columnIds = columns.map(({ id }) => id);
  const problems: { rowId: string; columnId: string; code: string }[] = [];
  for (const [rowId, values] of rows) {
    for (const problem of evaluateRow(columns, values, columnIds).problems) {
      if (BLOCKING_PROBLEMS.has(problem.code)) {
        problems.push({
          rowId,
          columnId: problem.columnId,
          code: problem.code,
        });
      }
    }
  }
  return problems;
}

/** `issues` con el campo `rows.<rowId>.<columnId>`, como el resto de validaciones. */
function assertNoBlockingProblems(review: ChangesetReview) {
  if (review.problems.length === 0) {
    return;
  }
  throw validationError(
    review.problems.map(({ rowId, columnId, code }) => ({
      field: `rows.${rowId}.${columnId}`,
      code:
        code === 'CELL_REQUIRED'
          ? ErrorCodes.CELL_REQUIRED
          : ErrorCodes.CELL_VALUE_INVALID,
    })),
  );
}

function validationError(issues: readonly OperationIssue[]) {
  return apiError(
    ErrorCodes.VALIDATION_FAILED,
    issues.map(({ field, code }) => ({ field, ...publicError(code) })),
  );
}

/**
 * Qué operaciones siguen tras el rebase: los cambios, y los conflictos donde
 * se eligió la propuesta. Lo satisfecho o sin cambio sobra.
 */
function keepAfterRebase(
  operations: readonly Operation[],
  entries: readonly DiffEntry[],
  resolutions: readonly ConflictResolutionDto[],
): Operation[] {
  const choices = new Map(
    resolutions.map((resolution) => [
      conflictKey(resolution.rowId, resolution.columnId),
      resolution.choice,
    ]),
  );
  const kept: Operation[] = [];
  let unresolved = 0;

  entries.forEach((entry, index) => {
    if (entry.status === 'change') {
      kept.push(operations[index]);
      return;
    }
    if (entry.status !== 'conflict') {
      return;
    }
    const choice = choices.get(conflictKey(entry.rowId, entry.columnId));
    if (choice === 'proposed') {
      kept.push(operations[index]);
    } else if (choice === undefined) {
      unresolved += 1;
    }
  });

  if (unresolved > 0) {
    throw apiError(ErrorCodes.CHANGESET_CONFLICTS);
  }
  return kept;
}

/** Una celda (`rowId` y `columnId`), una fila (`columnId` null) o una columna (`rowId` null). */
function conflictKey(rowId: string | null, columnId: string | null) {
  return `${rowId ?? ''}:${columnId ?? ''}`;
}

function schemaDrift(
  changeset: Changeset,
  head: RevisionPointer,
  baseColumns: readonly WorksheetColumn[],
  headColumns: readonly WorksheetColumn[],
): SchemaDrift {
  const headIds = new Set(headColumns.map(({ id }) => id));
  return {
    changed: head.schemaVersion !== changeset.baseSchemaVersion,
    removedColumnIds: new Set(
      baseColumns.map(({ id }) => id).filter((id) => !headIds.has(id)),
    ),
  };
}
