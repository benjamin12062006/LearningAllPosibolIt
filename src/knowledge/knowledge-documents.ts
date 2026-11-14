import { createHash } from 'node:crypto';
import { SCHEMA_OPERATION_TYPES } from '../changesets/changeset-schema.js';
import { isErrorCode } from '../common/http/error-codes.js';
import { localizeStoredError } from '../common/http/public-error.js';
import { isRuleset, type Rule } from '../evaluations/engine/ruleset.js';
import {
  describeProblem,
  isRowProblem,
} from '../evaluations/problem-messages.js';
import { ORGANIZATION_ROLES } from '../organizations/organization-roles.js';
import type { FormulaExpression } from '../worksheets/formula.js';
import { evaluateRow } from '../worksheets/row-evaluation.js';
import { WORKSHEET_LIMITS } from '../worksheets/worksheet-columns.js';
import type { StoredRow } from '../worksheets/worksheet-rows.repository.js';
import type { WorksheetColumn } from '../worksheets/worksheets.types.js';
import type {
  CatalogFacts,
  CatalogProductRow,
  ChangesetFacts,
  EvaluationFacts,
  FeedFacts,
  OrganizationFacts,
  ProblemCount,
  ProjectFacts,
  RulesetFacts,
  WorkbookFacts,
  WorksheetFacts,
  WorksheetImportFacts,
} from './knowledge.repository.js';
import type { KnowledgeDocument, MetadataValue } from './knowledge.types.js';

/**
 * Documentos de conocimiento (plan E6, D18): funciones puras que escriben cada
 * fuente como la leería una persona, en español. El agente cita estos textos;
 * no llevan correos, tokens, URLs de fuentes ni claves de archivos.
 */

/** Límites del servicio de IA (`KnowledgeLimits`): se recorta antes de mandar. */
export const DOCUMENT_LIMITS = {
  textLength: 8_000,
  metadataText: 500,
  documentId: 200,
} as const;

/** Problemas por código que se nombran en el resumen de una evaluación. */
export const TOP_PROBLEMS = 10;

const LINE = '\n';
const SEPARATOR = ' · ';

export function projectDocuments(facts: ProjectFacts): KnowledgeDocument[] {
  const lines = [
    `Proyecto «${facts.name}» de la organización «${facts.organizationName}».`,
    `País: ${facts.country ?? 'sin configurar'}${SEPARATOR}Moneda: ${facts.currency ?? 'sin configurar'}${SEPARATOR}Perfil de canal: ${facts.channelProfile ?? 'sin configurar'}.`,
  ];
  if (facts.organizationArchived) {
    lines.push(
      'La organización está archivada: se puede consultar, pero no cambiar.',
    );
  }
  return [
    document('project', lines, {
      country: facts.country ?? '',
      currency: facts.currency ?? '',
      configured: isConfigured(facts),
    }),
  ];
}

/**
 * Una ficha por producto que junta lo que está repartido en tres tablas: el
 * catálogo, la última evaluación de ese catálogo y el feed publicado (ficha 03).
 */
export function catalogDocuments(
  facts: CatalogFacts,
  products: readonly CatalogProductRow[],
): KnowledgeDocument[] {
  const documents = [catalogSummary(facts)];
  for (const product of products) {
    documents.push(productDocument(facts, product));
  }
  return documents;
}

export function evaluationDocuments(
  facts: EvaluationFacts,
  problems: readonly ProblemCount[],
): KnowledgeDocument[] {
  const lines = [
    `Última evaluación del catálogo «${facts.catalogName}», del ${facts.createdAt}: ${evaluationStatus(facts.status)}.`,
  ];
  if (facts.totalCount !== null) {
    lines.push(
      `${facts.totalCount} productos: ${facts.validCount ?? 0} válidos, ${facts.invalidCount ?? 0} inválidos y ${facts.excludedCount ?? 0} excluidos por las reglas.`,
    );
  }
  const failure = localizeStoredError(facts.error);
  if (failure) {
    lines.push(`Motivo del fallo: ${failure.message.es}`);
  }
  if (problems.length > 0) {
    lines.push('Problemas más frecuentes:');
    for (const problem of problems) {
      lines.push(`- ${problemLine(problem)}`);
    }
  }
  return [
    document('evaluation', lines, {
      status: facts.status,
      invalid_count: facts.invalidCount ?? 0,
    }),
  ];
}

