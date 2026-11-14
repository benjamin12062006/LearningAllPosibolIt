import { Injectable } from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { publicError } from '../common/http/public-error.js';
import { UsersService } from '../users/users.service.js';
import { MAX_TEXT_LENGTH } from '../worksheets/cell-values.js';
import type { ColumnRequest } from '../worksheets/column-plan.js';
import {
  WorksheetsService,
  type FilledRow,
} from '../worksheets/worksheets.service.js';
import type { ProjectScope } from '../worksheets/worksheets.types.js';
import type { OpenCatalogAsWorksheetDto } from './worksheet-catalog-snapshots.dto.js';
import {
  WorksheetCatalogSnapshotsRepository,
  type CatalogRowToOpen,
  type CatalogToOpen,
} from './worksheet-catalog-snapshots.repository.js';

/** Como al importar: se informa de los primeros problemas, no de miles. */
const MAX_REPORTED_PROBLEMS = 500;

/** Un catálogo terminado, con sus cabeceras bien guardadas. */
type ReadyCatalog = CatalogToOpen & Readonly<{ headers: string[] }>;

/**
 * Abrir un catálogo como hoja (plan 02 de cierre, H5): el vínculo inverso del
 * puente de E5.4 que pide [12]. Copia las cabeceras y las filas de un
 * snapshot terminado a una hoja nueva y no toca el catálogo. Todas las
 * columnas son de texto: un CSV no dice tipos y así nada se convierte ni se
 * pierde; después se pueden cambiar con un borrador (C5).
 */
@Injectable()
export class CatalogWorksheetService {
  constructor(
    private readonly usersService: UsersService,
    private readonly repository: WorksheetCatalogSnapshotsRepository,
    private readonly worksheets: WorksheetsService,
  ) {}

  async open(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    workbookId: string,
    input: OpenCatalogAsWorksheetDto,
  ) {
    const user = await this.usersService.findCurrent(identity);
    const catalog = await this.requireReadyCatalog(
      user.id,
      scope,
      input.snapshotId,
    );
    const rows = await this.repository.findCatalogRows(catalog.id);

    return this.worksheets.createFilledWorksheet(identity, scope, workbookId, {
      name: input.name,
      columns: columnsOf(catalog),
      rows: rowsOrReject(rows, catalog.headers),
      catalogSnapshotId: catalog.id,
    });
  }

  private async requireReadyCatalog(
    userId: string,
    scope: ProjectScope,
    snapshotId: string,
  ): Promise<ReadyCatalog> {
    const catalog = await this.repository.findCatalogToOpen(
      userId,
      scope,
      snapshotId,
    );
    if (!catalog) {
      throw apiError(ErrorCodes.IMPORT_NOT_FOUND);
    }
    if (!isReadyCatalog(catalog)) {
      throw apiError(ErrorCodes.CATALOG_SNAPSHOT_NOT_READY);
    }
    return catalog;
  }
}

function isReadyCatalog(catalog: CatalogToOpen): catalog is ReadyCatalog {
  return (
    catalog.status === 'ready' &&
    Array.isArray(catalog.headers) &&
    catalog.headers.every((header) => typeof header === 'string')
  );
}

/** Una columna de texto por cabecera; la del identificador, obligatoria. */
function columnsOf(catalog: ReadyCatalog): ColumnRequest[] {
  return catalog.headers.map((header) => ({
    name: header,
    type: 'text',
    required: header === catalog.idColumn,
  }));
}

/**
 * Las celdas en el orden de las cabeceras. Un CSV no distingue vacío de nulo:
 * una celda vacía queda vacía. Un texto más largo que una celda de hoja no se
 * recorta: se rechaza con su fila y su cabecera, como al importar.
 */
function rowsOrReject(
  rows: readonly CatalogRowToOpen[],
  headers: readonly string[],
): FilledRow[] {
  const problems: string[] = [];
  const filled = rows.map((row) => {
    const values = textValuesOf(row);
    const cells = headers.map((header) => {
      const value = values[header] ?? '';
      if (value.length > MAX_TEXT_LENGTH) {
        problems.push(`rows.${row.sourceRow}.${header}`);
      }
      return value === '' ? null : value;
    });
    return { sortKey: sortKeyOf(row.sourceRow), cells };
  });

  if (problems.length > 0) {
    throw apiError(
      ErrorCodes.IMPORT_ROWS_INVALID,
      problems.slice(0, MAX_REPORTED_PROBLEMS).map((field) => ({
        field,
        ...publicError(ErrorCodes.CELL_VALUE_INVALID),
      })),
    );
  }
  return filled;
}

/** Solo la importación de catálogo escribe estas filas; otra forma es un error del backend. */
function textValuesOf(row: CatalogRowToOpen): Record<string, string> {
  if (!isTextRecord(row.originalValues)) {
    throw new Error(
      `La fila ${row.sourceRow} del catálogo tiene una forma inválida.`,
    );
  }
  return row.originalValues;
}

function isTextRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((cell) => typeof cell === 'string')
  );
}

/** El orden del catálogo: `catalog#00001`, como las claves de una importación. */
function sortKeyOf(sourceRow: number) {
  return `catalog#${String(sourceRow).padStart(5, '0')}`;
}
