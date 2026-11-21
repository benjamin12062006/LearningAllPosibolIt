import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { apiError } from '../../common/http/api-error.js';
import { ErrorCodes } from '../../common/http/error-codes.js';
import { validateAs } from '../../common/http/validation-options.js';
import type { CatalogImportService } from '../../catalog-import/catalog-import.service.js';
import type { CatalogWorksheetService } from '../../worksheet-catalog-snapshots/catalog-worksheet.service.js';
import { OpenCatalogAsWorksheetDto } from '../../worksheet-catalog-snapshots/worksheet-catalog-snapshots.dto.js';
import { CreateWorksheetExportDto } from '../../worksheet-exports/worksheet-exports.dto.js';
import type { WorksheetExportsService } from '../../worksheet-exports/worksheet-exports.service.js';
import { CreateImportMappingDto } from '../../worksheet-imports/import-mappings.dto.js';
import type { ImportMappingsService } from '../../worksheet-imports/import-mappings.service.js';
import type { SavedViewsService } from '../../worksheets/saved-views.service.js';
import {
  DuplicateWorksheetDto,
  SavedViewQueryDto,
  SaveViewDto,
  VIEW_VISIBILITIES,
  type ViewVisibility,
} from '../../worksheets/worksheets.dto.js';
import type { WorksheetsService } from '../../worksheets/worksheets.service.js';
import {
  operationText,
  worksheetOf,
  type AgentOperation,
  type OperationContext,
  type ReadOperation,
  type WriteOperation,
} from './agent-operation.js';
import { objectSchema } from './operation-inputs.js';

/*
 * Lo que la web hace con una hoja además de editarla (plan 10, D8): duplicarla,
 * abrir un catálogo como hoja, exportarla, sus vistas guardadas y sus
 * plantillas de mapeo. Las lecturas se ejecutan; las escrituras preparan una
 * propuesta. Todo llama a los servicios de la web con la identidad de la
 * persona, así que permisos y errores son los de REST.
 */

const UUID_SCHEMA = { type: 'string', format: 'uuid' } as const;
const NAME_SCHEMA = { type: 'string', minLength: 1, maxLength: 200 } as const;
const PAGE_SCHEMA = {
  limit: { type: 'integer', minimum: 1, maximum: 50 },
  offset: { type: 'integer', minimum: 0 },
} as const;
const VIEW_QUERY_SCHEMA = {
  type: 'object',
  description: 'Lo mismo que rows/query: { filter?, sort?, columns? }.',
} as const;

type Services = Readonly<{
  worksheets: WorksheetsService;
  views: SavedViewsService;
  mappings: ImportMappingsService;
  exports: WorksheetExportsService;
  catalogWorksheets: CatalogWorksheetService;
  imports: CatalogImportService;
}>;

// ── Entradas ──

function trim({ value }: { value: unknown }) {
  return typeof value === 'string' ? value.trim() : value;
}

class OptionalWorksheetInput {
  @IsOptional()
  @IsUUID()
  worksheetId?: string;
}

class PagedWorksheetInput extends OptionalWorksheetInput {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;
}

class DuplicateInput extends DuplicateWorksheetDto {
  @IsOptional()
  @IsUUID()
  worksheetId?: string;
}

class OpenCatalogInput extends OpenCatalogAsWorksheetDto {
  @IsOptional()
  @IsUUID()
  workbookId?: string;
}

class ExportInput extends CreateWorksheetExportDto {
  @IsOptional()
  @IsUUID()
  worksheetId?: string;
}

class UpdateViewInput {
  @IsUUID()
  viewId!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsIn(VIEW_VISIBILITIES)
  visibility?: ViewVisibility;

  @IsObject()
  @ValidateNested()
  @Type(() => SavedViewQueryDto)
  query!: SavedViewQueryDto;
}

class MappingInput extends CreateImportMappingDto {
  @IsOptional()
  @IsUUID()
  worksheetId?: string;
}

class MappingRefInput {
  @IsUUID()
  mappingId!: string;
}

// ── Operaciones ──

export function sheetManagementOperations(
  services: Services,
): AgentOperation[] {
  return [
    duplicateWorksheet(services),
    openCatalogAsWorksheet(services),
    exportWorksheet(services),
    listSavedViews(services),
    updateSavedView(services),
    listImportMappings(services),
    createImportMapping(services),
    deleteImportMapping(services),
  ] as AgentOperation[];
}

