import { Controller, Get, UseGuards } from '@nestjs/common';
import type { AuthenticatedIdentity } from './authenticated-request.js';
import { CurrentIdentity } from './current-identity.decorator.js';
import { DescopeSessionGuard } from './descope-session.guard.js';

@Controller('auth')
export class AuthController {
  @Get('me')
  @UseGuards(DescopeSessionGuard)
  getCurrentIdentity(@CurrentIdentity() identity: AuthenticatedIdentity) {
    return { identity };
  }
}
