import { HttpException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ArtifactStore } from '../artifacts/artifact.store.js';
import { CatalogImportService } from '../catalog-import/catalog-import.service.js';
import {
  ErrorCodes,
  isErrorCode,
  type ErrorCode,
} from '../common/http/error-codes.js';
import { publicError } from '../common/http/public-error.js';
import { EvaluationsService } from '../evaluations/evaluations.service.js';
import { ExportsService } from '../exports/exports.service.js';
import { FeedsService } from '../feeds/feeds.service.js';
import type { FeedPolicy } from '../feeds/feeds.types.js';
import { RemoteSourceService } from '../remote-source/remote-source.service.js';
import type { DownloadedSource } from '../remote-source/remote-source.types.js';
import {
  FeedRefreshesRepository,
  type AwaitedJob,
  type EvaluationResult,
} from './feed-refreshes.repository.js';
import {
  LostClaimError,
  type ClaimedRefresh,
  type PlannedIds,
  type RefreshOutcome,
  type RefreshSource,
  type RefreshStage,
} from './feed-refreshes.types.js';
import { checkRefreshPolicy } from './refresh-policy.js';

/**
 * Qué hacer después de un paso que no falló. `done` termina con un resultado
 * (y el motivo, si no se publicó); `finished` significa que el paso ya terminó
 * la actualización dentro de su propia transacción (la publicación, D3).
 */
export type StepResult =
  | Readonly<{ kind: 'advance'; claim: ClaimedRefresh; stage: RefreshStage }>
  | Readonly<{ kind: 'wait' }>
  | Readonly<{ kind: 'done'; outcome: RefreshOutcome; reason?: ErrorCode }>
  | Readonly<{ kind: 'finished' }>;

/**
 * Un paso falló por algo que la actualización conoce. `restartAt` y `forget`
 * dicen desde dónde repetir: una importación fallida obliga a descargar otra
 * vez con ids nuevos; una evaluación fallida, a evaluar otra vez.
 */
export class RefreshStepFailure extends Error {
  readonly detail;

  constructor(
    code: ErrorCode,
    readonly restartAt?: RefreshStage,
    readonly forget: PlannedIds = {},
  ) {
    super(code);
    this.name = 'RefreshStepFailure';
    this.detail = publicError(code);
  }
}

/** Nombre que se guarda como «archivo original» de una importación remota. */
const REMOTE_FILE_NAME = 'fuente-remota.csv';

/**
 * Los pasos de una actualización (D9): descargar e importar, esperar a la
 * importación, evaluar y esperar a la evaluación. Cada paso puede repetirse sin
 * duplicar nada: guarda el id de lo que va a crear antes de crearlo y, al
 * repetirse, comprueba si ya existe.
 */
@Injectable()
export class FeedRefreshSteps {
  constructor(
    private readonly repository: FeedRefreshesRepository,
    private readonly remoteSource: RemoteSourceService,
    private readonly imports: CatalogImportService,
    private readonly evaluations: EvaluationsService,
    private readonly exports: ExportsService,
    private readonly feeds: FeedsService,
    private readonly store: ArtifactStore,
  ) {}

  run(claim: ClaimedRefresh, signal: AbortSignal): Promise<StepResult> {
    switch (claim.stage) {
      case 'fetch':
        return this.fetch(claim, signal);
      case 'import':
        return this.awaitImport(claim);
      case 'evaluate':
        return this.evaluate(claim);
      case 'publish':
        return this.publish(claim);
    }
  }

  // ---------------------------------------------------------------------------
  // fetch: descargar la fuente y aceptarla como importación.
  // ---------------------------------------------------------------------------

  private async fetch(
    claim: ClaimedRefresh,
    signal: AbortSignal,
  ): Promise<StepResult> {
    if (!claim.source) {
      throw new RefreshStepFailure(ErrorCodes.REFRESH_SOURCE_MISSING);
    }
    const planned = await this.planImport(claim);
    const snapshotExists = await this.repository.snapshotExists(
      planned.projectId,
      planned.snapshotId,
    );
    if (!snapshotExists) {
      const download = await this.remoteSource.download(
        claim.source.url,
        signal,
      );
      await this.acceptDownload(planned, claim.source, download);
    }
    return { kind: 'advance', claim: planned, stage: 'import' };
  }

