import { ErrorCodes } from '../common/http/error-codes.js';
import { Injectable } from '@nestjs/common';
import { apiError } from '../common/http/api-error.js';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { UsersService } from '../users/users.service.js';
import type { CreateProjectDto, UpdateProjectDto } from './projects.dto.js';
import { ProjectsRepository } from './projects.repository.js';
import type { ConfiguredProject } from './projects.types.js';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly usersService: UsersService,
    private readonly projectsRepository: ProjectsRepository,
  ) {}

  async findAll(identity: AuthenticatedIdentity) {
    const owner = await this.usersService.findCurrent(identity);
    return this.projectsRepository.findAllByOwner(owner.id);
  }

  async create(identity: AuthenticatedIdentity, input: CreateProjectDto) {
    const owner = await this.usersService.findCurrent(identity);
    return this.projectsRepository.create(owner.id, input.name, {
      country: input.country,
      currency: input.currency,
      channelProfile: input.channelProfile,
    });
  }

  async findOwned(identity: AuthenticatedIdentity, id: string) {
    const owner = await this.usersService.findCurrent(identity);
    const project = await this.projectsRepository.findByOwner(owner.id, id);
    if (!project) throw apiError(ErrorCodes.PROJECT_NOT_FOUND);
    return project;
  }

  async update(
    identity: AuthenticatedIdentity,
    id: string,
    input: UpdateProjectDto,
  ) {
    const owner = await this.usersService.findCurrent(identity);
    const current = await this.projectsRepository.findByOwner(owner.id, id);
    if (!current) throw apiError(ErrorCodes.PROJECT_NOT_FOUND);

    const fields = [input.country, input.currency, input.channelProfile];
    const count = fields.filter((value) => value !== undefined).length;
    if (count > 0 && count < 3) {
      throw apiError(ErrorCodes.PROJECT_CONFIGURATION_INCOMPLETE);
    }
    if (input.name === undefined && count === 0) {
      throw apiError(ErrorCodes.PROJECT_UPDATE_EMPTY);
    }

    const project = await this.projectsRepository.update(owner.id, id, input);
    if (!project) throw apiError(ErrorCodes.PROJECT_NOT_FOUND);
    return project;
  }

  async requireConfigured(
    identity: AuthenticatedIdentity,
    id: string,
  ): Promise<ConfiguredProject> {
    const project = await this.findOwned(identity, id);
    if (
      project.country === null ||
      project.currency === null ||
      project.channelProfile === null
    ) {
      throw apiError(ErrorCodes.PROJECT_CONFIGURATION_REQUIRED);
    }
    return {
      ...project,
      country: project.country,
      currency: project.currency,
      channelProfile: project.channelProfile,
    };
  }
}
