import { Injectable } from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { rememberForRequest } from '../common/http/request-cache.js';
import type { UpdateProfileDto } from './users.dto.js';
import { UsersRepository } from './users.repository.js';

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  provision(identity: AuthenticatedIdentity) {
    return this.usersRepository.provision(identity);
  }

  /** Se recuerda durante la petición: casi todas las rutas la piden varias veces (C7, G2). */
  async findCurrent(identity: AuthenticatedIdentity) {
    const user = await rememberForRequest(
      `user:${identity.issuer}:${identity.subject}`,
      () => this.usersRepository.findByIdentity(identity),
    );
    if (!user) {
      throw apiError(ErrorCodes.PROFILE_NOT_FOUND);
    }
    return user;
  }

  async updateCurrent(
    identity: AuthenticatedIdentity,
    update: UpdateProfileDto,
  ) {
    const user = await this.usersRepository.updateDisplayName(
      identity,
      update.displayName,
    );
    if (!user) {
      throw apiError(ErrorCodes.PROFILE_NOT_FOUND);
    }
    return user;
  }
}
