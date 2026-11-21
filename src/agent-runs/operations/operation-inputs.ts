import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  CreateWorksheetDto,
  QueryRowsDto,
  SavedViewQueryDto,
  VIEW_VISIBILITIES,
  type ViewVisibility,
} from '../../worksheets/worksheets.dto.js';
import type { JsonSchema } from './agent-operation.js';
import { CreateWorksheetCatalogSnapshotDto } from '../../worksheet-catalog-snapshots/worksheet-catalog-snapshots.dto.js';

/*
 * Los argumentos de cada operación del agente. Se validan con los mismos
 * validadores de REST (`validateAs`) y se describen al modelo con un JSON
 * Schema cerrado. Los IDs de hoja o libro son opcionales: si faltan, se usan
 * los de la conversación.
 */

const UUID_SCHEMA = { type: 'string', format: 'uuid' } as const;

export function objectSchema(
  properties: Record<string, unknown>,
  required: readonly string[] = [],
): JsonSchema {
  return {
    type: 'object',
    properties,
    required: [...required],
    additionalProperties: false,
  };
}

function trim({ value }: { value: unknown }) {
  return typeof value === 'string' ? value.trim() : value;
}

export class NoInput {}
export const NO_INPUT_SCHEMA = objectSchema({});

export class WorkbookRefInput {
  @IsOptional()
  @IsUUID()
  workbookId?: string;
}
export const WORKBOOK_REF_SCHEMA = objectSchema({ workbookId: UUID_SCHEMA });

export class WorksheetRefInput {
  @IsOptional()
  @IsUUID()
  worksheetId?: string;
}
export const WORKSHEET_REF_SCHEMA = objectSchema({ worksheetId: UUID_SCHEMA });

/** Sin revisión, las columnas vigentes; con ella, las de esa revisión. */
export class SheetSchemaInput extends WorksheetRefInput {
  @IsOptional()
  @IsUUID()
  revisionId?: string;
}
export const SHEET_SCHEMA_SCHEMA = objectSchema({
  worksheetId: UUID_SCHEMA,
  revisionId: UUID_SCHEMA,
});

export class SheetCatalogInput extends CreateWorksheetCatalogSnapshotDto {
  @IsOptional()
  @IsUUID()
  worksheetId?: string;
}

export const SHEET_CATALOG_SCHEMA = objectSchema(
  {
    worksheetId: UUID_SCHEMA,
    idColumnId: UUID_SCHEMA,
    revisionId: UUID_SCHEMA,
    columns: { type: 'array', items: UUID_SCHEMA, minItems: 1 },
  },
  ['idColumnId'],
);

/** `rows/query` con una página más corta: lo que vuelve al modelo cuesta. */
export class QueryRowsInput extends QueryRowsDto {
  @IsOptional()
  @IsUUID()
  worksheetId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  declare limit?: number;
}
export const QUERY_ROWS_SCHEMA = objectSchema({
  worksheetId: UUID_SCHEMA,
  revisionId: UUID_SCHEMA,
  viewId: UUID_SCHEMA,
  filter: {
    type: 'object',
    description:
      'Árbol de filtro de rows/query: { column, op, value } o { and|or: [...] }.',
  },
  sort: {
    type: 'array',
    items: objectSchema(
      {
        columnId: UUID_SCHEMA,
        direction: { type: 'string', enum: ['asc', 'desc'] },
      },
      ['columnId', 'direction'],
    ),
  },
  columns: { type: 'array', items: UUID_SCHEMA },
  cursor: { type: 'string' },
  limit: { type: 'integer', minimum: 1, maximum: 50 },
});

export class SelectRowsInput {
  @IsOptional()
  @IsUUID()
  worksheetId?: string;

  @IsOptional()
  @IsUUID()
  revisionId?: string;

  @IsUUID('all', { each: true })
  columnIds!: string[];

  @IsObject()
  rows!: Record<string, unknown>;
}
export const SELECT_ROWS_SCHEMA = objectSchema(
  {
    worksheetId: UUID_SCHEMA,
    revisionId: UUID_SCHEMA,
    columnIds: { type: 'array', items: UUID_SCHEMA, minItems: 1 },
    rows: {
      type: 'object',
      description:
        '{ kind: "selectedRows", rowIds: [...] } o { kind: "allMatchingFilter", filter }.',
    },
  },
  ['columnIds', 'rows'],
);

