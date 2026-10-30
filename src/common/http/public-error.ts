import { ErrorCodes, isErrorCode, type ErrorCode } from './error-codes.js';
import { API_MESSAGES, type LocalizedMessage } from './messages.js';

const MAX_ERROR_CONTEXT_LENGTH = 128;

export type ErrorContext = {
  sourceRow?: number;
  field?: string;
  requestId?: string;
};
export type PublicError = {
  code: ErrorCode;
  message: LocalizedMessage;
} & ErrorContext;
export type ValidationIssue = {
  field: string;
  code: ErrorCode;
  message: LocalizedMessage;
};

export function publicError(
  code: ErrorCode,
  context: ErrorContext = {},
): PublicError {
  const message = { ...API_MESSAGES[code].message };
  return { code, message, ...context };
}

/** Recompone errores JSONB anteriores sin interpretar ni exponer el texto guardado. */
export function localizeStoredError(value: unknown): PublicError | null {
  if (value === null || value === undefined) return null;
  const stored =
    typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const code = isErrorCode(stored.code)
    ? stored.code
    : ErrorCodes.IMPORT_PROCESSING_FAILED;
  const context = readStoredErrorContext(stored);
  return publicError(code, context);
}

function readStoredErrorContext(stored: Record<string, unknown>): ErrorContext {
  const context: ErrorContext = {};
  if (isSourceRow(stored.sourceRow)) {
    context.sourceRow = stored.sourceRow;
  }
  if (typeof stored.field === 'string') {
    context.field = stored.field.slice(0, MAX_ERROR_CONTEXT_LENGTH);
  }
  if (typeof stored.requestId === 'string') {
    context.requestId = stored.requestId.slice(0, MAX_ERROR_CONTEXT_LENGTH);
  }
  return context;
}

function isSourceRow(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** Fallo esperado fuera de HTTP (parser/worker), con la misma presentación pública. */
export class ApplicationFailure extends Error {
  readonly detail: PublicError;
  constructor(code: ErrorCode, context: ErrorContext = {}) {
    super(API_MESSAGES[code].message.es);
    this.detail = publicError(code, context);
    this.name = 'ApplicationFailure';
  }
}
