import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import type { AuthenticatedIdentity } from '../../auth/authenticated-request.js';
import { CurrentIdentity } from '../../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../../auth/descope-session.guard.js';
import { UpdateMeInput, UserType } from './users.graphql.js';
import { UsersService } from '../../users/users.service.js';

@Resolver(() => UserType)
@UseGuards(DescopeSessionGuard)
export class UsersResolver {
  constructor(private readonly usersService: UsersService) {}

  @Query(() => UserType, { name: 'me' })
  me(@CurrentIdentity() identity: AuthenticatedIdentity) {
    return this.usersService.findCurrent(identity);
  }

  @Mutation(() => UserType, { name: 'updateMe' })
  updateMe(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Args('input', { type: () => UpdateMeInput }) input: UpdateMeInput,
  ) {
    return this.usersService.updateCurrent(identity, input);
  }
}
