import { IsUUID, isUUID } from 'class-validator';
import type { Readable } from 'node:stream';
import type { OperationDescription } from '../agent-runs/operations/agent-operation.js';
import { objectSchema } from '../agent-runs/operations/operation-inputs.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { validateAs } from '../common/http/validation-options.js';

/*
 * Lo que la CLI hace fuera del catálogo de operaciones, para que el MCP pueda
 * hacer lo mismo (paridad pedida el 2026-11-21): ver el estado de una
 * propuesta de esta credencial y leer los archivos que la CLI descarga. Son
 * lecturas; los archivos vuelven como texto (CSV o TSV) o en base64 (XLSX)
 * porque un cliente MCP no escribe en el disco de la persona.
 */

const UUID_SCHEMA = { type: 'string', format: 'uuid' } as const;

/** Un archivo más grande se descarga con la CLI o desde la web. */
export const CREDENTIAL_FILE_MAX_BYTES = 1024 * 1024;

export const CREDENTIAL_TOOL_NAMES = [
  'get_proposal_status',
  'read_worksheet_export_file',
  'read_catalog_export_file',
  'read_feed_version_file',
] as const;
export type CredentialToolName = (typeof CREDENTIAL_TOOL_NAMES)[number];

export const CREDENTIAL_TOOLS: readonly OperationDescription[] = [
  {
    name: 'get_proposal_status',
    description:
      'Estado de una propuesta preparada con esta credencial: ready, confirming, confirmed, failed, rejected o expired, con su resultado o el motivo del fallo. Como `proposals status` de la CLI.',
    inputSchema: objectSchema({ proposalId: UUID_SCHEMA }, ['proposalId']),
    level: 'read',
  },
  {
    name: 'read_worksheet_export_file',
    description:
      'Contenido del archivo de una exportación de hoja (export_worksheet) ya confirmada, por el ID de su propuesta. CSV en texto; XLSX en base64. Hasta 1 MiB. Como `proposals download` de la CLI.',
    inputSchema: objectSchema({ proposalId: UUID_SCHEMA }, ['proposalId']),
    level: 'read',
  },
  {
    name: 'read_catalog_export_file',
    description:
      'Contenido TSV de una exportación aprobada del catálogo (approve_export). Hasta 1 MiB. Como `exports download` de la CLI.',
    inputSchema: objectSchema({ exportId: UUID_SCHEMA }, ['exportId']),
    level: 'read',
  },
  {
    name: 'read_feed_version_file',
    description:
      'Contenido TSV de una versión publicada del feed (IDs con list_feed_versions). Hasta 1 MiB. Como `feed download` de la CLI.',
    inputSchema: objectSchema({ feedId: UUID_SCHEMA, versionId: UUID_SCHEMA }, [
      'feedId',
      'versionId',
    ]),
    level: 'read',
  },
];

class ProposalRef {
  @IsUUID()
  proposalId!: string;
}

class ExportRef {
  @IsUUID()
  exportId!: string;
}

class FeedVersionRef {
  @IsUUID()
  feedId!: string;

  @IsUUID()
  versionId!: string;
}

export function isCredentialTool(name: string): name is CredentialToolName {
  return CREDENTIAL_TOOL_NAMES.some((tool) => tool === name);
}

export const parseProposalRef = (input: unknown) =>
  validateAs(ProposalRef, input);
export const parseExportRef = (input: unknown) => validateAs(ExportRef, input);
export const parseFeedVersionRef = (input: unknown) =>
  validateAs(FeedVersionRef, input);

/**
 * El ID de la exportación que creó una propuesta `export_worksheet`
 * confirmada. Cualquier otra propuesta no tiene archivo (404).
 */
export function confirmedWorksheetExportId(
  proposal: Readonly<{ operation: string; status: string; result: unknown }>,
): string {
  const result = proposal.result;
  const exportId =
    result && typeof result === 'object' && 'exportId' in result
      ? result.exportId
      : undefined;
  const isConfirmedExport =
    proposal.operation === 'export_worksheet' &&
    proposal.status === 'confirmed' &&
    typeof exportId === 'string' &&
    isUUID(exportId);
  if (!isConfirmedExport) {
    throw apiError(ErrorCodes.WORKSHEET_EXPORT_NOT_FOUND);
  }
  return exportId;
}

/** El archivo en memoria, sin pasar del tope: si lo pasa, 422 y la CLI. */
export async function fileContent(
  stream: Readable,
  fileName: string,
  contentType: string,
) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > CREDENTIAL_FILE_MAX_BYTES) {
      stream.destroy();
      throw apiError(ErrorCodes.AGENT_RESULT_TOO_LARGE);
    }
    chunks.push(buffer);
  }
  const content = Buffer.concat(chunks);
  const isText = contentType.startsWith('text/');
  return {
    fileName,
    contentType,
    encoding: isText ? 'utf-8' : 'base64',
    bytes,
    content: isText ? content.toString('utf8') : content.toString('base64'),
  };
}