export function rulesetDocuments(facts: RulesetFacts): KnowledgeDocument[] {
  const ruleset = { mapping: facts.mapping, rules: facts.rules };
  if (!isRuleset(ruleset)) {
    // Lo guardó la API validado; si no tiene la forma esperada, no se inventa.
    return [
      document(
        'ruleset',
        [`Reglas, revisión ${facts.revision}: no se pudieron leer.`],
        {
          revision: facts.revision,
        },
      ),
    ];
  }
  const lines = [
    `Reglas del proyecto, revisión ${facts.revision} (${facts.createdAt}).`,
  ];
  lines.push('Mapeo de columnas del catálogo a atributos de Google:');
  for (const mapping of ruleset.mapping) {
    lines.push(`- ${mapping.attribute} ← columna «${mapping.column}»`);
  }
  if (ruleset.rules.length > 0) {
    lines.push('Reglas, en el orden en que se aplican:');
    ruleset.rules.forEach((rule, index) => {
      lines.push(`${index + 1}. ${describeRule(rule)}`);
    });
  }
  return [document('ruleset', lines, { revision: facts.revision })];
}

export function feedDocuments(facts: FeedFacts): KnowledgeDocument[] {
  const lines = ['Feed del proyecto para el canal (Google Merchant Center).'];
  lines.push(publishedLine(facts));
  lines.push(
    facts.hasSource
      ? 'Tiene una fuente remota configurada para actualizarse solo.'
      : 'No tiene fuente remota: se publica a mano.',
  );
  if (facts.refreshEnabled && facts.refreshTime) {
    lines.push(
      `Actualización automática diaria a las ${facts.refreshTime} (${facts.timeZone ?? 'zona sin indicar'}).`,
    );
  } else {
    lines.push('Actualización automática desactivada.');
  }
  if (facts.policyRulesetRevision !== null) {
    lines.push(
      `Política aprobada con la revisión ${facts.policyRulesetRevision} de las reglas.`,
    );
  }
  const refresh = lastRefreshLine(facts);
  if (refresh) {
    lines.push(refresh);
  }
  return [
    document('feed', lines, {
      published: facts.publishedAt !== null,
      refresh_enabled: facts.refreshEnabled,
    }),
  ];
}

export function organizationDocuments(
  facts: OrganizationFacts,
): KnowledgeDocument[] {
  const roles = ORGANIZATION_ROLES.map(
    (role) => `${role}: ${facts.memberCounts[role] ?? 0}`,
  );
  const lines = [
    `Organización «${facts.name}» (${facts.archived ? 'archivada' : 'activa'}).`,
    `Proyectos: ${facts.projectCount}.`,
    `Miembros por rol: ${roles.join(SEPARATOR)}.`,
  ];
  return [
    document('organization', lines, {
      archived: facts.archived,
      project_count: facts.projectCount,
    }),
  ];
}

export function workbookDocuments(facts: WorkbookFacts): KnowledgeDocument[] {
  const lines = [
    `Libro «${facts.name}» (${facts.archived ? 'archivado' : 'activo'}).`,
    `Hojas: ${facts.worksheets.length}.`,
  ];
  for (const sheet of facts.worksheets) {
    const archived = facts.archived || sheet.archived;
    lines.push(`- «${sheet.name}» (${archived ? 'archivada' : 'activa'}).`);
  }
  return [
    document('workbook', lines, {
      archived: facts.archived,
      worksheet_count: facts.worksheets.length,
    }),
  ];
}

export async function worksheetDocuments(
  facts: WorksheetFacts,
  columns: readonly WorksheetColumn[],
  rows: AsyncIterable<StoredRow> | Iterable<StoredRow>,
): Promise<KnowledgeDocument[]> {
  const columnNames = new Map(columns.map(({ id, name }) => [id, name]));
  const columnIds = columns.map(({ id }) => id);
  const documents = [worksheetSummary(facts, columns, columnNames)];
  const { rowsPerWorksheet } = WORKSHEET_LIMITS;
  let position = 0;
  for await (const row of rows) {
    position += 1;
    documents.push(worksheetRow(facts, columns, columnIds, row, position));
    if (position === rowsPerWorksheet) {
      break;
    }
  }
  return documents;
}

