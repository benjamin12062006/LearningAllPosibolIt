import {
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  ArrayUnique,
  isUUID,
  IsNotEmpty,
  IsObject,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { Transform as TransformDtoValue } from 'class-transformer';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import {
  MAX_TEXT_LENGTH,
  type CellLiteral,
} from '../worksheets/cell-values.js';
import {
  ROUNDING_MODES,
  type RoundingMode,
} from '../worksheets/exact-decimal.js';
import { WORKSHEET_LIMITS } from '../worksheets/worksheet-columns.js';
import {
  TEXT_MATCHES,
  TRANSFORM_LIMITS,
  type TextMatch,
  type Transform,
} from './worksheet-transform.js';

export class CreateWorksheetSelectionDto {
  @IsUUID()
  revisionId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(WORKSHEET_LIMITS.columnsPerWorksheet)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  columnIds!: string[];

  @IsObject()
  rows!: Record<string, unknown>;
}

export class PreviewWorksheetTransformDto {
  @IsUUID()
  selectionId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(WORKSHEET_LIMITS.columnsPerWorksheet)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  columnIds!: string[];

  @IsObject()
  transform!: Record<string, unknown>;
}

export class CreateWorksheetChangeProposalDto {
  @IsUUID()
  previewId!: string;

  @TransformDtoValue(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Matches(/^[^\p{Cc}\p{Cs}]{1,200}$/u)
  explanation!: string;
}

type RowSelector =
  | { kind: 'selectedRows'; rowIds: readonly string[] }
  | { kind: 'allMatchingFilter'; filter: Record<string, unknown> };

export function rowSelectorOf(input: Record<string, unknown>): RowSelector {
  if (
    input.kind === 'selectedRows' &&
    hasKeys(input, ['kind', 'rowIds']) &&
    isRecordArray(input.rowIds)
  ) {
    const rowIds = input.rowIds;
    if (rowIds.length > TRANSFORM_LIMITS.rows) {
      throw apiError(ErrorCodes.AI_SHEET_TRANSFORM_LIMIT);
    }
    if (
      rowIds.length > 0 &&
      rowIds.every(isUuidValue) &&
      new Set(rowIds).size === rowIds.length
    ) {
      return { kind: 'selectedRows', rowIds };
    }
  }
  if (
    input.kind === 'allMatchingFilter' &&
    hasKeys(input, ['kind', 'filter']) &&
    isRecord(input.filter)
  ) {
    return { kind: 'allMatchingFilter', filter: input.filter };
  }
  throw apiError(ErrorCodes.VALIDATION_FAILED);
}

export function transformOf(input: Record<string, unknown>): Transform {
  switch (input.kind) {
    case 'trim_text':
      if (hasKeys(input, ['kind'])) return { kind: 'trim_text' };
      break;
    case 'replace_text':
      if (
        hasKeys(input, ['kind', 'find', 'replace', 'match']) &&
        isTextFragment(input.find, 1) &&
        isTextFragment(input.replace, 0) &&
        isTextMatch(input.match)
      ) {
        return {
          kind: 'replace_text',
          find: input.find,
          replace: input.replace,
          match: input.match,
        };
      }
      break;
    case 'replace_exact':
      if (
        hasKeys(input, ['kind', 'from', 'to']) &&
        isCell(input.from) &&
        isCell(input.to)
      ) {
        return { kind: 'replace_exact', from: input.from, to: input.to };
      }
      break;
    case 'map_values':
      if (
        hasKeys(input, ['kind', 'pairs']) &&
        isRecordArray(input.pairs) &&
        input.pairs.length > 0 &&
        input.pairs.length <= 100 &&
        input.pairs.every(isReplacement)
      ) {
        return { kind: 'map_values', pairs: input.pairs };
      }
      break;
    case 'percentage':
      if (
        hasKeys(input, ['kind', 'rate', 'scale', 'rounding']) &&
        typeof input.rate === 'string' &&
        typeof input.scale === 'number' &&
        Number.isInteger(input.scale) &&
        input.scale >= 0 &&
        input.scale <= 6 &&
        isRounding(input.rounding)
      ) {
        return {
          kind: 'percentage',
          rate: input.rate,
          scale: input.scale,
          rounding: input.rounding,
        };
      }
      break;
  }
  throw apiError(ErrorCodes.VALIDATION_FAILED);
}

function hasKeys(
  input: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(input).length === keys.length &&
    keys.every((key) => Object.hasOwn(input, key))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRecordArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isUuidValue(value: unknown): value is string {
  return typeof value === 'string' && isUUID(value);
}

function isCell(value: unknown): value is CellLiteral | null {
  return (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'string' && value.length <= MAX_TEXT_LENGTH)
  );
}

function isReplacement(
  input: unknown,
): input is { from: CellLiteral | null; to: CellLiteral | null } {
  return (
    isRecord(input) &&
    hasKeys(input, ['from', 'to']) &&
    isCell(input.from) &&
    isCell(input.to)
  );
}

function isRounding(input: unknown): input is RoundingMode {
  return ROUNDING_MODES.some((mode) => mode === input);
}

function isTextFragment(value: unknown, minLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length >= minLength &&
    value.length <= MAX_TEXT_LENGTH
  );
}

function isTextMatch(value: unknown): value is TextMatch {
  return TEXT_MATCHES.some((match) => match === value);
}
