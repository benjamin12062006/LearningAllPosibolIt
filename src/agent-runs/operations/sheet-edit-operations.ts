import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
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
} from 'class-validator';
import type {
  ChangesetsService,
  CheckedEdits,
} from '../../changesets/changesets.service.js';
import { validateAs } from '../../common/http/validation-options.js';
import {
  KEEP_RULES,
  KEY_COMPARISONS,
  type KeepRule,
  type KeyComparison,
} from '../../worksheets/row-duplicates.js';
import type { WorksheetRowsService } from '../../worksheets/worksheet-rows.service.js';
import type { WorksheetsService } from '../../worksheets/worksheets.service.js';
import {
  operationText,
  worksheetOf,
  type OperationContext,
  type ReadOperation,
  type WriteOperation,
} from './agent-operation.js';
import { objectSchema } from './operation-inputs.js';

/*
 * Editar filas, celdas y columnas desde el chat (plan 09 del asistente,
 * etapa 2). El modelo propone operaciones de borrador; Nest las valida como al
 * guardar desde el editor y la persona confirma. Nunca se envía, aprueba ni
 * aplica: eso sigue en la app con su sesión.
 */

/** Por debajo del límite de un borrador (1.000), para que la tarjeta se lea. */
const AGENT_MAX_OPERATIONS = 500;
const DUPLICATE_GROUPS = { defaultLimit: 20, maxLimit: 50 } as const;

const UUID_SCHEMA = { type: 'string', format: 'uuid' } as const;
const CELL_SCHEMA = {
  description:
    'Valor canónico de la columna: texto, "12.50" en decimal, "3" en entero, "2026-11-15" en fecha, true/false o el id de la opción. null vacía la celda.',
} as const;
const ADDABLE_TYPES = [
  'text',
  'integer',
  'decimal',
  'boolean',
  'date',
  'selection',
];

const EDIT_OPERATION_SCHEMA = {
  type: 'object',
  description:
    'Una de: set_cell { rowId, columnId, value }; insert_row { rowId (uuid nuevo), sortKey?, values }; delete_row { rowId }; add_column { columnId (uuid nuevo), name, columnType, options? }; rename_column { columnId, name }; delete_column { columnId }; change_column_type { columnId, columnType, options? }.',
  properties: {
    type: {
      type: 'string',
      enum: [
        'set_cell',
        'insert_row',
        'delete_row',
        'add_column',
        'rename_column',
        'delete_column',
        'change_column_type',
      ],
    },
    rowId: UUID_SCHEMA,
    columnId: UUID_SCHEMA,
    value: CELL_SCHEMA,
    sortKey: { type: 'string', maxLength: 64 },
    values: { type: 'object' },
    name: { type: 'string', minLength: 1, maxLength: 200 },
    columnType: { type: 'string', enum: ADDABLE_TYPES },
    options: {
      type: 'array',
      items: objectSchema({ label: { type: 'string' } }, ['label']),
    },
  },
  required: ['type'],
} as const;

const OPERATION_NAMES: Record<string, readonly [string, string]> = {
  set_cell: ['celdas', 'cells'],
  insert_row: ['filas nuevas', 'new rows'],
  delete_row: ['filas borradas', 'deleted rows'],
  add_column: ['columnas nuevas', 'new columns'],
  rename_column: ['columnas renombradas', 'renamed columns'],
  delete_column: ['columnas quitadas', 'removed columns'],
  change_column_type: ['cambios de tipo', 'type changes'],
};

// ── Entradas ──

function trim({ value }: { value: unknown }) {
  return typeof value === 'string' ? value.trim() : value;
}

class PrepareSheetEditsInput {
  @IsOptional()
  @IsUUID()
  worksheetId?: string;

  @IsOptional()
  @IsUUID()
  changesetId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  explanation!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(AGENT_MAX_OPERATIONS)
  @IsObject({ each: true })
  operations!: Record<string, unknown>[];
}

class FindDuplicatesInput {
  @IsOptional()
  @IsUUID()
  worksheetId?: string;

  @IsOptional()
  @IsUUID()
  revisionId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  columnIds!: string[];

  @IsOptional()
  @IsIn(KEY_COMPARISONS)
  comparison?: KeyComparison;

  @IsOptional()
  @IsIn(KEEP_RULES)
  keep?: KeepRule;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(DUPLICATE_GROUPS.maxLimit)
  limit?: number;
}

// ── Operaciones ──

