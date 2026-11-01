import { Body, Controller, Get, Patch, Put, UseGuards } from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { CurrentIdentity } from '../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../auth/descope-session.guard.js';
import { UpdateProfileDto } from './users.dto.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @UseGuards(DescopeSessionGuard)
  async getCurrentUser(@CurrentIdentity() identity: AuthenticatedIdentity) {
    return { user: await this.usersService.findCurrent(identity) };
  }

  @Put('me')
  @UseGuards(DescopeSessionGuard)
  async provisionCurrentUser(
    @CurrentIdentity() identity: AuthenticatedIdentity,
  ) {
    return { user: await this.usersService.provision(identity) };
  }

  @Patch('me')
  @UseGuards(DescopeSessionGuard)
  async updateCurrentUser(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Body() body: UpdateProfileDto,
  ) {
    return { user: await this.usersService.updateCurrent(identity, body) };
  }
}
