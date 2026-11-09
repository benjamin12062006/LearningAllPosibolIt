import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { parseIdempotencyKey } from '../common/http/idempotency-key.js';
import {
  fetchWindow,
  resolvePage,
  toPage,
  type PageRequest,
} from '../common/http/pagination.js';
import type { OrganizationPermission } from '../organizations/organization-roles.js';
import { UsersService } from '../users/users.service.js';
import { assertProjectPermission } from './project-access.js';
import type { CreateProjectDto, UpdateProjectDto } from './projects.dto.js';
import {
  ProjectsRepository,
  type ProjectIdempotency,
} from './projects.repository.js';
import {
  hasCompleteConfiguration,
  type ConfiguredProject,
  type Project,
} from './projects.types.js';

/** Quién actúa y sobre qué proyecto, ya comprobado su permiso. */
export type ProjectActor = Readonly<{ actorId: string; project: Project }>;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly usersService: UsersService,
    private readonly projectsRepository: ProjectsRepository,
  ) {}

  /** Los proyectos de todas las organizaciones de la persona (C6). */
  async findAll(identity: AuthenticatedIdentity, query?: Partial<PageRequest>) {
    const user = await this.usersService.findCurrent(identity);
    const page = resolvePage(query);
    const rows = await this.projectsRepository.findAllForMember(
      user.id,
      fetchWindow(page),
    );
    return toPage(rows, page);
  }

  /**
   * Sin `idempotencyKey`, como siempre. Con ella, repetir la petición (un doble
   * clic) devuelve el mismo proyecto en lugar de crear otro.
   */
  async create(
    identity: AuthenticatedIdentity,
    input: CreateProjectDto,
    idempotencyKey?: string,
  ) {
    const owner = await this.usersService.findCurrent(identity);
    const configuration = {
      country: input.country,
      currency: input.currency,
      channelProfile: input.channelProfile,
    };
    if (idempotencyKey === undefined) {
      return this.projectsRepository.create(
        owner.id,
        input.name,
        configuration,
      );
    }
    return this.projectsRepository.create(
      owner.id,
      input.name,
      configuration,
      idempotencyOf(idempotencyKey, input),
    );
  }

  /** Lo ve cualquier miembro de su organización; si no, 404 (C6). */
  async findVisible(
    identity: AuthenticatedIdentity,
    id: string,
  ): Promise<Project> {
    const { project } = await this.requireAccess(
      identity,
      id,
      'organization.read',
    );
    return project;
  }

  /**
   * La puerta de las rutas de `/projects/:projectId/…` (C6, E1.2): miembro
   * (404), organización activa para escribir (409) y el permiso (403). Quien
   * creó el proyecto ya no tiene acceso por serlo.
   */
  async requireAccess(
    identity: AuthenticatedIdentity,
    projectId: string,
    permission: OrganizationPermission,
  ): Promise<ProjectActor> {
    const user = await this.usersService.findCurrent(identity);
    const access = await this.projectsRepository.findAccess(user.id, projectId);
    assertProjectPermission(access, permission);
    const project = await this.projectsRepository.findVisible(
      user.id,
      projectId,
    );
    if (!project) {
      throw apiError(ErrorCodes.PROJECT_NOT_FOUND);
    }
    return { actorId: user.id, project };
  }

  /** Cambiar el nombre o la configuración del canal: Manager o más (C6). */
  async update(
    identity: AuthenticatedIdentity,
    id: string,
    input: UpdateProjectDto,
  ) {
    const { actorId } = await this.requireAccess(
      identity,
      id,
      'changeset.approve',
    );

    assertUpdateIsValid(input);

    const project = await this.projectsRepository.update(actorId, id, input);
    if (!project) {
      throw apiError(ErrorCodes.PROJECT_NOT_FOUND);
    }
    return project;
  }

  /**
   * Las importaciones necesitan país, moneda y canal, y que quien importa
   * pueda preparar trabajo (Editor o más, C6).
   */
  async requireConfigured(
    identity: AuthenticatedIdentity,
    id: string,
    permission: OrganizationPermission = 'worksheet.write',
  ): Promise<ConfiguredProject> {
    const { project } = await this.requireAccess(identity, id, permission);
    if (!hasCompleteConfiguration(project)) {
      throw apiError(ErrorCodes.PROJECT_CONFIGURATION_REQUIRED);
    }
    return project;
  }
}

/**
 * La configuración se cambia completa (los tres campos) o no se cambia, y una
 * actualización tiene que traer al menos un nombre o una configuración.
 */
function assertUpdateIsValid(input: UpdateProjectDto) {
  const configurationFields = countConfigurationFields(input);
  const changesConfiguration = configurationFields > 0;

  if (changesConfiguration && configurationFields < 3) {
    throw apiError(ErrorCodes.PROJECT_CONFIGURATION_INCOMPLETE);
  }
  if (input.name === undefined && !changesConfiguration) {
    throw apiError(ErrorCodes.PROJECT_UPDATE_EMPTY);
  }
}

function countConfigurationFields(input: UpdateProjectDto) {
  const fields = [input.country, input.currency, input.channelProfile];
  return fields.filter((value) => value !== undefined).length;
}

/** El hash del cuerpo ya validado: la misma clave con otro proyecto es otra petición. */
function idempotencyOf(
  idempotencyKey: string,
  input: CreateProjectDto,
): ProjectIdempotency {
  const canonical = [
    input.name,
    input.country,
    input.currency,
    input.channelProfile,
  ];
  return {
    key: parseIdempotencyKey(idempotencyKey),
    payloadHash: createHash('sha256')
      .update(JSON.stringify(canonical))
      .digest('hex'),
  };
}
