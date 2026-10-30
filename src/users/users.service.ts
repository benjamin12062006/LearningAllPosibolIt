import { ErrorCodes } from '../common/http/error-codes.js';
import { Injectable } from '@nestjs/common';
import { apiError } from '../common/http/api-error.js';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { UsersRepository } from './users.repository.js';
import type { UpdateProfileDto } from './users.dto.js';

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  provision(identity: AuthenticatedIdentity) {
    return this.usersRepository.provision(identity);
  }

  async findCurrent(identity: AuthenticatedIdentity) {
    const user = await this.usersRepository.findByIdentity(identity);
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
