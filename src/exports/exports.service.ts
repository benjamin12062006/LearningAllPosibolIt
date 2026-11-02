import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { ArtifactStore, isMissingFile } from '../artifacts/artifact.store.js';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { ProjectsService } from '../projects/projects.service.js';
import { UsersService } from '../users/users.service.js';
import { assertCanExport, type ExportApproval } from './export-approval.js';
import type { CreateExportDto } from './exports.dto.js';
import { ExportsRepository } from './exports.repository.js';
import type { ExportView, NewExport } from './exports.types.js';
import { buildProductsTsv } from './products-tsv.js';

type SavedExport = Readonly<{ export: ExportView; created: boolean }>;

export type ExportDownload = Readonly<{ content: Readable; byteSize: number }>;

@Injectable()
export class ExportsService {
  private readonly logger = new Logger(ExportsService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly projectsService: ProjectsService,
    private readonly repository: ExportsRepository,
    private readonly store: ArtifactStore,
  ) {}

  /**
   * Exporta la evaluación aprobada (D7): comprobar, escribir el TSV fuera de la
   * transacción y guardar la fila con la evaluación bloqueada. Si la evaluación
   * ya tenía exportación, devuelve esa (`created: false`).
   */
  async create(
    identity: AuthenticatedIdentity,
    projectId: string,
    input: CreateExportDto,
  ) {
    const owner = await this.usersService.findCurrent(identity);
    await this.projectsService.findOwned(identity, projectId);
    const approval = toApproval(input);
    assertCanExport(
      await this.repository.findEvaluationToExport(
        owner.id,
        projectId,
        input.evaluationId,
      ),
      approval,
    );

    const saved =
      (await this.findExisting(input.evaluationId)) ??
      (await this.generateAndSave({
        ownerId: owner.id,
        projectId,
        evaluationId: input.evaluationId,
        approval,
      }));

    return {
      ...saved,
      downloadUrl: `/api/v1/projects/${projectId}/exports/${saved.export.id}/productos.tsv`,
    };
  }

  async findOne(
    identity: AuthenticatedIdentity,
    projectId: string,
    exportId: string,
  ) {
    const owner = await this.usersService.findCurrent(identity);
    await this.projectsService.findOwned(identity, projectId);
    const found = await this.repository.findByOwner(
      owner.id,
      projectId,
      exportId,
    );
    if (!found) {
      throw apiError(ErrorCodes.EXPORT_NOT_FOUND);
    }
    return found;
  }

  /** El TSV de una exportación del propietario, ya abierto (D9, R2). */
  async openDownload(
    identity: AuthenticatedIdentity,
    projectId: string,
    exportId: string,
  ): Promise<ExportDownload> {
    const owner = await this.usersService.findCurrent(identity);
    await this.projectsService.findOwned(identity, projectId);
    const file = await this.repository.findFileByOwner(
      owner.id,
      projectId,
      exportId,
    );
    if (!file) {
      throw apiError(ErrorCodes.EXPORT_NOT_FOUND);
    }
    return {
      content: await this.openFile(exportId, file.artifactKey),
      byteSize: file.byteSize,
    };
  }

  private async findExisting(
    evaluationId: string,
  ): Promise<SavedExport | null> {
    const existing = await this.repository.findByEvaluation(evaluationId);
    return existing ? { export: existing, created: false } : null;
  }

  private async generateAndSave(
    target: Pick<
      NewExport,
      'ownerId' | 'projectId' | 'evaluationId' | 'approval'
    >,
  ): Promise<SavedExport> {
    const tsv = buildProductsTsv(
      await this.repository.findValidRows(target.evaluationId),
    );
    const file = await this.store.writeExport(tsv.content);

    return this.save({
      ...target,
      id: randomUUID(),
      rowCount: tsv.rowCount,
      file,
      createdAt: new Date().toISOString(),
    });
  }

  /**
   * El TSV ya está escrito. Si la fila no se guarda, nadie lo referencia y se
   * borra; si otra petición guardó antes la exportación de esta evaluación, se
   * devuelve esa.
   */
  private async save(record: NewExport): Promise<SavedExport> {
    let saved: ExportView | null;
    try {
      saved = await this.repository.insert(record);
    } catch (error) {
      await this.discardFile(record.file.key);
      throw error;
    }

    if (saved) {
      return { export: saved, created: true };
    }
    await this.discardFile(record.file.key);
    return this.requireExisting(record.evaluationId);
  }

  /**
   * La fila existe pero el archivo no: es un fallo del almacenamiento, no del
   * cliente. Se registra sin datos del catálogo y se responde 503.
   */
  private async openFile(exportId: string, key: string) {
    try {
      return await this.store.openExport(key);
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
      this.logger.error({ code: 'EXPORT_FILE_MISSING', exportId });
      throw apiError(ErrorCodes.EXPORT_FILE_UNAVAILABLE);
    }
  }

  /** Si no se puede borrar, queda sin referencia y lo retira la limpieza de huérfanos. */
  private async discardFile(key: string) {
    try {
      await this.store.removeExport(key);
    } catch {
      this.logger.error({ code: 'EXPORT_FILE_DISCARD_FAILED' });
    }
  }

  /**
   * `insert` solo devuelve `null` por el índice único de la evaluación, así que
   * la exportación ganadora tiene que existir.
   */
  private async requireExisting(evaluationId: string): Promise<SavedExport> {
    const existing = await this.findExisting(evaluationId);
    if (!existing) {
      throw new Error('Choque de unicidad sin exportación de la evaluación.');
    }
    return existing;
  }
}

function toApproval(input: CreateExportDto): ExportApproval {
  return {
    resultChecksum: input.resultChecksum,
    acceptedInvalidCount: input.acceptedInvalidCount,
    acceptedExcludedCount: input.acceptedExcludedCount,
  };
}