export function changesetDocuments(facts: ChangesetFacts): KnowledgeDocument[] {
  const lines = [
    `Borrador «${facts.title}» de la hoja «${facts.worksheetName}»: ${CHANGESET_STATUS_TEXT[facts.status] ?? facts.status}.`,
    `Revisión de base: ${facts.baseSequence}.`,
  ];
  let operationCount = 0;
  for (const type of CHANGESET_OPERATION_TYPES) {
    const count = facts.operationCounts[type] ?? 0;
    if (count > 0) {
      operationCount += count;
      lines.push(`- ${type}: ${count}`);
    }
  }
  if (operationCount === 0) {
    lines.push('Sin operaciones.');
  }
  const metadata: Record<string, MetadataValue> = {
    worksheet_id: facts.worksheetId,
    status: facts.status,
    base_sequence: facts.baseSequence,
    operation_count: operationCount,
  };
  if (facts.decision) {
    const decision = facts.decision === 'accept' ? 'aprobado' : 'rechazado';
    lines.push(`Última decisión sobre esta versión: ${decision}.`);
    metadata.decision = facts.decision;
  }
  return [document('changeset', lines, metadata)];
}

export function worksheetImportDocuments(
  facts: WorksheetImportFacts,
): KnowledgeDocument[] {
  const lines = [
    `Última importación ${facts.format.toUpperCase()} de la hoja «${facts.worksheetName}», del ${facts.createdAt}.`,
    `Filas del archivo: ${facts.rowCount}. El borrador propone añadir ${facts.insertedCount}, actualizar ${facts.updatedCount} y dejar ${facts.unchangedCount} sin cambios.`,
    `Filas excluidas: ${facts.excludedCount}. Filas inválidas: ${facts.invalidCount}. Columnas nuevas propuestas: ${facts.newColumnCount}.`,
  ];
  const problemCounts = Object.entries(facts.problemCounts).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  for (const [code, count] of problemCounts) {
    if (isErrorCode(code) && count > 0) {
      lines.push(`- ${code}: ${count}`);
    }
  }
  return [
    document('worksheet_import', lines, {
      worksheet_id: facts.worksheetId,
      format: facts.format,
      row_count: facts.rowCount,
      excluded_count: facts.excludedCount,
    }),
  ];
}

// -----------------------------------------------------------------------------

const CHANGESET_OPERATION_TYPES = [
  ...SCHEMA_OPERATION_TYPES,
  'insert_row',
  'set_cell',
  'delete_row',
];

const CHANGESET_STATUS_TEXT: Readonly<Record<string, string>> = {
  draft: 'en borrador',
  pending_review: 'en revisión',
  approved: 'aprobado y pendiente de aplicar',
};

const COLUMN_TYPE_TEXT: Readonly<Record<WorksheetColumn['type'], string>> = {
  text: 'texto',
  integer: 'entero',
  decimal: 'decimal',
  date: 'fecha',
  boolean: 'booleano',
  selection: 'selección',
  calculated: 'calculada',
};

const FORMULA_OPERATOR_TEXT = {
  add: '+',
  sub: '−',
  mul: '×',
  div: '÷',
} as const;

function worksheetSummary(
  facts: WorksheetFacts,
  columns: readonly WorksheetColumn[],
  columnNames: ReadonlyMap<string, string>,
): KnowledgeDocument {
  const mode = facts.mode === 'free' ? 'libre' : facts.mode;
  const lines = [
    `Hoja «${facts.name}» del libro «${facts.workbookName}» (${facts.archived ? 'archivada' : 'activa'}).`,
    `Modo ${mode}. Revisión vigente ${facts.sequence}, esquema ${facts.schemaVersion}, ${facts.rowCount} filas.`,
  ];
  for (const column of columns) {
    lines.push(`- ${columnLine(column, columnNames)}`);
  }
  return document('worksheet', lines, {
    kind: 'worksheet',
    revision_id: facts.revisionId,
    revision: facts.sequence,
    archived: facts.archived,
    row_count: facts.rowCount,
  });
}

function worksheetRow(
  facts: WorksheetFacts,
  columns: readonly WorksheetColumn[],
  columnIds: readonly string[],
  row: StoredRow,
  position: number,
): KnowledgeDocument {
  const lines = [
    `Hoja «${facts.name}» · revisión ${facts.sequence} · fila ${position}.`,
  ];
  const { values } = evaluateRow(columns, row.cellValues, columnIds);
  for (const column of columns) {
    const value = cellText(column, values[column.id]);
    if (value !== null) {
      lines.push(`${column.name}: ${value}`);
    }
  }
  return document(`row:${row.rowId}`, lines, {
    kind: 'worksheet_row',
    revision_id: facts.revisionId,
    revision: facts.sequence,
    row_id: row.rowId,
    source_row: position,
    archived: facts.archived,
  });
}