  /** Guarda los ids de snapshot e importación antes de crearlos (D9). */
  private async planImport(claim: ClaimedRefresh) {
    if (claim.snapshotId && claim.importJobId) {
      return {
        ...claim,
        snapshotId: claim.snapshotId,
        importJobId: claim.importJobId,
      };
    }
    const ids = { snapshotId: randomUUID(), importJobId: randomUUID() };
    await this.save(claim, ids);
    return { ...claim, ...ids };
  }

  /**
   * Entra por el mismo camino que una subida. Si `accept` falla, el archivo
   * descargado puede seguir en `tmp/`: se retira (borrar uno que ya no está no
   * es un error).
   */
  private async acceptDownload(
    claim: ClaimedRefresh & { snapshotId: string; importJobId: string },
    source: RefreshSource,
    download: DownloadedSource,
  ) {
    try {
      await this.imports.accept(
        claim.ownerId,
        claim.projectId,
        { ...download, originalname: REMOTE_FILE_NAME },
        { idColumn: source.idColumn, delimiter: source.delimiter },
        claim.id,
        { snapshotId: claim.snapshotId, jobId: claim.importJobId },
      );
    } catch (error) {
      await this.store.removeTemporary(download.filename);
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // import: esperar a que el worker de importaciones termine.
  // ---------------------------------------------------------------------------

  private async awaitImport(claim: ClaimedRefresh): Promise<StepResult> {
    const job = claim.importJobId
      ? await this.repository.findImportJob(claim.projectId, claim.importJobId)
      : null;
    if (!job) {
      // Se borró la importación (o nunca llegó a aceptarse): descargar otra vez.
      throw restartFromFetch(ErrorCodes.REFRESH_IMPORT_MISSING);
    }
    if (isFinishedWith(job, 'failed')) {
      throw restartFromFetch(
        failureCodeOf(job, ErrorCodes.IMPORT_PROCESSING_FAILED),
      );
    }
    if (isFinishedWith(job, 'succeeded')) {
      return { kind: 'advance', claim, stage: 'evaluate' };
    }
    return { kind: 'wait' };
  }

  // ---------------------------------------------------------------------------
  // evaluate: encolar la evaluación y esperar a que termine.
  // ---------------------------------------------------------------------------

  private async evaluate(claim: ClaimedRefresh): Promise<StepResult> {
    const evaluation = claim.evaluationId
      ? await this.repository.findEvaluation(
          claim.projectId,
          claim.evaluationId,
        )
      : null;
    if (!evaluation) {
      await this.acceptEvaluation(claim);
      return { kind: 'wait' };
    }
    if (isFinishedWith(evaluation, 'failed')) {
      const code = failureCodeOf(
        evaluation,
        ErrorCodes.EVALUATION_PROCESSING_FAILED,
      );
      throw new RefreshStepFailure(code, 'evaluate', {
        evaluationId: null,
      });
    }
    if (isFinishedWith(evaluation, 'succeeded')) {
      return { kind: 'advance', claim, stage: 'publish' };
    }
    return { kind: 'wait' };
  }

  /**
   * Guarda el id de la evaluación antes de encolarla. Si el proyecto tiene otra
   * evaluación activa, `acceptPlanned` responde 409 y la actualización espera
   * (D4, R2); al repetir, el id guardado se reutiliza.
   */
  private async acceptEvaluation(claim: ClaimedRefresh) {
    const { rulesetRevision } = requirePolicy(claim);
    if (!claim.snapshotId) {
      throw restartFromFetch(ErrorCodes.REFRESH_IMPORT_MISSING);
    }
    const evaluationId = claim.evaluationId ?? randomUUID();
    if (!claim.evaluationId) {
      await this.save(claim, { evaluationId });
    }
    await this.evaluations.acceptPlanned({
      evaluationId,
      ownerId: claim.ownerId,
      projectId: claim.projectId,
      snapshotId: claim.snapshotId,
      rulesetRevision,
    });
  }

  // ---------------------------------------------------------------------------
  // publish: comprobar la política, exportar y publicar (D11).
  // ---------------------------------------------------------------------------

  /**
   * Si la política no se cumple, termina como `needs_review` sin tocar el feed.
   * Si se cumple, exporta con lo que la política aprueba y publica con la
   * generación leída al disparar; el reclamo se comprueba y se cierra dentro de
   * la transacción que mueve el puntero (D3).
   */
  private async publish(claim: ClaimedRefresh): Promise<StepResult> {
    const policy = requirePolicy(claim);
    if (claim.expectedGeneration === null) {
      // Sin la generación del disparo no se puede saber si alguien publicó
      // entretanto: no se publica.
      return {
        kind: 'done',
        outcome: 'conflict',
        reason: ErrorCodes.REFRESH_PUBLICATION_CONFLICT,
      };
    }
    const evaluation = await this.requireEvaluationResult(claim);
    const publishedRowCount = await this.repository.findPublishedRowCount(
      claim.feedId,
    );

    const violation = checkRefreshPolicy(policy, evaluation, publishedRowCount);
    if (violation) {
      return { kind: 'done', outcome: 'needs_review', reason: violation };
    }

    const exportId = await this.exportApproved(claim, evaluation);
    return this.publishExport(claim, exportId, claim.expectedGeneration);
  }

  /** La evaluación existe y terminó bien: si no, evaluar otra vez. */
  private async requireEvaluationResult(
    claim: ClaimedRefresh,
  ): Promise<EvaluationResult & { evaluationId: string }> {
    const evaluation = claim.evaluationId
      ? await this.repository.findEvaluationResult(
          claim.projectId,
          claim.evaluationId,
        )
      : null;
    if (!claim.evaluationId || !evaluation) {
      throw new RefreshStepFailure(
        ErrorCodes.EVALUATION_RESULTS_UNAVAILABLE,
        'evaluate',
        { evaluationId: null },
      );
    }
    return { ...evaluation, evaluationId: claim.evaluationId };
  }

  /**
   * La política sustituye a la aprobación del operador: se aprueba exactamente
   * lo que la evaluación contó. Si ya existía la exportación, se reutiliza.
   */
  private async exportApproved(
    claim: ClaimedRefresh,
    evaluation: EvaluationResult & { evaluationId: string },
  ) {
    const created = await this.exports.createForOwner(
      claim.ownerId,
      claim.projectId,
      {
        evaluationId: evaluation.evaluationId,
        resultChecksum: evaluation.resultChecksum,
        acceptedInvalidCount: evaluation.invalid,
        acceptedExcludedCount: evaluation.excluded,
      },
    );
    return created.export.id;
  }

  private async publishExport(
    claim: ClaimedRefresh,
    exportId: string,
    expectedGeneration: number,
  ): Promise<StepResult> {
    try {
      const result = await this.feeds.publishForRefresh({
        ownerId: claim.ownerId,
        projectId: claim.projectId,
        feedId: claim.feedId,
        exportId,
        expectedGeneration,
        confirm: (tx) => this.repository.finishPublished(tx, claim),
      });
      return result === 'published'
        ? { kind: 'finished' }
        : { kind: 'done', outcome: 'unchanged' };
    } catch (error) {
      if (isGenerationConflict(error)) {
        return {
          kind: 'done',
          outcome: 'conflict',
          reason: ErrorCodes.REFRESH_PUBLICATION_CONFLICT,
        };
      }
      throw error;
    }
  }

  private async save(claim: ClaimedRefresh, ids: PlannedIds) {
    if (!(await this.repository.savePlannedIds(claim, ids))) {
      throw new LostClaimError();
    }
  }
}

/** La política aprobada; si se quitó después de disparar, no se puede seguir. */
function requirePolicy(claim: ClaimedRefresh): FeedPolicy {
  if (!claim.policy) {
    throw new RefreshStepFailure(ErrorCodes.REFRESH_POLICY_MISSING);
  }
  return claim.policy;
}

/** El operador publicó entretanto: la generación ya no es la del disparo. */
function isGenerationConflict(error: unknown) {
  if (!(error instanceof HttpException)) {
    return false;
  }
  const response = error.getResponse();
  return (
    typeof response === 'object' &&
    'code' in response &&
    response.code === ErrorCodes.FEED_GENERATION_CONFLICT
  );
}

/** La importación terminó mal o desapareció: otra descarga, con ids nuevos. */
function restartFromFetch(code: ErrorCode) {
  return new RefreshStepFailure(code, 'fetch', {
    snapshotId: null,
    importJobId: null,
    evaluationId: null,
  });
}

function isFinishedWith(job: AwaitedJob, status: 'succeeded' | 'failed') {
  return job.status === status;
}

/**
 * El código público con el que terminó la importación o la evaluación; decide
 * si se reintenta (`IMPORT_INTERRUPTED`) o no (`CSV_DUPLICATE_ID`). Si faltara,
 * `fallback`: un fallo de procesamiento, que se reintenta con límite.
 */
function failureCodeOf(job: AwaitedJob, fallback: ErrorCode): ErrorCode {
  return isErrorCode(job.errorCode) ? job.errorCode : fallback;
}
