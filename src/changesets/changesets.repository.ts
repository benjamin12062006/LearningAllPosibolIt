import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  findReceipt,
  recordAuditEvent,
  saveReceipt,
} from '../audit/audit-trail.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  can,
  type OrganizationRole,
} from '../organizations/organization-roles.js';
import {
  findColumnsIn,
  lockProjectFor,
} from '../worksheets/worksheets.repository.js';
import type {
  ProjectScope,
  WorksheetColumn,
} from '../worksheets/worksheets.types.js';
import type { Operation, RowValues } from './changeset-operations.js';
import type { RowChange } from './changeset-revert.js';
import {
  isApplyResult,
  type ApplyResult,
  type Changeset,
  type ChangesetStatus,
  type Decision,
  type RevisionPointer,
} from './changesets.types.js';

/** Recurso de los recibos de aplicar: uno por borrador (F47, G7). */
const APPLY_OPERATION = 'worksheet.changeset.apply';

const CHANGESET_COLUMNS = Prisma.sql`
  c.id,
  c.worksheet_id AS "worksheetId",
  c.author_id AS "authorId",
  c.source,
  c.title,
  c.status,
  c.draft_version AS "draftVersion",
  c.base_revision_id AS "baseRevisionId",
  c.base_sequence AS "baseSequence",
  c.base_schema_version AS "baseSchemaVersion",
  c.operations,
  c.content_hash AS "contentHash",
  c.applied_revision_id AS "appliedRevisionId",
  c.created_at AS "createdAt",
  c.updated_at AS "updatedAt"
`;

/** El head ya no es la base aprobada: lo traduce el servicio tras el rollback. */
export class HeadChangedError extends Error {}

/**
 * Borradores de una hoja (E4). Todas las escrituras empiezan por
 * `lockProjectFor`, que bloquea la organización: así las transiciones de una
 * organización se ordenan entre sí y con su archivado (F39). El orden de
 * bloqueo es siempre organización → borrador → hoja (G5).
 */
