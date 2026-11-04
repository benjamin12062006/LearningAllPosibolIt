import { describe, expect, it } from '@jest/globals';
import {
  classifyRefreshError,
  decideRefreshRecovery,
  nextRetryDelay,
  DEFAULT_REFRESH_RETRY,
} from '../../../src/jobs/refresh-retry.js';

describe('refresh retry policy (E4, D4)', () => {
  it.each([
    [1, 60_000],
    [2, 120_000],
    [3, 240_000],
    [5, 900_000],
    [1025, 900_000],
  ])('failure %i waits %i ms', (attempt, delay) => {
    expect(nextRetryDelay(attempt)).toBe(delay);
  });
  it('supports a cap that is not a power of two', () => {
    expect(
      nextRetryDelay(4, { baseDelayMs: 100, maxDelayMs: 350, maxAttempts: 8 }),
    ).toBe(350);
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid attempt %s',
    (attempt) => {
      expect(() => nextRetryDelay(attempt)).toThrow(RangeError);
    },
  );
  it.each([
    { baseDelayMs: 0 },
    { maxDelayMs: -1 },
    { maxAttempts: 1.5 },
    { baseDelayMs: Infinity },
    { maxDelayMs: 1 },
  ])('rejects invalid options %j', (patch) => {
    expect(() =>
      nextRetryDelay(1, { ...DEFAULT_REFRESH_RETRY, ...patch }),
    ).toThrow(RangeError);
  });
  it.each([
    'SOURCE_URL_NOT_ALLOWED',
    'SOURCE_REDIRECT_NOT_ALLOWED',
    'SOURCE_TOO_LARGE',
    'CSV_INVALID',
    'CSV_INVALID_ENCODING',
    'CSV_HEADERS_INVALID',
    'CSV_COLUMN_MISSING',
    'CSV_ID_MISSING',
    'CSV_DUPLICATE_ID',
    'CSV_EMPTY',
    'IMPORT_ROW_LIMIT',
    'IMPORT_FILE_TOO_LARGE',
    'EVALUATION_COLUMN_MISSING',
    'RULESET_NOT_FOUND',
    'REFRESH_SOURCE_MISSING',
    'REFRESH_POLICY_MISSING',
    'EXPORT_EVALUATION_SUPERSEDED',
    'EXPORT_EVALUATION_OUTDATED',
    'EXPORT_NO_VALID_PRODUCTS',
  ])('does not retry %s', (code) => {
    expect(classifyRefreshError({ code })).toBe('permanent');
    expect(decideRefreshRecovery({ code }, 1)).toEqual({ status: 'failed' });
  });
  it.each([
    'SOURCE_UNREACHABLE',
    'SOURCE_TIMEOUT',
    'IMPORT_INTERRUPTED',
    'EVALUATION_INTERRUPTED',
    'REFRESH_LEASE_EXPIRED',
    'INTERNAL_ERROR',
    'UNKNOWN',
  ])('retries %s', (code) => {
    expect(classifyRefreshError({ code })).toBe('temporary');
    expect(decideRefreshRecovery({ code }, 1)).toEqual({
      status: 'retry_wait',
      delayMs: 60_000,
    });
  });
  it.each([400, 401, 403, 404, 408, 422, 499])(
    'does not retry source HTTP %i',
    (httpStatus) => {
      expect(
        classifyRefreshError({ code: 'SOURCE_HTTP_ERROR', httpStatus }),
      ).toBe('permanent');
    },
  );
  it.each([429, 500, 503, 599, undefined])(
    'retries source HTTP %s',
    (httpStatus) => {
      expect(
        classifyRefreshError({ code: 'SOURCE_HTTP_ERROR', httpStatus }),
      ).toBe('temporary');
    },
  );
  it('does not confuse Nest HTTP status with source status', () => {
    expect(
      classifyRefreshError({ code: 'IMPORT_INTERRUPTED', httpStatus: 400 }),
    ).toBe('temporary');
  });
  it.each(['IMPORT_ALREADY_ACTIVE', 'EVALUATION_ALREADY_ACTIVE'])(
    'waits without consuming failures for %s',
    (code) => {
      expect(classifyRefreshError({ code })).toBe('busy');
      expect(decideRefreshRecovery({ code }, 0)).toEqual({
        status: 'queued',
        delayMs: 60_000,
      });
    },
  );
  it('stops on the third failure, not the fourth', () => {
    expect(decideRefreshRecovery({ code: 'SOURCE_TIMEOUT' }, 2)).toEqual({
      status: 'retry_wait',
      delayMs: 120_000,
    });
    expect(decideRefreshRecovery({ code: 'SOURCE_TIMEOUT' }, 3)).toEqual({
      status: 'failed',
    });
    expect(decideRefreshRecovery({ code: 'SOURCE_TIMEOUT' }, 4)).toEqual({
      status: 'failed',
    });
  });
  it('allows disabling retries with a single attempt', () => {
    expect(
      decideRefreshRecovery({ code: 'SOURCE_TIMEOUT' }, 1, {
        ...DEFAULT_REFRESH_RETRY,
        maxAttempts: 1,
      }),
    ).toEqual({ status: 'failed' });
  });
  it('requires a consumed failure except when waiting for a busy project', () => {
    expect(() => decideRefreshRecovery({ code: 'SOURCE_TIMEOUT' }, 0)).toThrow(
      RangeError,
    );
    expect(() =>
      decideRefreshRecovery({ code: 'IMPORT_ALREADY_ACTIVE' }, -1),
    ).toThrow(RangeError);
  });
});
