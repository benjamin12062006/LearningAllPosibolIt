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
import { UsersService } from '../users/users.service.js';
import type { CreateProjectDto, UpdateProjectDto } from './projects.dto.js';
import {
  ProjectsRepository,
  type ProjectIdempotency,
} from './projects.repository.js';
import {
  hasCompleteConfiguration,
  type ConfiguredProject,
} from './projects.types.js';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly usersService: UsersService,
    private readonly projectsRepository: ProjectsRepository,
  ) {}

  async findAll(identity: AuthenticatedIdentity, query?: Partial<PageRequest>) {
    const owner = await this.usersService.findCurrent(identity);
    const page = resolvePage(query);
    const rows = await this.projectsRepository.findAllByOwner(
      owner.id,
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

  async findOwned(identity: AuthenticatedIdentity, id: string) {
    const owner = await this.usersService.findCurrent(identity);
    const project = await this.projectsRepository.findByOwner(owner.id, id);
    if (!project) {
      throw apiError(ErrorCodes.PROJECT_NOT_FOUND);
    }
    return project;
  }

  async update(
    identity: AuthenticatedIdentity,
    id: string,
    input: UpdateProjectDto,
  ) {
    const owner = await this.usersService.findCurrent(identity);
    const current = await this.projectsRepository.findByOwner(owner.id, id);
    if (!current) {
      throw apiError(ErrorCodes.PROJECT_NOT_FOUND);
    }

    assertUpdateIsValid(input);

    const project = await this.projectsRepository.update(owner.id, id, input);
    if (!project) {
      throw apiError(ErrorCodes.PROJECT_NOT_FOUND);
    }
    return project;
  }

  /** Las importaciones necesitan país, moneda y canal. */
  async requireConfigured(
    identity: AuthenticatedIdentity,
    id: string,
  ): Promise<ConfiguredProject> {
    const project = await this.findOwned(identity, id);
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