export function prepareSheetEditsOperation(services: {
  changesets: ChangesetsService;
  worksheets: WorksheetsService;
}): WriteOperation<PrepareSheetEditsInput> {
  return {
    name: 'prepare_sheet_edits',
    description:
      'Prepara cambios de filas, celdas o columnas en un borrador. Con changesetId se añaden detrás de los cambios que ya tiene ese borrador (sin enviar); sin él, se crea uno nuevo. Nest los valida como el editor; la persona confirma y nunca se envía ni se aplica solo. Usa IDs de get_sheet_schema y query_rows.',
    level: 'write',
    permission: 'worksheet.write',
    inputSchema: objectSchema(
      {
        worksheetId: UUID_SCHEMA,
        changesetId: UUID_SCHEMA,
        title: { type: 'string', minLength: 1, maxLength: 200 },
        explanation: { type: 'string', minLength: 1, maxLength: 200 },
        operations: {
          type: 'array',
          minItems: 1,
          maxItems: AGENT_MAX_OPERATIONS,
          items: EDIT_OPERATION_SCHEMA,
        },
      },
      ['explanation', 'operations'],
    ),
    parse: (input) => validateAs(PrepareSheetEditsInput, input),
    targetOf: (context, input) => ({
      worksheetId: worksheetOf(context, input.worksheetId),
      changesetId: input.changesetId ?? null,
    }),
    prepare: async (context, input) => {
      const worksheetId = worksheetOf(context, input.worksheetId);
      const checked = await services.changesets.checkEdits(
        context.identity,
        context.scope,
        worksheetId,
        { changesetId: input.changesetId, operations: input.operations },
      );
      const { worksheet } = await services.worksheets.findWorksheet(
        context.identity,
        context.scope,
        worksheetId,
      );
      const title = input.title ?? input.explanation;
      return {
        summary: summaryOf(context, worksheet.name, title, checked, input),
        plan: {
          worksheetId,
          changeset: checked.changeset,
          baseRevisionId: checked.baseRevisionId,
          title,
          operations: asPlainJson(checked.operations),
        },
        target: {
          worksheetId,
          changesetId: checked.changeset?.id ?? null,
        },
      };
    },
    confirm: async (context, plan) => {
      const saved = await services.changesets.saveEdits(
        context.identity,
        context.scope,
        String(plan.worksheetId),
        {
          changeset: draftPointerOf(plan.changeset),
          baseRevisionId: String(plan.baseRevisionId),
          title: String(plan.title),
          operations: Array.isArray(plan.operations) ? plan.operations : [],
        },
      );
      return {
        changesetId: saved.id,
        worksheetId: saved.worksheetId,
        draftVersion: saved.draftVersion,
        operationCount: saved.operations.length,
      };
    },
  };
}

export function findDuplicatesOperation(
  rows: WorksheetRowsService,
): ReadOperation<FindDuplicatesInput> {
  return {
    name: 'find_duplicates',
    description:
      'Busca filas repetidas por una clave de columnas en toda una revisión (por defecto, la vigente). Devuelve el criterio, qué fila se conserva en cada grupo y cuáles se borrarían. Para borrarlas, pasa esos rowId a prepare_sheet_edits con delete_row.',
    level: 'read',
    permission: 'organization.read',
    inputSchema: objectSchema(
      {
        worksheetId: UUID_SCHEMA,
        revisionId: UUID_SCHEMA,
        columnIds: {
          type: 'array',
          items: UUID_SCHEMA,
          minItems: 1,
          maxItems: 10,
        },
        comparison: {
          type: 'string',
          enum: KEY_COMPARISONS,
          description:
            'exact (por defecto) o normalized: sin espacios de más ni mayúsculas.',
        },
        keep: {
          type: 'string',
          enum: KEEP_RULES,
          description: 'first (por defecto) o last, en el orden de la hoja.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: DUPLICATE_GROUPS.maxLimit,
        },
      },
      ['columnIds'],
    ),
    parse: (input) => validateAs(FindDuplicatesInput, input),
    targetOf: (context, input) => ({
      worksheetId: worksheetOf(context, input.worksheetId),
      columnIds: input.columnIds,
    }),
    execute: (context, input) =>
      rows.findDuplicates(
        context.identity,
        context.scope,
        worksheetOf(context, input.worksheetId),
        {
          revisionId: input.revisionId,
          columnIds: input.columnIds,
          comparison: input.comparison ?? 'exact',
          keep: input.keep ?? 'first',
          limit: input.limit ?? DUPLICATE_GROUPS.defaultLimit,
        },
      ),
  };
}

// ── Detalle ──

/** Lo que verá la persona en la tarjeta: hoja, borrador y cuántos cambios de cada tipo. */
function summaryOf(
  context: OperationContext,
  worksheetName: string,
  title: string,
  checked: CheckedEdits,
  input: PrepareSheetEditsInput,
) {
  const counts = countsOf(context, input.operations);
  if (checked.changeset) {
    return operationText(
      context,
      `Añadir al borrador «${checked.changeset.title}» (versión ${checked.changeset.draftVersion}) de la hoja «${worksheetName}»: ${counts}. Conserva sus ${checked.previousOperationCount} cambios anteriores. ${input.explanation}`,
      `Add to the draft “${checked.changeset.title}” (version ${checked.changeset.draftVersion}) of “${worksheetName}”: ${counts}. Keeps its ${checked.previousOperationCount} earlier changes. ${input.explanation}`,
    );
  }
  return operationText(
    context,
    `Crear el borrador «${title}» en la hoja «${worksheetName}»: ${counts}. ${input.explanation}`,
    `Create the draft “${title}” in “${worksheetName}”: ${counts}. ${input.explanation}`,
  );
}

function countsOf(
  context: OperationContext,
  operations: readonly Record<string, unknown>[],
) {
  const counts = new Map<string, number>();
  for (const { type } of operations) {
    const key = String(type);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .map(([type, count]) => {
      const [es, en] = OPERATION_NAMES[type] ?? [type, type];
      return `${count} ${operationText(context, es, en)}`;
    })
    .join(', ');
}

function draftPointerOf(value: unknown) {
  if (
    value &&
    typeof value === 'object' &&
    'id' in value &&
    'title' in value &&
    'draftVersion' in value &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.draftVersion === 'number'
  ) {
    return {
      id: value.id,
      title: value.title,
      draftVersion: value.draftVersion,
    };
  }
  return null;
}

/** El plan se guarda como JSON: sin las clases del DTO que lo validó. */
function asPlainJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
