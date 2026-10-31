import { ErrorCodes, isErrorCode, type ErrorCode } from './error-codes.js';
import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { toGraphQLError } from '../../graphql/common/graphql-error.js';
import { API_MESSAGES } from './messages.js';
import {
  ApplicationFailure,
  publicError,
  type PublicError,
  type ValidationIssue,
} from './public-error.js';

const MAX_ISSUE_FIELD_LENGTH = 128;

const fallbackCodesByStatus: Record<number, ErrorCode> = {
  400: ErrorCodes.BAD_REQUEST,
  401: ErrorCodes.AUTH_SESSION_INVALID,
  403: ErrorCodes.FORBIDDEN,
  404: ErrorCodes.ROUTE_NOT_FOUND,
  408: ErrorCodes.REQUEST_TIMEOUT,
  413: ErrorCodes.PAYLOAD_TOO_LARGE,
  415: ErrorCodes.UNSUPPORTED_MEDIA_TYPE,
  429: ErrorCodes.RATE_LIMITED,
  500: ErrorCodes.INTERNAL_ERROR,
  503: ErrorCodes.SERVICE_UNAVAILABLE,
};

type ExceptionDetails = {
  status: number;
  body: Record<string, unknown>;
};

type HttpErrorResponse = PublicError & {
  statusCode: number;
  issues?: ValidationIssue[];
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(error: unknown, host: ArgumentsHost) {
    if (host.getType<string>() === 'graphql') return this.catchGraphQL(error);

    const http = host.switchToHttp();
    const request = http.getRequest<Request & { importRequestId?: string }>();
    const response = http.getResponse<Response>();
    const requestId = request.importRequestId ?? randomUUID();

    const { status, body } = getExceptionDetails(error);
    const code = resolveErrorCode(body.code, status);
    const issues = readValidationIssues(code, body);

    if (status >= 500) this.logger.error({ code, requestId });
    if (response.headersSent) {
      response.end();
      return;
    }

    const responseBody: HttpErrorResponse = {
      statusCode: status,
      ...publicError(code),
    };
    if (issues.length > 0) responseBody.issues = issues;
    responseBody.requestId = requestId;

    response.status(status).json(responseBody);
  }

  /** En GraphQL el filtro devuelve el error; graphql-js lo registra en `errors`. */
  private catchGraphQL(error: unknown) {
    const requestId = randomUUID();
    const { status, body } = getExceptionDetails(error);
    const code = resolveErrorCode(body.code, status);
    if (status >= 500) this.logger.error({ code, requestId });
    return toGraphQLError(code, requestId, readValidationIssues(code, body));
  }
}

function getExceptionDetails(error: unknown): ExceptionDetails {
  if (error instanceof HttpException) {
    const status = error.getStatus();
    const body = error.getResponse();
    if (typeof body === 'object' && body !== null) {
      return { status, body: body as Record<string, unknown> };
    }
    return { status, body: {} };
  }

  if (error instanceof ApplicationFailure) {
    return {
      status: API_MESSAGES[error.detail.code].status,
      body: error.detail,
    };
  }

  return { status: 500, body: {} };
}

function resolveErrorCode(code: unknown, status: number): ErrorCode {
  if (isErrorCode(code)) return code;
  return fallbackCodesByStatus[status] ?? ErrorCodes.HTTP_ERROR;
}

function readValidationIssues(
  code: ErrorCode,
  body: Record<string, unknown>,
): ValidationIssue[] {
  if (
    code !== ErrorCodes.VALIDATION_FAILED &&
    code !== ErrorCodes.INVALID_UUID
  ) {
    return [];
  }
  if (!Array.isArray(body.issues)) return [];

  const issues: ValidationIssue[] = [];
  for (const issue of body.issues) {
    if (!isValidationIssue(issue)) continue;
    issues.push({
      field: issue.field.slice(0, MAX_ISSUE_FIELD_LENGTH),
      ...publicError(issue.code),
    });
  }
  return issues;
}

function isValidationIssue(
  value: unknown,
): value is { field: string; code: ErrorCode } {
  if (typeof value !== 'object' || value === null) return false;
  if (!('field' in value) || typeof value.field !== 'string') return false;
  return 'code' in value && isErrorCode(value.code);
}
