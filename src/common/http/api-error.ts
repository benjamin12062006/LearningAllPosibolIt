import {
  BadRequestException,
  ConflictException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ErrorCode } from './error-codes.js';
import { API_MESSAGES } from './messages.js';
import {
  publicError,
  type PublicError,
  type ValidationIssue,
} from './public-error.js';

export function apiError(
  code: ErrorCode,
  issues?: ValidationIssue[],
): HttpException {
  const body: PublicError & { issues?: ValidationIssue[] } = publicError(code);
  if (issues && issues.length > 0) body.issues = issues;

  const status = API_MESSAGES[code].status;
  switch (status) {
    case 400:
      return new BadRequestException(body);
    case 401:
      return new UnauthorizedException(body);
    case 404:
      return new NotFoundException(body);
    case 409:
      return new ConflictException(body);
    case 413:
      return new PayloadTooLargeException(body);
    case 500:
      return new InternalServerErrorException(body);
    case 503:
      return new ServiceUnavailableException(body);
    default:
      return new HttpException(body, status);
  }
}
