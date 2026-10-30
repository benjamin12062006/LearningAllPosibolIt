import { ErrorCodes } from '../common/http/error-codes.js';
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from './authenticated-request.js';
import { DescopeSessionGuard } from './descope-session.guard.js';
import { apiError } from '../common/http/api-error.js';

@Controller('auth')
export class AuthController {
  @Get('me')
  @UseGuards(DescopeSessionGuard)
  getCurrentIdentity(@Req() request: AuthenticatedRequest) {
    if (!request.authenticatedIdentity) {
      throw apiError(ErrorCodes.INTERNAL_ERROR);
    }

    return { identity: request.authenticatedIdentity };
  }
}
