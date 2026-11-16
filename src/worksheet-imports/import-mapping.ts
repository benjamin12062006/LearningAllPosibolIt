import { ErrorCodes } from '../common/http/error-codes.js';
import type { WorksheetColumn } from '../worksheets/worksheets.types.js';
import {
  parseImportOptions,
  type ImportOptions,
  type OptionsIssue,
} from './import-options.js';

/**
 * Lo que guarda una plantilla de mapeo (plan 02 de cierre, H3): las opciones
 * de una importación que no dependen del archivo. El título, las filas
 * excluidas y el separador o la hoja de Excel cambian con cada archivo y los
 * pone cada importación.
 */
export type MappingTemplate = Pick<
  ImportOptions,
  'mode' | 'matchColumnId' | 'decimalSeparator' | 'booleanLabels' | 'columns'
>;

export const TEMPLATE_KEYS = [
  'mode',
  'matchColumnId',
  'decimalSeparator',
  'booleanLabels',
  'columns',
] as const;

export type ParsedTemplate =
  | Readonly<{ ok: true; template: MappingTemplate }>
  | Readonly<{ ok: false; issues: readonly OptionsIssue[] }>;

/**
 * Valida una plantilla con las mismas reglas que las opciones de una
 * importación, para que guardar algo que luego no se pueda usar falle al
 * guardarlo. Una opción del archivo (`title`, `excludeRows`, `delimiter`…) no
 * se acepta: no es reutilizable. Nunca lanza.
 */
export function parseMappingTemplate(raw: unknown): ParsedTemplate {
  if (!isRecord(raw)) {
    return invalid(['mapping']);
  }
  const fileOptions = Object.keys(raw).filter((key) => !isTemplateKey(key));
  if (fileOptions.length > 0) {
    return invalid(fileOptions.map((key) => `mapping.${key}`));
  }

  // El formato da igual: sin opciones de archivo, CSV y XLSX validan lo mismo.
  const parsed = parseImportOptions(raw, 'csv');
  if (!parsed.ok) {
    return {
      ok: false,
      issues: parsed.issues.map((issue) => ({
        ...issue,
        field: `mapping.${issue.field}`,
      })),
    };
  }
  return { ok: true, template: templateOf(parsed.options) };
}

/**
 * Las columnas de la hoja que la plantilla usa y no existen o no se pueden
 * escribir (las calculadas). La importación también lo comprobaría, pero así
 * una plantilla inservible no llega a guardarse.
 */
export function unknownTemplateColumns(
  template: MappingTemplate,
  columns: readonly WorksheetColumn[],
): OptionsIssue[] {
  const writable = new Set(
    columns
      .filter((column) => column.type !== 'calculated')
      .map((column) => column.id),
  );
  const issues: OptionsIssue[] = [];
  template.columns.forEach((mapping, index) => {
    if ('columnId' in mapping && !writable.has(mapping.columnId)) {
      issues.push(mappingIssue(`mapping.columns.${index}`));
    }
  });
  if (
    template.matchColumnId !== null &&
    !writable.has(template.matchColumnId)
  ) {
    issues.push(mappingIssue('mapping.matchColumnId'));
  }
  return issues;
}

export type TemplatedOptions =
  | Readonly<{ ok: true; raw: Readonly<Record<string, unknown>> }>
  | Readonly<{ ok: false; issues: readonly OptionsIssue[] }>;

/**
 * Las opciones de una importación con plantilla: la plantilla pone el mapeo y
 * la petición, lo que depende de este archivo. Repetir en la petición algo de
 * la plantilla es un error y no se mezcla: así nadie importa creyendo que usó
 * la plantilla cuando no.
 */
export function withTemplate(
  template: MappingTemplate,
  ownOptions: unknown,
): TemplatedOptions {
  const own = ownOptions ?? {};
  if (!isRecord(own)) {
    return invalid(['options']);
  }
  const repeated = Object.keys(own).filter(isTemplateKey);
  if (repeated.length > 0) {
    return invalid(repeated);
  }
  return { ok: true, raw: { ...template, ...own } };
}

function templateOf(options: ImportOptions): MappingTemplate {
  return {
    mode: options.mode,
    matchColumnId: options.matchColumnId,
    decimalSeparator: options.decimalSeparator,
    booleanLabels: options.booleanLabels,
    columns: options.columns,
  };
}

function isTemplateKey(key: string): boolean {
  return (TEMPLATE_KEYS as readonly string[]).includes(key);
}

function invalid(fields: readonly string[]) {
  return {
    ok: false as const,
    issues: fields.map((field) => ({
      field,
      code: ErrorCodes.IMPORT_OPTIONS_INVALID,
    })),
  };
}

function mappingIssue(field: string): OptionsIssue {
  return { field, code: ErrorCodes.IMPORT_MAPPING_INVALID };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