function duplicateWorksheet({
  worksheets,
}: Services): WriteOperation<DuplicateInput> {
  return {
    name: 'duplicate_worksheet',
    description:
      'Duplica una hoja (por defecto, la de la conversación) con otro nombre, en su libro o en otro, desde la revisión vigente o una anterior (revisionId).',
    level: 'write',
    permission: 'worksheet.write',
    inputSchema: objectSchema(
      {
        worksheetId: UUID_SCHEMA,
        name: NAME_SCHEMA,
        workbookId: UUID_SCHEMA,
        revisionId: UUID_SCHEMA,
      },
      ['name'],
    ),
    parse: (input) => validateAs(DuplicateInput, input),
    targetOf: (context, input) => ({
      worksheetId: worksheetOf(context, input.worksheetId),
    }),
    prepare: async (context, input) => {
      const worksheetId = worksheetOf(context, input.worksheetId);
      const { worksheet } = await worksheets.findWorksheet(
        context.identity,
        context.scope,
        worksheetId,
      );
      return {
        summary: operationText(
          context,
          `Duplicar la hoja «${worksheet.name}» como «${input.name}».`,
          `Duplicate the sheet “${worksheet.name}” as “${input.name}”.`,
        ),
        plan: {
          worksheetId,
          name: input.name,
          workbookId: input.workbookId ?? null,
          revisionId: input.revisionId ?? null,
        },
        target: { worksheetId },
      };
    },
    confirm: async ({ identity, scope }, plan) => {
      const body = await validateAs(DuplicateWorksheetDto, {
        name: plan.name,
        ...(typeof plan.workbookId === 'string'
          ? { workbookId: plan.workbookId }
          : {}),
        ...(typeof plan.revisionId === 'string'
          ? { revisionId: plan.revisionId }
          : {}),
      });
      const { worksheet } = await worksheets.duplicateWorksheet(
        identity,
        scope,
        String(plan.worksheetId),
        body,
      );
      return {
        worksheetId: worksheet.id,
        workbookId: worksheet.workbookId,
        name: worksheet.name,
      };
    },
  };
}

function openCatalogAsWorksheet({
  catalogWorksheets,
  imports,
}: Services): WriteOperation<OpenCatalogInput> {
  return {
    name: 'open_catalog_as_worksheet',
    description:
      'Crea una hoja nueva con las columnas y filas de una importación del catálogo terminada (IDs con list_catalog_imports), en un libro (por defecto, el de la conversación).',
    level: 'write',
    permission: 'worksheet.write',
    inputSchema: objectSchema(
      { snapshotId: UUID_SCHEMA, name: NAME_SCHEMA, workbookId: UUID_SCHEMA },
      ['snapshotId', 'name'],
    ),
    parse: (input) => validateAs(OpenCatalogInput, input),
    targetOf: (context, input) => ({
      workbookId: input.workbookId ?? context.context.workbookId,
      snapshotId: input.snapshotId,
    }),
    prepare: async (context, input) => {
      const workbookId = workbookOf(context, input.workbookId);
      const { snapshot } = await imports.findSnapshot(
        context.identity,
        context.scope.projectId,
        input.snapshotId,
      );
      return {
        summary: operationText(
          context,
          `Crear la hoja «${input.name}» con las ${snapshot.rowCount ?? 0} filas de «${snapshot.originalName}».`,
          `Create the sheet “${input.name}” with the ${snapshot.rowCount ?? 0} rows of “${snapshot.originalName}”.`,
        ),
        plan: { workbookId, snapshotId: snapshot.id, name: input.name },
        target: { workbookId, snapshotId: snapshot.id },
      };
    },
    confirm: async ({ identity, scope }, plan) => {
      const { worksheet } = await catalogWorksheets.open(
        identity,
        scope,
        String(plan.workbookId),
        { snapshotId: String(plan.snapshotId), name: String(plan.name) },
      );
      return {
        worksheetId: worksheet.id,
        workbookId: worksheet.workbookId,
        name: worksheet.name,
      };
    },
  };
}

