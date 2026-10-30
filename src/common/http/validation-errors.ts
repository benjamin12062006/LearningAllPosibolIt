import { ErrorCodes, type ErrorCode } from './error-codes.js';
import { ParseUUIDPipe, type HttpException } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { apiError } from './api-error.js';
import { publicError, type ValidationIssue } from './public-error.js';

const MAX_VALIDATION_FIELD_LENGTH = 128;

const ruleCodes: Record<string, ErrorCode> = {
  isString: ErrorCodes.FIELD_NOT_STRING,
  isNotEmpty: ErrorCodes.FIELD_REQUIRED,
  maxLength: ErrorCodes.FIELD_TOO_LONG,
  matches: ErrorCodes.FIELD_INVALID,
  isIn: ErrorCodes.FIELD_UNSUPPORTED,
  whitelistValidation: ErrorCodes.FIELD_NOT_ALLOWED,
  unknownValue: ErrorCodes.BODY_INVALID,
  isISO31661Alpha2: ErrorCodes.COUNTRY_INVALID,
  isISO4217CurrencyCode: ErrorCodes.CURRENCY_INVALID,
};

export function validationIssues(errors: ValidationError[]): ValidationIssue[] {
  const issues = new Map<string, ValidationIssue>();

  function collectIssues(error: ValidationError, parentField = '') {
    const fieldPath = [parentField, error.property].filter(Boolean).join('.');
    const field = fieldPath.slice(0, MAX_VALIDATION_FIELD_LENGTH) || 'body';

    for (const rule of Object.keys(error.constraints ?? {})) {
      const code = validationErrorCode(rule, error.property);
      issues.set(`${field}:${code}`, { field, ...publicError(code) });
    }

    for (const child of error.children ?? []) collectIssues(child, field);
  }

  errors.forEach((error) => collectIssues(error));
  return [...issues.values()].sort(compareValidationIssues);
}

function validationErrorCode(rule: string, field: string): ErrorCode {
  if (rule === 'isIn' && field === 'channelProfile') {
    return ErrorCodes.CHANNEL_PROFILE_INVALID;
  }
  if (rule === 'isIn' && field === 'delimiter') {
    return ErrorCodes.DELIMITER_INVALID;
  }
  if (rule === 'matches' && field === 'idColumn') {
    return ErrorCodes.ID_COLUMN_INVALID;
  }
  return ruleCodes[rule] ?? ErrorCodes.FIELD_INVALID;
}

function compareValidationIssues(
  first: ValidationIssue,
  second: ValidationIssue,
) {
  if (first.field < second.field) return -1;
  if (first.field > second.field) return 1;
  if (first.code < second.code) return -1;
  if (first.code > second.code) return 1;
  return 0;
}

export function validationException(errors: ValidationError[]): HttpException {
  return apiError(ErrorCodes.VALIDATION_FAILED, validationIssues(errors));
}

export function uuidParamPipe(field: string): ParseUUIDPipe {
  return new ParseUUIDPipe({
    exceptionFactory: () =>
      apiError(ErrorCodes.INVALID_UUID, [
        { field, ...publicError(ErrorCodes.INVALID_UUID) },
      ]),
  });
}
