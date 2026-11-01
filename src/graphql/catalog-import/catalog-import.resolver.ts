import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import type { AuthenticatedIdentity } from '../../auth/authenticated-request.js';
import { CurrentIdentity } from '../../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../../auth/descope-session.guard.js';
import { uuidParamPipe } from '../../common/http/validation-errors.js';
import { CatalogImportService } from '../../catalog-import/catalog-import.service.js';
import { ImportJobType, ImportSnapshotType } from './catalog-import.graphql.js';

/** Lecturas y borrado; la subida del CSV sigue siendo multipart en REST. */
@Resolver()
@UseGuards(DescopeSessionGuard)
export class CatalogImportResolver {
  constructor(private readonly imports: CatalogImportService) {}

  @Query(() => ImportJobType, { name: 'importJob' })
  async importJob(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Args('projectId', { type: () => ID }, uuidParamPipe('projectId'))
    projectId: string,
    @Args('id', { type: () => ID }, uuidParamPipe('id')) id: string,
  ) {
    const { job } = await this.imports.findJob(identity, projectId, id);
    return job;
  }

  @Query(() => ImportSnapshotType, { name: 'importSnapshot' })
  async importSnapshot(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Args('projectId', { type: () => ID }, uuidParamPipe('projectId'))
    projectId: string,
    @Args('id', { type: () => ID }, uuidParamPipe('id')) id: string,
  ) {
    const { snapshot, sample } = await this.imports.findSnapshot(
      identity,
      projectId,
      id,
    );
    return { ...snapshot, sample };
  }

  /** Borra una importación terminada, igual que `DELETE …/imports/:snapshotId`. */
  @Mutation(() => Boolean, { name: 'deleteImport' })
  async deleteImport(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Args('projectId', { type: () => ID }, uuidParamPipe('projectId'))
    projectId: string,
    @Args('id', { type: () => ID }, uuidParamPipe('id')) id: string,
  ) {
    await this.imports.deleteImport(identity, projectId, id);
    return true;
  }
}