@Injectable()
export class ChangesetsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Lecturas ──

  findChangeset(
    actorId: string,
    scope: ProjectScope,
    changesetId: string,
  ): Promise<Changeset | null> {
    return findChangesetIn(this.prisma, actorId, scope, changesetId);
  }

  /** Revisión actual de una hoja del ámbito; `null` si no existe o es ajena. */
  async findHead(
    actorId: string,
    scope: ProjectScope,
    worksheetId: string,
  ): Promise<RevisionPointer | null> {
    const rows = await this.prisma.$queryRaw<RevisionPointer[]>(Prisma.sql`
      SELECT
        r.id,
        r.sequence,
        r.schema_version AS "schemaVersion"
      FROM estadistica_forms.worksheets w
      JOIN estadistica_forms.worksheet_revisions r
        ON r.worksheet_id = w.id AND r.id = w.head_revision_id
      WHERE w.id = ${worksheetId}
        AND w.organization_id = ${scope.organizationId}
        AND w.project_id = ${scope.projectId}
        AND ${isMember(actorId)}
    `);
    return rows[0] ?? null;
  }

  findColumns(
    scope: ProjectScope,
    worksheetId: string,
    schemaVersion: number,
  ): Promise<WorksheetColumn[]> {
    return findColumnsIn(this.prisma, scope, worksheetId, schemaVersion);
  }

  /** Filas vivas en la revisión `sequence`, solo las pedidas. */
  findRowsAt(
    scope: ProjectScope,
    worksheetId: string,
    sequence: number,
    rowIds: readonly string[],
  ): Promise<RowValues> {
    return findRowsIn(this.prisma, scope, worksheetId, sequence, rowIds);
  }

  /**
   * Qué filas cambió una revisión y cómo estaban justo antes, para proponer
   * su reversión (D10). `null` si la revisión no es del ámbito.
   */
  async findRevisionChanges(
    actorId: string,
    scope: ProjectScope,
    revisionId: string,
  ): Promise<{
    worksheetId: string;
    sequence: number;
    changes: RowChange[];
  } | null> {
    const revisions = await this.prisma.$queryRaw<
      { worksheetId: string; sequence: number }[]
    >(Prisma.sql`
      SELECT r.worksheet_id AS "worksheetId", r.sequence
      FROM estadistica_forms.worksheet_revisions r
      JOIN estadistica_forms.worksheets w ON w.id = r.worksheet_id
      WHERE r.id = ${revisionId}
        AND w.organization_id = ${scope.organizationId}
        AND w.project_id = ${scope.projectId}
        AND ${isMember(actorId)}
    `);
    const revision = revisions[0];
    if (!revision) {
      return null;
    }

    const rows = await this.prisma.$queryRaw<
      {
        rowId: string;
        sortKey: string;
        after: Record<string, unknown>;
        afterDeleted: boolean;
        before: Record<string, unknown> | null;
        beforeDeleted: boolean | null;
      }[]
    >(Prisma.sql`
      SELECT
        a.row_id AS "rowId",
        a.sort_key AS "sortKey",
        a.cell_values AS "after",
        a.is_deleted AS "afterDeleted",
        b.cell_values AS "before",
        b.is_deleted AS "beforeDeleted"
      FROM estadistica_forms.worksheet_row_versions a
      LEFT JOIN estadistica_forms.worksheet_row_versions b
        ON b.worksheet_id = a.worksheet_id
        AND b.row_id = a.row_id
        AND b.to_sequence = a.from_sequence
      WHERE a.worksheet_id = ${revision.worksheetId}
        AND a.organization_id = ${scope.organizationId}
        AND a.from_sequence = ${revision.sequence}
      ORDER BY a.sort_key, a.row_id
    `);
    return {
      ...revision,
      changes: rows.map((row) => ({
        rowId: row.rowId,
        sortKey: row.sortKey,
        before: row.before && !row.beforeDeleted ? row.before : null,
        after: row.afterDeleted ? null : row.after,
      })),
    };
  }

  // ── Escrituras del autor ──

  /** Borrador vacío sobre la revisión actual, o con operaciones (reversión). */
  async create(
    actorId: string,
    scope: ProjectScope,
    draft: Readonly<{
      worksheetId: string;
      title: string;
      source: 'manual' | 'revert';
      base: RevisionPointer;
      operations: readonly Operation[];
    }>,
  ): Promise<Changeset> {
    const now = new Date().toISOString();
    const changesetId = randomUUID();

    return this.prisma.$transaction(async (tx) => {
      await lockProjectFor(tx, actorId, scope, 'worksheet.write');
      await assertHead(tx, scope, draft.worksheetId, draft.base.id);

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO estadistica_forms.worksheet_changesets
          (id, organization_id, project_id, worksheet_id, author_id, source,
           title, status, draft_version, base_revision_id, base_sequence,
           base_schema_version, operations, content_hash, applied_revision_id,
           created_at, updated_at)
        VALUES (
          ${changesetId}, ${scope.organizationId}, ${scope.projectId},
          ${draft.worksheetId}, ${actorId}, ${draft.source}, ${draft.title},
          'draft', 1, ${draft.base.id}, ${draft.base.sequence},
          ${draft.base.schemaVersion}, ${JSON.stringify(draft.operations)}::jsonb,
          NULL, NULL, ${now}, ${now}
        )
      `);
      await audit(tx, scope, actorId, changesetId, 'changeset.created', now, {
        source: draft.source,
      });
      return requireChangeset(tx, actorId, scope, changesetId);
    });
  }

  /** Sustituye las operaciones si la versión esperada sigue vigente (D3). */
  async saveOperations(
    actorId: string,
    scope: ProjectScope,
    changesetId: string,
    expectedVersion: number,
    operations: readonly Operation[],
  ): Promise<Changeset> {
    return this.prisma.$transaction(async (tx) => {
      await lockProjectFor(tx, actorId, scope, 'worksheet.write');
      const changeset = await lockChangeset(tx, actorId, scope, changesetId);
      assertAuthor(changeset, actorId);
      assertStatus(changeset, ['draft']);
      assertVersion(
        changeset,
        expectedVersion,
        ErrorCodes.CHANGESET_VERSION_MISMATCH,
      );

      await tx.$executeRaw(Prisma.sql`
        UPDATE estadistica_forms.worksheet_changesets
        SET operations = ${JSON.stringify(operations)}::jsonb,
          draft_version = draft_version + 1,
          updated_at = ${new Date().toISOString()}
        WHERE id = ${changesetId}
      `);
      return requireChangeset(tx, actorId, scope, changesetId);
    });
  }

  /**
   * Congela el contenido (D5): mismo `draftVersion`, el head sigue siendo la
   * base y el servicio ya comprobó que no hay problemas.
   */
  async submit(
    actorId: string,
    scope: ProjectScope,
    changesetId: string,
    expectedVersion: number,
    hash: string,
  ): Promise<Changeset> {
    return this.prisma.$transaction(async (tx) => {
      await lockProjectFor(tx, actorId, scope, 'worksheet.write');
      const changeset = await lockChangeset(tx, actorId, scope, changesetId);
      assertAuthor(changeset, actorId);
      assertStatus(changeset, ['draft']);
      assertVersion(changeset, expectedVersion, ErrorCodes.CHANGESET_STALE);
      await assertHead(
        tx,
        scope,
        changeset.worksheetId,
        changeset.baseRevisionId,
      );

      const now = new Date().toISOString();
      await setStatus(
        tx,
        changesetId,
        'pending_review',
        now,
        Prisma.sql`, content_hash = ${hash}`,
      );
      await audit(tx, scope, actorId, changesetId, 'changeset.submitted', now, {
        contentHash: hash,
      });
      return requireChangeset(tx, actorId, scope, changesetId);
    });
  }

  /** Vuelve a borrador y deja sin valor las decisiones anteriores (D7, T12). */
  async reopen(
    actorId: string,
    scope: ProjectScope,
    changesetId: string,
    expectedVersion: number,
  ): Promise<Changeset> {
    return this.prisma.$transaction(async (tx) => {
      await lockProjectFor(tx, actorId, scope, 'worksheet.write');
      const changeset = await lockChangeset(tx, actorId, scope, changesetId);
      assertAuthor(changeset, actorId);
      assertStatus(changeset, ['pending_review', 'rejected', 'conflicted']);
      assertVersion(changeset, expectedVersion, ErrorCodes.CHANGESET_STALE);

      const now = new Date().toISOString();
      await setStatus(
        tx,
        changesetId,
        'draft',
        now,
        Prisma.sql`, content_hash = NULL, draft_version = draft_version + 1`,
      );
      await audit(
        tx,
        scope,
        actorId,
        changesetId,
        'changeset.reopened',
        now,
        {},
      );
      return requireChangeset(tx, actorId, scope, changesetId);
    });
  }

  /** Lo cierra el autor o quien puede aprobar; uno aplicado ya no se cancela. */
  async cancel(
    actorId: string,
    scope: ProjectScope,
    changesetId: string,
  ): Promise<Changeset> {
    return this.prisma.$transaction(async (tx) => {
      const access = await lockProjectFor(
        tx,
        actorId,
        scope,
        'organization.read',
      );
      const changeset = await lockChangeset(tx, actorId, scope, changesetId);
      assertAuthorOrReviewer(changeset, actorId, access.role);
      assertStatus(changeset, [
        'draft',
        'pending_review',
        'approved',
        'rejected',
        'conflicted',
      ]);

      const now = new Date().toISOString();
      await setStatus(tx, changesetId, 'cancelled', now);
      await audit(
        tx,
        scope,
        actorId,
        changesetId,
        'changeset.cancelled',
        now,
        {},
      );
      return requireChangeset(tx, actorId, scope, changesetId);
    });
  }

  /** Rebase (D9): nueva base, operaciones resueltas y otra versión de borrador. */
  async rebase(
    actorId: string,
    scope: ProjectScope,
    changesetId: string,
    rebase: Readonly<{
      expectedVersion: number;
      head: RevisionPointer;
      operations: readonly Operation[];
    }>,
  ): Promise<Changeset> {
    return this.prisma.$transaction(async (tx) => {
      await lockProjectFor(tx, actorId, scope, 'worksheet.write');
      const changeset = await lockChangeset(tx, actorId, scope, changesetId);
      assertAuthor(changeset, actorId);
      assertStatus(changeset, ['draft', 'conflicted']);
      assertVersion(
        changeset,
        rebase.expectedVersion,
        ErrorCodes.CHANGESET_STALE,
      );
      await assertHead(tx, scope, changeset.worksheetId, rebase.head.id);

      const now = new Date().toISOString();
      await tx.$executeRaw(Prisma.sql`
        UPDATE estadistica_forms.worksheet_changesets
        SET status = 'draft',
          content_hash = NULL,
          draft_version = draft_version + 1,
          base_revision_id = ${rebase.head.id},
          base_sequence = ${rebase.head.sequence},
          base_schema_version = ${rebase.head.schemaVersion},
          operations = ${JSON.stringify(rebase.operations)}::jsonb,
          updated_at = ${now}
        WHERE id = ${changesetId}
      `);
      await audit(tx, scope, actorId, changesetId, 'changeset.rebased', now, {
        baseRevisionId: rebase.head.id,
      });
      return requireChangeset(tx, actorId, scope, changesetId);
    });
  }

  // ── Escrituras de quien revisa ──

  /**
   * Decisión sobre lo que se revisó (D6): mismo hash, versión y head. Aprobar
   * un borrador propio solo vale en una empresa de un solo miembro.
   */
  async decide(
    actorId: string,
    scope: ProjectScope,
    changesetId: string,
    request: Readonly<{
      decision: 'accept' | 'reject';
      contentHash: string;
      draftVersion: number;
      expectedHeadRevisionId: string;
      reason: string | null;
    }>,
  ): Promise<{ decision: Decision; changeset: Changeset }> {
    return this.prisma.$transaction(async (tx) => {
      await lockProjectFor(tx, actorId, scope, 'changeset.approve');
      const changeset = await lockChangeset(tx, actorId, scope, changesetId);
      assertStatus(changeset, ['pending_review']);
      const isWhatWasReviewed =
        changeset.contentHash === request.contentHash &&
        changeset.draftVersion === request.draftVersion &&
        changeset.baseRevisionId === request.expectedHeadRevisionId;
      if (!isWhatWasReviewed) {
        throw apiError(ErrorCodes.CHANGESET_STALE);
      }
      await assertHead(
        tx,
        scope,
        changeset.worksheetId,
        changeset.baseRevisionId,
      );
      const policy = await approvalPolicy(tx, scope, changeset, actorId);

      const now = new Date().toISOString();
      const decision: Decision = {
        id: randomUUID(),
        actorId,
        decision: request.decision,
        contentHash: request.contentHash,
        draftVersion: request.draftVersion,
        headRevisionId: request.expectedHeadRevisionId,
        policy,
        reason: request.reason,
        createdAt: now,
      };
      await insertDecision(tx, scope, changesetId, decision);
      const status = request.decision === 'accept' ? 'approved' : 'rejected';
      await setStatus(tx, changesetId, status, now);
      await audit(tx, scope, actorId, changesetId, `changeset.${status}`, now, {
        decisionId: decision.id,
        policy,
      });
      return {
        decision,
        changeset: await requireChangeset(tx, actorId, scope, changesetId),
      };
    });
  }

  /**
   * Aplica el borrador aprobado (D8, G5). Todo en una transacción: si algo
   * falla, no queda ni la revisión, ni las filas, ni el recibo. Con un recibo
   * de la misma clave y el mismo cuerpo, devuelve su resultado sin repetir.
   */
  async apply(
    actorId: string,
    scope: ProjectScope,
    changesetId: string,
    request: Readonly<{
      idempotencyKey: string;
      payloadHash: string;
      contentHash: string;
      expectedHeadRevisionId: string;
    }>,
  ): Promise<ApplyResult> {
    return this.prisma.$transaction(async (tx) => {
      await lockProjectFor(tx, actorId, scope, 'changeset.approve');
      const receiptKey = {
        organizationId: scope.organizationId,
        actorId,
        operation: APPLY_OPERATION,
        resourceId: changesetId,
        idempotencyKey: request.idempotencyKey,
      };
      const receipt = await findReceipt(tx, receiptKey);
      if (receipt) {
        if (receipt.payloadHash !== request.payloadHash) {
          throw apiError(ErrorCodes.IDEMPOTENCY_KEY_REUSED);
        }
        return storedResult(receipt.result);
      }

      const changeset = await lockChangeset(tx, actorId, scope, changesetId);
      assertStatus(changeset, ['approved']);
      await assertApprovedContent(tx, changeset, request.contentHash);
      await lockHeadOrThrow(tx, changeset, request.expectedHeadRevisionId);

      const now = new Date().toISOString();
      const headRows = await findRowsIn(
        tx,
        scope,
        changeset.worksheetId,
        changeset.baseSequence,
        [...new Set(changeset.operations.map(({ rowId }) => rowId))],
      );
      const revision = await writeRevision(
        tx,
        scope,
        changeset,
        headRows,
        actorId,
        now,
      );
      const result: ApplyResult = {
        changesetId,
        revisionId: revision.id,
        sequence: revision.sequence,
      };

      await setStatus(
        tx,
        changesetId,
        'applied',
        now,
        Prisma.sql`, applied_revision_id = ${revision.id}`,
      );
      await audit(tx, scope, actorId, changesetId, 'changeset.applied', now, {
        revisionId: revision.id,
        sequence: revision.sequence,
      });
      await saveReceipt(tx, receiptKey, {
        payloadHash: request.payloadHash,
        result,
        now,
      });
      return result;
    });
  }

  /**
   * Tras un apply rechazado por cambio de head, en otra transacción y solo si
   * sigue aprobado (G5 paso 3): así no se pisa una decisión posterior.
   */
  async markConflicted(
    scope: ProjectScope,
    changesetId: string,
    actorId: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const now = new Date().toISOString();
      const updated = await tx.$executeRaw(Prisma.sql`
        UPDATE estadistica_forms.worksheet_changesets
        SET status = 'conflicted', updated_at = ${now}
        WHERE id = ${changesetId}
          AND organization_id = ${scope.organizationId}
          AND status = 'approved'
      `);
      if (updated > 0) {
        await audit(
          tx,
          scope,
          actorId,
          changesetId,
          'changeset.conflicted',
          now,
          {},
        );
      }
    });
  }
}

// ── Lectura y bloqueo de un borrador ──

function isMember(actorId: string) {
  return Prisma.sql`
    EXISTS (
      SELECT 1
      FROM estadistica_forms.organization_members m
      WHERE m.organization_id = w.organization_id
        AND m.user_id = ${actorId}
    )
  `;
}

async function findChangesetIn(
  client: Prisma.TransactionClient,
  actorId: string,
  scope: ProjectScope,
  changesetId: string,
  lock = Prisma.empty,
): Promise<Changeset | null> {
  const rows = await client.$queryRaw<Changeset[]>(Prisma.sql`
    SELECT ${CHANGESET_COLUMNS}
    FROM estadistica_forms.worksheet_changesets c
    JOIN estadistica_forms.worksheets w ON w.id = c.worksheet_id
    WHERE c.id = ${changesetId}
      AND c.organization_id = ${scope.organizationId}
      AND c.project_id = ${scope.projectId}
      AND ${isMember(actorId)}
    ${lock}
  `);
  return rows[0] ?? null;
}

async function lockChangeset(
  tx: Prisma.TransactionClient,
  actorId: string,
  scope: ProjectScope,
  changesetId: string,
): Promise<Changeset> {
  const changeset = await findChangesetIn(
    tx,
    actorId,
    scope,
    changesetId,
    Prisma.sql`FOR UPDATE OF c`,
  );
  if (!changeset) {
    throw apiError(ErrorCodes.CHANGESET_NOT_FOUND);
  }
  return changeset;
}

async function requireChangeset(
  tx: Prisma.TransactionClient,
  actorId: string,
  scope: ProjectScope,
  changesetId: string,
): Promise<Changeset> {
  const changeset = await findChangesetIn(tx, actorId, scope, changesetId);
  if (!changeset) {
    throw apiError(ErrorCodes.INTERNAL_ERROR);
  }
  return changeset;
}

// ── Reglas de las transiciones ──

/** «Único autor editor en el MVP» ([13]): solo quien lo creó lo edita. */
function assertAuthor(changeset: Changeset, actorId: string) {
  if (changeset.authorId !== actorId) {
    throw apiError(ErrorCodes.FORBIDDEN);
  }
}

function assertAuthorOrReviewer(
  changeset: Changeset,
  actorId: string,
  role: OrganizationRole,
) {
  if (changeset.authorId !== actorId && !can(role, 'changeset.approve')) {
    throw apiError(ErrorCodes.FORBIDDEN);
  }
}

/** Un recibo guardado por esta misma operación; si no lo es, el dato está dañado. */
function storedResult(value: unknown): ApplyResult {
  if (!isApplyResult(value)) {
    throw apiError(ErrorCodes.INTERNAL_ERROR);
  }
  return value;
}

function assertStatus(
  changeset: Changeset,
  allowed: readonly ChangesetStatus[],
) {
  if (!allowed.includes(changeset.status)) {
    throw apiError(ErrorCodes.CHANGESET_STATE_INVALID);
  }
}

function assertVersion(
  changeset: Changeset,
  expected: number,
  code:
    | typeof ErrorCodes.CHANGESET_VERSION_MISMATCH
    | typeof ErrorCodes.CHANGESET_STALE,
) {
  if (changeset.draftVersion !== expected) {
    throw apiError(code);
  }
}

/** El head de la hoja tiene que ser `revisionId`; si no, hay que hacer rebase. */
async function assertHead(
  tx: Prisma.TransactionClient,
  scope: ProjectScope,
  worksheetId: string,
  revisionId: string,
) {
  const rows = await tx.$queryRaw<{ headRevisionId: string }[]>(Prisma.sql`
    SELECT head_revision_id AS "headRevisionId"
    FROM estadistica_forms.worksheets
    WHERE id = ${worksheetId}
      AND organization_id = ${scope.organizationId}
  `);
  if (!rows[0]) {
    throw apiError(ErrorCodes.WORKSHEET_NOT_FOUND);
  }
  if (rows[0].headRevisionId !== revisionId) {
    throw apiError(ErrorCodes.CHANGESET_BASE_OUTDATED);
  }
}

/**
 * Política de aprobación (D6, G8): otra persona, o el propio autor solo si la
 * organización tiene un único miembro. Se guarda en la decisión.
 */
async function approvalPolicy(
  tx: Prisma.TransactionClient,
  scope: ProjectScope,
  changeset: Changeset,
  actorId: string,
): Promise<Decision['policy']> {
  if (changeset.authorId !== actorId) {
    return 'peer';
  }
  const rows = await tx.$queryRaw<{ members: number }[]>(Prisma.sql`
    SELECT count(*)::int AS members
    FROM estadistica_forms.organization_members
    WHERE organization_id = ${scope.organizationId}
  `);
  if (rows[0]?.members !== 1) {
    throw apiError(ErrorCodes.CHANGESET_SELF_APPROVAL);
  }
  return 'single_member';
}

/** La última decisión acepta exactamente este contenido y esta versión. */
async function assertApprovedContent(
  tx: Prisma.TransactionClient,
  changeset: Changeset,
  contentHash: string,
) {
  const rows = await tx.$queryRaw<
    { decision: string; contentHash: string; draftVersion: number }[]
  >(Prisma.sql`
    SELECT decision, content_hash AS "contentHash", draft_version AS "draftVersion"
    FROM estadistica_forms.worksheet_changeset_decisions
    WHERE changeset_id = ${changeset.id}
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `);
  const last = rows[0];
  const isApprovedAsReviewed =
    last?.decision === 'accept' &&
    last.contentHash === contentHash &&
    changeset.contentHash === contentHash &&
    last.draftVersion === changeset.draftVersion;
  if (!isApprovedAsReviewed) {
    throw apiError(ErrorCodes.CHANGESET_STALE);
  }
}

/**
 * Bloquea la hoja y exige que su head siga siendo la base aprobada y la que
 * espera quien aplica. «Tras aprobar, cualquier cambio de head impide aplicar»
 * ([13]): se lanza `HeadChangedError` y el servicio marca el conflicto.
 */
async function lockHeadOrThrow(
  tx: Prisma.TransactionClient,
  changeset: Changeset,
  expectedHeadRevisionId: string,
) {
  const rows = await tx.$queryRaw<{ headRevisionId: string }[]>(Prisma.sql`
    SELECT head_revision_id AS "headRevisionId"
    FROM estadistica_forms.worksheets
    WHERE id = ${changeset.worksheetId}
    FOR UPDATE
  `);
  const head = rows[0]?.headRevisionId;
  if (head !== changeset.baseRevisionId || head !== expectedHeadRevisionId) {
    throw new HeadChangedError();
  }
}

// ── Escritura de la revisión ──

/**
 * La revisión se inserta antes que las filas (las FK de las versiones de fila
 * apuntan a ella) y su conteo se fija al final. Cada fila tocada cierra su
 * versión vigente en la nueva secuencia y abre otra (o un tombstone).
 */
async function writeRevision(
  tx: Prisma.TransactionClient,
  scope: ProjectScope,
  changeset: Changeset,
  headRows: RowValues,
  actorId: string,
  now: string,
): Promise<{ id: string; sequence: number }> {
  const revision = { id: randomUUID(), sequence: changeset.baseSequence + 1 };
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO estadistica_forms.worksheet_revisions
      (id, organization_id, worksheet_id, sequence, schema_version, source,
       row_count, created_by, created_at, changeset_id)
    VALUES (
      ${revision.id}, ${scope.organizationId}, ${changeset.worksheetId},
      ${revision.sequence}, ${changeset.baseSchemaVersion}, 'changeset',
      0, ${actorId}, ${now}, ${changeset.id}
    )
  `);

  for (const write of rowWrites(changeset.operations, headRows)) {
    const sortKey = await closeOpenVersion(
      tx,
      changeset,
      write.rowId,
      revision.sequence,
    );
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO estadistica_forms.worksheet_row_versions
        (organization_id, worksheet_id, row_id, from_sequence, sort_key,
         cell_values, is_deleted)
      VALUES (
        ${scope.organizationId}, ${changeset.worksheetId}, ${write.rowId},
        ${revision.sequence}, ${write.sortKey ?? sortKey ?? write.rowId},
        ${JSON.stringify(write.values)}::jsonb, ${write.isDeleted}
      )
    `);
  }

  await tx.$executeRaw(Prisma.sql`
    UPDATE estadistica_forms.worksheet_revisions
    SET row_count = (
      SELECT count(*)
      FROM estadistica_forms.worksheet_row_versions v
      WHERE v.worksheet_id = ${changeset.worksheetId}
        AND v.from_sequence <= ${revision.sequence}
        AND (v.to_sequence IS NULL OR v.to_sequence > ${revision.sequence})
        AND NOT v.is_deleted
    )
    WHERE id = ${revision.id}
  `);
  await tx.$executeRaw(Prisma.sql`
    UPDATE estadistica_forms.worksheets
    SET head_revision_id = ${revision.id}, generation = generation + 1
    WHERE id = ${changeset.worksheetId}
  `);
  return revision;
}

type RowWrite = Readonly<{
  rowId: string;
  sortKey: string | null;
  values: Readonly<Record<string, unknown>>;
  isDeleted: boolean;
}>;

/** Una escritura por fila tocada, con sus valores finales. */
function rowWrites(
  operations: readonly Operation[],
  headRows: RowValues,
): RowWrite[] {
  const writes = new Map<string, RowWrite>();
  for (const operation of operations) {
    if (operation.type === 'insert_row') {
      writes.set(operation.rowId, {
        rowId: operation.rowId,
        sortKey: operation.sortKey,
        values: operation.values,
        isDeleted: false,
      });
    } else if (operation.type === 'delete_row') {
      writes.set(operation.rowId, {
        rowId: operation.rowId,
        sortKey: null,
        values: {},
        isDeleted: true,
      });
    } else {
      const current =
        writes.get(operation.rowId)?.values ??
        headRows.get(operation.rowId) ??
        {};
      const values = { ...current };
      if (operation.value === null) {
        delete values[operation.columnId];
      } else {
        values[operation.columnId] = operation.value;
      }
      writes.set(operation.rowId, {
        rowId: operation.rowId,
        sortKey: null,
        values,
        isDeleted: false,
      });
    }
  }
  return [...writes.values()];
}

/** Cierra la versión vigente de la fila y devuelve su clave de orden, si había. */
async function closeOpenVersion(
  tx: Prisma.TransactionClient,
  changeset: Changeset,
  rowId: string,
  sequence: number,
): Promise<string | null> {
  const rows = await tx.$queryRaw<{ sortKey: string }[]>(Prisma.sql`
    UPDATE estadistica_forms.worksheet_row_versions
    SET to_sequence = ${sequence}
    WHERE worksheet_id = ${changeset.worksheetId}
      AND row_id = ${rowId}
      AND to_sequence IS NULL
    RETURNING sort_key AS "sortKey"
  `);
  return rows[0]?.sortKey ?? null;
}

async function findRowsIn(
  client: Prisma.TransactionClient,
  scope: ProjectScope,
  worksheetId: string,
  sequence: number,
  rowIds: readonly string[],
): Promise<RowValues> {
  if (rowIds.length === 0) {
    return new Map();
  }
  const rows = await client.$queryRaw<
    { rowId: string; cellValues: Record<string, unknown> }[]
  >(Prisma.sql`
    SELECT row_id AS "rowId", cell_values AS "cellValues"
    FROM estadistica_forms.worksheet_row_versions
    WHERE worksheet_id = ${worksheetId}
      AND organization_id = ${scope.organizationId}
      AND row_id IN (${Prisma.join([...rowIds])})
      AND from_sequence <= ${sequence}
      AND (to_sequence IS NULL OR to_sequence > ${sequence})
      AND NOT is_deleted
  `);
  return new Map(rows.map((row) => [row.rowId, row.cellValues]));
}

async function insertDecision(
  tx: Prisma.TransactionClient,
  scope: ProjectScope,
  changesetId: string,
  decision: Decision,
) {
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO estadistica_forms.worksheet_changeset_decisions
      (id, organization_id, changeset_id, actor_id, decision, content_hash,
       draft_version, head_revision_id, policy, reason, created_at)
    VALUES (
      ${decision.id}, ${scope.organizationId}, ${changesetId}, ${decision.actorId},
      ${decision.decision}, ${decision.contentHash}, ${decision.draftVersion},
      ${decision.headRevisionId}, ${decision.policy}, ${decision.reason},
      ${decision.createdAt}
    )
  `);
}

async function setStatus(
  tx: Prisma.TransactionClient,
  changesetId: string,
  status: ChangesetStatus,
  now: string,
  extra: Prisma.Sql = Prisma.empty,
) {
  await tx.$executeRaw(Prisma.sql`
    UPDATE estadistica_forms.worksheet_changesets
    SET status = ${status}, updated_at = ${now} ${extra}
    WHERE id = ${changesetId}
  `);
}

function audit(
  tx: Prisma.TransactionClient,
  scope: ProjectScope,
  actorId: string,
  changesetId: string,
  action: string,
  now: string,
  details: Readonly<Record<string, unknown>>,
) {
  return recordAuditEvent(tx, {
    organizationId: scope.organizationId,
    actorId,
    action,
    resourceType: 'worksheet_changeset',
    resourceId: changesetId,
    details,
    now,
  });
}