function exportWorksheet({
  worksheets,
  exports,
}: Services): WriteOperation<ExportInput> {
  return {
    name: 'export_worksheet',
    description:
      'Genera un archivo CSV o XLSX de una hoja (por defecto, la de la conversación) con sus filtros, orden y columnas, de la revisión vigente o de una anterior. La persona lo descarga desde el historial de la hoja.',
    level: 'write',
    permission: 'organization.read',
    inputSchema: objectSchema(
      {
        worksheetId: UUID_SCHEMA,
        format: { type: 'string', enum: ['csv', 'xlsx'] },
        revisionId: UUID_SCHEMA,
        columns: { type: 'array', items: UUID_SCHEMA },
        filter: {
          type: 'object',
          description: 'Árbol de filtro de rows/query.',
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
        delimiter: { type: 'string', enum: ['comma', 'semicolon'] },
        formulas: { type: 'string', enum: ['escape', 'keep'] },
      },
      ['format'],
    ),
    parse: (input) => validateAs(ExportInput, input),
    targetOf: (context, input) => ({
      worksheetId: worksheetOf(context, input.worksheetId),
    }),
    prepare: async (context, input) => {
      const worksheetId = worksheetOf(context, input.worksheetId);
      const { worksheet } = await worksheets.findWorksheet(
        context.identity,
        context.scope,
        worksheetId,
      );
      const { worksheetId: _omitted, ...request } = input;
      return {
        summary: operationText(
          context,
          `Exportar la hoja «${worksheet.name}» a ${input.format.toUpperCase()}.`,
          `Export the sheet “${worksheet.name}” to ${input.format.toUpperCase()}.`,
        ),
        plan: { worksheetId, request: asPlainJson(request) },
        target: { worksheetId },
      };
    },
    confirm: async ({ identity, scope }, plan) => {
      const body = await validateAs(CreateWorksheetExportDto, plan.request);
      const created = await exports.create(
        identity,
        scope,
        String(plan.worksheetId),
        body,
      );
      return {
        exportId: created.export.id,
        worksheetId: String(plan.worksheetId),
        downloadUrl: created.downloadUrl,
      };
    },
  };
}

function listSavedViews({
  views,
}: Services): ReadOperation<PagedWorksheetInput> {
  return {
    name: 'list_saved_views',
    description:
      'Vistas guardadas de una hoja (por defecto, la de la conversación): las personales y las de equipo, con su filtro, orden y columnas, y si puedes editarlas.',
    level: 'read',
    permission: 'organization.read',
    inputSchema: objectSchema({ worksheetId: UUID_SCHEMA, ...PAGE_SCHEMA }),
    parse: (input) => validateAs(PagedWorksheetInput, input),
    targetOf: (context, input) => ({
      worksheetId: worksheetOf(context, input.worksheetId),
    }),
    execute: (context, input) =>
      views.findByWorksheet(
        context.identity,
        context.scope,
        worksheetOf(context, input.worksheetId),
        pageOf(input),
      ),
  };
}

function updateSavedView({ views }: Services): WriteOperation<UpdateViewInput> {
  return {
    name: 'update_saved_view',
    description:
      'Cambia el nombre, la visibilidad (personal o team) o la consulta de una vista guardada (IDs con list_saved_views).',
    level: 'write',
    permission: 'organization.read',
    inputSchema: objectSchema(
      {
        viewId: UUID_SCHEMA,
        name: NAME_SCHEMA,
        visibility: { type: 'string', enum: [...VIEW_VISIBILITIES] },
        query: VIEW_QUERY_SCHEMA,
      },
      ['viewId', 'name', 'query'],
    ),
    parse: (input) => validateAs(UpdateViewInput, input),
    targetOf: (_context, input) => ({ viewId: input.viewId }),
    prepare: async (context, input) => {
      const view = await views.find(
        context.identity,
        context.scope,
        input.viewId,
      );
      return {
        summary: operationText(
          context,
          `Actualizar la vista «${view.name}» como «${input.name}».`,
          `Update the view “${view.name}” as “${input.name}”.`,
        ),
        plan: {
          viewId: view.id,
          name: input.name,
          visibility: input.visibility ?? view.visibility,
          query: asPlainJson(input.query),
        },
        target: { viewId: view.id, worksheetId: view.worksheetId },
      };
    },
    confirm: async ({ identity, scope }, plan) => {
      const body = await validateAs(SaveViewDto, {
        name: plan.name,
        visibility: plan.visibility,
        query: plan.query,
      });
      const view = await views.replace(
        identity,
        scope,
        String(plan.viewId),
        body,
      );
      return { savedViewId: view.id, worksheetId: view.worksheetId };
    },
  };
}

function listImportMappings({
  mappings,
}: Services): ReadOperation<PagedWorksheetInput> {
  return {
    name: 'list_import_mappings',
    description:
      'Plantillas de mapeo guardadas de una hoja (por defecto, la de la conversación): qué columna del archivo va a cada columna al importar.',
    level: 'read',
    permission: 'organization.read',
    inputSchema: objectSchema({ worksheetId: UUID_SCHEMA, ...PAGE_SCHEMA }),
    parse: (input) => validateAs(PagedWorksheetInput, input),
    targetOf: (context, input) => ({
      worksheetId: worksheetOf(context, input.worksheetId),
    }),
    execute: (context, input) =>
      mappings.findByWorksheet(
        context.identity,
        context.scope,
        worksheetOf(context, input.worksheetId),
        pageOf(input),
      ),
  };
}

function createImportMapping({
  worksheets,
  mappings,
}: Services): WriteOperation<MappingInput> {
  return {
    name: 'create_import_mapping',
    description:
      'Guarda una plantilla de mapeo para importar archivos en una hoja (por defecto, la de la conversación). mapping es el mismo objeto que usa la vista previa de importación.',
    level: 'write',
    permission: 'worksheet.write',
    inputSchema: objectSchema(
      {
        worksheetId: UUID_SCHEMA,
        name: NAME_SCHEMA,
        mapping: {
          type: 'object',
          description:
            'Correspondencias del archivo con las columnas, como en la vista previa de importación.',
        },
      },
      ['name', 'mapping'],
    ),
    parse: (input) => validateAs(MappingInput, input),
    targetOf: (context, input) => ({
      worksheetId: worksheetOf(context, input.worksheetId),
    }),
    prepare: async (context, input) => {
      const worksheetId = worksheetOf(context, input.worksheetId);
      const { worksheet } = await worksheets.findWorksheet(
        context.identity,
        context.scope,
        worksheetId,
      );
      return {
        summary: operationText(
          context,
          `Guardar la plantilla de mapeo «${input.name}» en la hoja «${worksheet.name}».`,
          `Save the mapping template “${input.name}” in the sheet “${worksheet.name}”.`,
        ),
        plan: {
          worksheetId,
          name: input.name,
          mapping: asPlainJson(input.mapping),
        },
        target: { worksheetId },
      };
    },
    confirm: async ({ identity, scope }, plan) => {
      const body = await validateAs(CreateImportMappingDto, {
        name: plan.name,
        mapping: plan.mapping,
      });
      const mapping = await mappings.create(
        identity,
        scope,
        String(plan.worksheetId),
        body,
      );
      return { mappingId: mapping.id, worksheetId: String(plan.worksheetId) };
    },
  };
}

function deleteImportMapping({
  mappings,
}: Services): WriteOperation<MappingRefInput> {
  return {
    name: 'delete_import_mapping',
    description:
      'Borra una plantilla de mapeo (IDs con list_import_mappings). Las importaciones hechas con ella no cambian.',
    level: 'write',
    permission: 'worksheet.write',
    inputSchema: objectSchema({ mappingId: UUID_SCHEMA }, ['mappingId']),
    parse: (input) => validateAs(MappingRefInput, input),
    targetOf: (_context, input) => ({ mappingId: input.mappingId }),
    prepare: async (context, input) => {
      const mapping = await mappings.find(
        context.identity,
        context.scope,
        input.mappingId,
      );
      return {
        summary: operationText(
          context,
          `Borrar la plantilla de mapeo «${mapping.name}».`,
          `Delete the mapping template “${mapping.name}”.`,
        ),
        plan: { mappingId: mapping.id },
        target: { mappingId: mapping.id, worksheetId: mapping.worksheetId },
      };
    },
    confirm: async ({ identity, scope }, plan) => {
      await mappings.delete(identity, scope, String(plan.mappingId));
      return { mappingId: plan.mappingId, deleted: true };
    },
  };
}

// ── Detalle ──

function workbookOf(
  { context }: OperationContext,
  workbookId: string | undefined,
): string {
  const resolved = workbookId ?? context.workbookId;
  if (!resolved) {
    throw apiError(ErrorCodes.WORKBOOK_NOT_FOUND);
  }
  return resolved;
}

function pageOf(input: PagedWorksheetInput) {
  return { limit: input.limit ?? 20, offset: input.offset ?? 0 };
}

/** El plan se guarda como JSON: sin las clases del DTO que lo validó. */
function asPlainJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