export class PreviewTransformInput {
  @IsOptional()
  @IsUUID()
  worksheetId?: string;

  @IsOptional()
  @IsUUID()
  selectionId?: string;

  @IsUUID('all', { each: true })
  columnIds!: string[];

  @IsObject()
  transform!: Record<string, unknown>;
}
export const PREVIEW_TRANSFORM_SCHEMA = objectSchema(
  {
    worksheetId: UUID_SCHEMA,
    selectionId: UUID_SCHEMA,
    columnIds: { type: 'array', items: UUID_SCHEMA, minItems: 1 },
    transform: {
      type: 'object',
      description:
        'trim_text; replace_text { find, replace, match: contains|prefix|suffix } cambia un fragmento y conserva el resto (p. ej. el sufijo de moneda, sin convertir el importe); replace_exact { from, to } cambia el valor completo; map_values { pairs }; percentage { rate, scale, rounding }.',
    },
  },
  ['columnIds', 'transform'],
);

export class EvaluationRefInput {
  @IsOptional()
  @IsUUID()
  evaluationId?: string;
}
export const EVALUATION_REF_SCHEMA = objectSchema({
  evaluationId: UUID_SCHEMA,
});

export class RulesetRefInput {
  @IsOptional()
  @IsInt()
  @Min(1)
  revision?: number;
}
export const RULESET_REF_SCHEMA = objectSchema({
  revision: { type: 'integer', minimum: 1 },
});

export class FeedRefInput {
  @IsOptional()
  @IsUUID()
  feedId?: string;
}
export const FEED_REF_SCHEMA = objectSchema({ feedId: UUID_SCHEMA });

export class FeedProductsInput {
  @IsOptional()
  @IsUUID()
  exportId?: string;

  @IsOptional()
  @IsUUID()
  feedId?: string;

  @IsOptional()
  @IsUUID()
  versionId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(150)
  search?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;
}
export const FEED_PRODUCTS_SCHEMA = objectSchema({
  exportId: UUID_SCHEMA,
  feedId: UUID_SCHEMA,
  versionId: UUID_SCHEMA,
  search: { type: 'string', maxLength: 150 },
  limit: { type: 'integer', minimum: 1, maximum: 20 },
  offset: { type: 'integer', minimum: 0 },
});

export class ChangeProposalInput {
  @IsOptional()
  @IsUUID()
  worksheetId?: string;

  @IsUUID()
  previewId!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  explanation!: string;
}
export const CHANGE_PROPOSAL_SCHEMA = objectSchema(
  {
    worksheetId: UUID_SCHEMA,
    previewId: UUID_SCHEMA,
    explanation: { type: 'string', minLength: 1, maxLength: 200 },
  },
  ['previewId', 'explanation'],
);

/** Una hoja nueva: el mismo cuerpo que `POST …/worksheets`, con su libro. */
export class SheetLayoutInput extends CreateWorksheetDto {
  @IsOptional()
  @IsUUID()
  workbookId?: string;
}
export const SHEET_LAYOUT_SCHEMA = objectSchema(
  {
    workbookId: UUID_SCHEMA,
    name: { type: 'string', minLength: 1, maxLength: 200 },
    columns: {
      type: 'array',
      maxItems: 200,
      items: objectSchema(
        {
          name: { type: 'string', minLength: 1 },
          type: {
            type: 'string',
            enum: [
              'text',
              'integer',
              'decimal',
              'boolean',
              'date',
              'selection',
            ],
          },
          required: { type: 'boolean' },
          options: {
            type: 'array',
            items: objectSchema({ label: { type: 'string' } }, ['label']),
          },
        },
        ['name', 'type'],
      ),
    },
  },
  ['name', 'columns'],
);

export class SuggestViewInput {
  @IsOptional()
  @IsUUID()
  worksheetId?: string;

  @IsOptional()
  @IsIn(VIEW_VISIBILITIES)
  visibility?: ViewVisibility;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => SavedViewQueryDto)
  query!: SavedViewQueryDto;
}
export const SUGGEST_VIEW_SCHEMA = objectSchema(
  {
    worksheetId: UUID_SCHEMA,
    name: { type: 'string', minLength: 1, maxLength: 200 },
    visibility: { type: 'string', enum: [...VIEW_VISIBILITIES] },
    query: {
      type: 'object',
      description: 'Lo mismo que rows/query: { filter?, sort?, columns? }.',
    },
  },
  ['name', 'query'],
);