function columnLine(
  column: WorksheetColumn,
  columnNames: ReadonlyMap<string, string>,
): string {
  const parts = [
    `«${column.name}»: ${COLUMN_TYPE_TEXT[column.type]}`,
    column.required ? 'obligatoria' : 'opcional',
  ];
  if (column.options?.length) {
    parts.push(
      `opciones: ${column.options.map(({ label }) => label).join(', ')}`,
    );
  }
  if (column.formula) {
    const { expression, scale, rounding } = column.formula;
    parts.push(
      `fórmula: ${expressionText(expression, columnNames)}, escala ${scale}, redondeo ${rounding}`,
    );
  }
  return parts.join(SEPARATOR);
}

function expressionText(
  expression: FormulaExpression,
  columnNames: ReadonlyMap<string, string>,
): string {
  if ('value' in expression) {
    return expression.value;
  }
  if ('column' in expression) {
    return `«${columnNames.get(expression.column) ?? expression.column}»`;
  }
  const [left, right] = expression.args;
  const operator = FORMULA_OPERATOR_TEXT[expression.op];
  return `(${expressionText(left, columnNames)} ${operator} ${expressionText(right, columnNames)})`;
}

function cellText(column: WorksheetColumn, value: unknown): string | null {
  if (typeof value === 'boolean') {
    return value ? 'sí' : 'no';
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  if (column.type === 'selection') {
    return column.options?.find(({ id }) => id === value)?.label ?? null;
  }
  return value.trim();
}

function catalogSummary(facts: CatalogFacts): KnowledgeDocument {
  const lines = [
    `Catálogo «${facts.originalName}», importado el ${facts.importedAt}, con ${facts.rowCount} productos. La columna «${facts.idColumn}» es el identificador.`,
    facts.evaluatedAt
      ? `Evaluado por última vez el ${facts.evaluatedAt}.`
      : 'Todavía no tiene una evaluación terminada.',
  ];
  return document('catalog', lines, { kind: 'catalog' });
}

function productDocument(
  facts: CatalogFacts,
  product: CatalogProductRow,
): KnowledgeDocument {
  const lines = [
    `Producto ${product.externalId} (catálogo «${facts.originalName}», fila ${product.sourceRow}).`,
  ];
  const values = valuesLine(product.originalValues, facts.idColumn);
  if (values) {
    lines.push(values);
  }
  lines.push(outcomeLine(product));
  lines.push(`En el feed publicado: ${product.inFeed ? 'sí' : 'no'}.`);
  return document(productDocumentId(product.externalId), lines, {
    kind: 'product',
    external_id: product.externalId,
    outcome: product.outcome ?? 'not_evaluated',
    in_feed: product.inFeed,
    source_row: product.sourceRow,
  });
}

/**
 * `product:<id>`. Un id demasiado largo no se recorta: dos ids con el mismo
 * principio chocarían y el servicio rechazaría el catálogo entero. Se usa su
 * SHA-256, que es estable entre pasadas.
 */
export function productDocumentId(externalId: string): string {
  const plain = `product:${externalId}`;
  if (plain.length <= DOCUMENT_LIMITS.documentId) {
    return plain;
  }
  return `product:sha256:${createHash('sha256').update(externalId).digest('hex')}`;
}

/** «Columna: valor» de las celdas con contenido, sin repetir el identificador. */
function valuesLine(originalValues: unknown, idColumn: string): string | null {
  if (!isTextRecord(originalValues)) {
    return null;
  }
  const cells: string[] = [];
  for (const [column, value] of Object.entries(originalValues)) {
    if (column !== idColumn && value.trim() !== '') {
      cells.push(`${column}: ${value.trim()}`);
    }
  }
  return cells.length > 0 ? cells.join(SEPARATOR) : null;
}

function outcomeLine(product: CatalogProductRow): string {
  if (product.outcome === null) {
    return 'Sin evaluar con la última evaluación.';
  }
  if (product.outcome === 'valid') {
    return 'Evaluación: válido para Google.';
  }
  if (product.outcome === 'excluded') {
    return 'Evaluación: excluido por una regla del proyecto.';
  }
  const problems = Array.isArray(product.problems)
    ? product.problems.filter(isRowProblem)
    : [];
  const described = problems.map(
    (problem) => `${problem.attribute}: ${describeProblem(problem).problem.es}`,
  );
  return `Evaluación: inválido — ${described.join('; ') || 'sin detalle'}.`;
}

function problemLine(problem: ProblemCount): string {
  const candidate = { attribute: problem.attribute, code: problem.code };
  if (!isRowProblem(candidate)) {
    return `${problem.code} en ${problem.attribute}: ${problem.count} productos`;
  }
  const text = describeProblem(candidate).problem.es;
  return `${problem.attribute}: ${text} (${problem.count} productos)`;
}

function describeRule(rule: Rule): string {
  if (rule.type === 'clean_text') {
    return `Limpiar espacios de: ${rule.attributes.join(', ')}.`;
  }
  if (rule.type === 'build_title') {
    return `Construir el título con la plantilla «${rule.template}».`;
  }
  const value = rule.operator === 'is_empty' ? '' : ` «${rule.value}»`;
  return `Excluir el producto cuando ${rule.attribute} ${EXCLUDE_OPERATOR_TEXT[rule.operator]}${value}.`;
}

const EXCLUDE_OPERATOR_TEXT = {
  equals: 'es igual a',
  not_equals: 'no es igual a',
  contains: 'contiene',
  is_empty: 'está vacío',
} as const;

function publishedLine(facts: FeedFacts): string {
  if (facts.publishedAt === null) {
    return 'Todavía no hay ninguna versión publicada.';
  }
  const by =
    facts.publishedBy === 'refresh'
      ? 'la actualización automática'
      : 'una persona';
  return `Versión publicada el ${facts.publishedAt} por ${by}, con ${facts.publishedRowCount ?? 0} productos (generación ${facts.generation}).`;
}

function lastRefreshLine(facts: FeedFacts): string | null {
  if (facts.lastRefreshAt === null) {
    return null;
  }
  const outcome =
    facts.lastRefreshOutcome ?? facts.lastRefreshStatus ?? 'desconocido';
  const line = `Última actualización automática del ${facts.lastRefreshAt}: ${REFRESH_OUTCOME_TEXT[outcome] ?? outcome}.`;
  const failure = localizeStoredError(facts.lastRefreshError);
  return failure ? `${line} Motivo: ${failure.message.es}` : line;
}

const REFRESH_OUTCOME_TEXT: Readonly<Record<string, string>> = {
  published: 'publicó una versión nueva',
  unchanged: 'el contenido no había cambiado',
  needs_review: 'necesita revisión antes de publicar',
  conflict: 'otra persona publicó entretanto',
  queued: 'en cola',
  running: 'en marcha',
  retry_wait: 'esperando para reintentar',
  failed: 'falló',
  succeeded: 'terminó',
};

function evaluationStatus(status: string): string {
  return EVALUATION_STATUS_TEXT[status] ?? status;
}

const EVALUATION_STATUS_TEXT: Readonly<Record<string, string>> = {
  queued: 'en cola',
  running: 'en marcha',
  succeeded: 'terminada',
  failed: 'falló',
};

function isConfigured(facts: ProjectFacts): boolean {
  return (
    facts.country !== null &&
    facts.currency !== null &&
    facts.channelProfile !== null
  );
}

/** Lo que guarda la importación: cabecera → texto. Otra forma no se lee. */
function isTextRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((cell) => typeof cell === 'string')
  );
}

/** Junta las líneas y aplica los límites del servicio de IA. */
function document(
  documentId: string,
  lines: readonly string[],
  metadata: Record<string, MetadataValue>,
): KnowledgeDocument {
  return {
    documentId,
    text: truncate(lines.join(LINE), DOCUMENT_LIMITS.textLength),
    metadata: Object.fromEntries(
      Object.entries(metadata).map(([name, value]) => [
        name,
        typeof value === 'string'
          ? truncate(value, DOCUMENT_LIMITS.metadataText)
          : value,
      ]),
    ),
  };
}

/** Recorta con «…» para que se note que falta texto. */
function truncate(text: string, maximum: number): string {
  if (text.length <= maximum) {
    return text;
  }
  // FastAPI decodifica Unicode y no admite la mitad de un par sustituto.
  const prefix = text.slice(0, maximum - 1).replace(/[\uD800-\uDBFF]$/u, '');
  return `${prefix}…`;
}
