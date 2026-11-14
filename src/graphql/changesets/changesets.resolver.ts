import { UseGuards } from '@nestjs/common';
import {
  Args,
  Mutation,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import type { AuthenticatedIdentity } from '../../auth/authenticated-request.js';
import { CurrentIdentity } from '../../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../../auth/descope-session.guard.js';
import { ChangesetsService } from '../../changesets/changesets.service.js';
import type { Changeset } from '../../changesets/changesets.types.js';
import type { ProjectScope } from '../../worksheets/worksheets.types.js';
import { IdArg } from '../common/id-args.js';
import {
  AppliedChangesetType,
  ApplyChangesetInput,
  ChangesetDecisionResultType,
  ChangesetReviewType,
  ChangesetType,
  CreateChangesetInput,
  DecisionInput,
  DraftVersionInput,
  RebaseInput,
  SaveOperationsInput,
} from './changesets.graphql.js';

/** El borrador con su ámbito, para su campo `diff`. */
type ScopedChangeset = Changeset & Readonly<{ scope: ProjectScope }>;

/**
 * Borradores por GraphQL (C7.4): el ciclo entero de un cambio en una hoja
 * (crear, guardar, revisar, enviar, decidir, aplicar, rebase y revertir) con
 * el mismo servicio que REST. Lo que REST manda en cabeceras va en la entrada:
 * la versión del borrador (`If-Match`) y la clave de idempotencia al aplicar.
 */
@Resolver(() => ChangesetType)
@UseGuards(DescopeSessionGuard)
export class ChangesetsResolver {
  constructor(private readonly changesets: ChangesetsService) {}

  @Query(() => ChangesetType, { name: 'changeset' })
  async findOne(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('id') id: string,
  ): Promise<ScopedChangeset> {
    const scope = { organizationId, projectId };
    return { ...(await this.changesets.find(identity, scope, id)), scope };
  }

  @Mutation(() => ChangesetType, { name: 'createChangeset' })
  async create(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('worksheetId') worksheetId: string,
    @Args('input', { type: () => CreateChangesetInput })
    input: CreateChangesetInput,
  ): Promise<ScopedChangeset> {
    const scope = { organizationId, projectId };
    const changeset = await this.changesets.create(
      identity,
      scope,
      worksheetId,
      input.title,
    );
    return { ...changeset, scope };
  }

  /** Reemplaza las operaciones si `draftVersion` sigue siendo la del borrador. */
  @Mutation(() => ChangesetType, { name: 'saveChangesetOperations' })
  async saveOperations(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('id') id: string,
    @Args('input', { type: () => SaveOperationsInput })
    input: SaveOperationsInput,
  ): Promise<ScopedChangeset> {
    const scope = { organizationId, projectId };
    const changeset = await this.changesets.saveOperations(
      identity,
      scope,
      id,
      // El mismo valor que lleva `If-Match` en REST.
      `"${input.draftVersion}"`,
      input.operations,
    );
    return { ...changeset, scope };
  }

  @Mutation(() => ChangesetType, { name: 'submitChangeset' })
  async submit(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('id') id: string,
    @Args('input', { type: () => DraftVersionInput }) input: DraftVersionInput,
  ): Promise<ScopedChangeset> {
    const scope = { organizationId, projectId };
    const changeset = await this.changesets.submit(
      identity,
      scope,
      id,
      input.draftVersion,
    );
    return { ...changeset, scope };
  }

  @Mutation(() => ChangesetType, { name: 'reopenChangeset' })
  async reopen(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('id') id: string,
    @Args('input', { type: () => DraftVersionInput }) input: DraftVersionInput,
  ): Promise<ScopedChangeset> {
    const scope = { organizationId, projectId };
    const changeset = await this.changesets.reopen(
      identity,
      scope,
      id,
      input.draftVersion,
    );
    return { ...changeset, scope };
  }

  @Mutation(() => ChangesetType, { name: 'cancelChangeset' })
  async cancel(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('id') id: string,
  ): Promise<ScopedChangeset> {
    const scope = { organizationId, projectId };
    return { ...(await this.changesets.cancel(identity, scope, id)), scope };
  }

  /** Aceptar o rechazar lo enviado (Manager). */
  @Mutation(() => ChangesetDecisionResultType, { name: 'decideChangeset' })
  async decide(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('id') id: string,
    @Args('input', { type: () => DecisionInput }) input: DecisionInput,
  ) {
    const scope = { organizationId, projectId };
    const { decision, changeset } = await this.changesets.decide(
      identity,
      scope,
      id,
      input,
    );
    return { decision, changeset: { ...changeset, scope } };
  }

  /** Aplica lo aceptado en una revisión nueva; repetirlo con la misma clave no aplica otra vez. */
  @Mutation(() => AppliedChangesetType, { name: 'applyChangeset' })
  apply(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('id') id: string,
    @Args('input', { type: () => ApplyChangesetInput })
    input: ApplyChangesetInput,
  ) {
    return this.changesets.apply(
      identity,
      { organizationId, projectId },
      id,
      input.idempotencyKey,
      input,
    );
  }

  @Mutation(() => ChangesetType, { name: 'rebaseChangeset' })
  async rebase(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('id') id: string,
    @Args('input', { type: () => RebaseInput }) input: RebaseInput,
  ): Promise<ScopedChangeset> {
    const scope = { organizationId, projectId };
    const changeset = await this.changesets.rebase(
      identity,
      scope,
      id,
      input.draftVersion,
      input.resolutions ?? [],
    );
    return { ...changeset, scope };
  }

  /** Crea un borrador que deshace esa revisión; no aplica nada. */
  @Mutation(() => ChangesetType, { name: 'proposeRevert' })
  async proposeRevert(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('revisionId') revisionId: string,
  ): Promise<ScopedChangeset> {
    const scope = { organizationId, projectId };
    const changeset = await this.changesets.proposeRevert(
      identity,
      scope,
      revisionId,
    );
    return { ...changeset, scope };
  }

  /** El borrador y su diff en una llamada, como `GET …/diff`. */
  @ResolveField(() => ChangesetReviewType, { name: 'diff' })
  diff(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Parent() changeset: ScopedChangeset,
  ) {
    return this.changesets.review(identity, changeset.scope, changeset.id);
  }
}
