import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AGENT_RUN_LIMITS,
  AGENT_RUN_OPTIONS,
  type AgentRunOptions,
} from '../agent-runs/agent-runs.types.js';
import type {
  AgentOperation,
  OperationContext,
  OperationDescription,
  WriteOperation,
} from '../agent-runs/operations/agent-operation.js';
import { AgentOperationCatalog } from '../agent-runs/operations/agent-operation-catalog.js';
import {
  toProposalView,
  type StoredProposal,
} from '../agent-runs/agent-runs.repository.js';
import { AI_AUTO_CONFIRM } from '../agent-runs/auto-confirm.js';
import { ProposalDecisions } from '../agent-runs/proposal-decisions.js';
import {
  knowledgeOperation,
  SEARCH_KNOWLEDGE,
} from '../agent-runs/operations/knowledge-operation.js';
import {
  canonicalHash,
  credentialHash,
  sameHash,
} from '../agent-runs/run-credential.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import {
  AI_SERVICE_CLIENT,
  AiServiceClient,
} from '../knowledge/ai-service.client.js';
import {
  can,
  type OrganizationRole,
} from '../organizations/organization-roles.js';
import { bearerOf, parseIntegrationToken } from './integration-token.js';
import type { IntegrationCallDto } from './integrations.dto.js';
import { IntegrationsRepository } from './integrations.repository.js';
import {
  EXTERNAL_CONTEXT,
  INTEGRATION_LIMITS,
  MCP_ADAPTER_TOKEN,
  type CredentialCapability,
  type Delegation,
} from './integrations.types.js';

import { CliOAuthAccess } from './cli-oauth-access.js';
import {
  confirmedWorksheetExportId,
  CREDENTIAL_TOOLS,
  fileContent,
  isCredentialTool,
  parseExportRef,
  parseFeedVersionRef,
  parseProposalRef,
  type CredentialToolName,
} from './credential-tools.js';
import { ExportsService } from '../exports/exports.service.js';
import { FeedsService } from '../feeds/feeds.service.js';
import { WorksheetExportsService } from '../worksheet-exports/worksheet-exports.service.js';
import { McpOAuthAccess } from './mcp-oauth-access.js';

type RequestedIntegration = Readonly<{
  authorization: string | undefined;
  requestId: string | undefined;
}> &
  (
    | Readonly<{ channel: 'cli'; project?: string }>
    | Readonly<{
        channel?: 'mcp';
        delegation: string | undefined;
        oauth?: string;
        project?: string;
      }>
  );
type McpRequest = Exclude<RequestedIntegration, { channel: 'cli' }>;

type AuthorizedDelegation = Readonly<{
  delegation: Delegation;
  role: OrganizationRole;
}>;

// El chat puede incorporar herramientas nuevas sin concedérselas a clientes externos.
const DELEGATED_OPERATIONS = new Map<string, readonly string[]>([
  ['get_project_overview', []],
  ['list_workbooks', []],
  ['list_worksheets', ['workbookId']],
  ['get_sheet_schema', ['worksheetId']],
  ['list_sheet_history', ['worksheetId']],
  ['open_changeset', []],
  ['compare_revisions', ['worksheetId']],
  ['find_duplicates', ['worksheetId']],
  ['query_rows', ['worksheetId']],
  ['select_rows', ['worksheetId']],
  ['preview_transform', ['worksheetId', 'selectionId']],
  ['get_catalog_snapshot', []],
  ['propose_catalog_from_sheet', ['worksheetId']],
  ['create_ruleset', []],
  ['preview_rules', []],
  ['request_evaluation', []],
  ['get_evaluation_report', []],
  ['get_ruleset', []],
  ['get_feed_status', []],
  ['list_feed_products', []],
  ['create_change_proposal', ['worksheetId']],
  ['prepare_sheet_edits', ['worksheetId']],
  ['propose_sheet_layout', ['workbookId']],
  ['suggest_view', ['worksheetId']],
  ['create_workbook', []],
  ['rename_workbook', ['workbookId']],
  ['rename_worksheet', ['worksheetId']],
  ['archive_workbook', ['workbookId']],
  ['restore_workbook', ['workbookId']],
  ['archive_worksheet', ['worksheetId']],
  ['restore_worksheet', ['worksheetId']],
  ['apply_changeset', []],
  ['cancel_changeset', []],
  ['delete_saved_view', []],
  ['approve_export', []],
  ['publish_feed', []],
]);

// Ampliación para clientes externos: la CLI desde su creación y el MCP desde
// el 2026-11-21 (paridad con la CLI). Señalan la entidad que el chat infiere.
const CLI_OPERATIONS = new Map<string, readonly string[]>([
  ['submit_changeset', ['changesetId']],
  ['reopen_changeset', ['changesetId']],
  ['reject_changeset', ['changesetId']],
  ['rebase_changeset', ['changesetId']],
  ['propose_revert', ['revisionId']],
  ['duplicate_worksheet', ['worksheetId']],
  ['open_catalog_as_worksheet', ['snapshotId', 'workbookId']],
  ['export_worksheet', ['worksheetId']],
  ['list_saved_views', ['worksheetId']],
  ['update_saved_view', ['viewId']],
  ['list_import_mappings', ['worksheetId']],
  ['create_import_mapping', ['worksheetId']],
  ['delete_import_mapping', ['mappingId']],
  ['list_catalog_imports', []],
  ['delete_catalog_import', ['snapshotId']],
  ['set_feed_source', ['feedId']],
  ['set_feed_schedule', ['feedId']],
  ['approve_feed_policy', ['feedId']],
  ['create_feed', []],
  ['list_feed_versions', ['feedId']],
  ['get_feed_delivery_status', ['feedId']],
  ['get_feed_configuration', ['feedId']],
  ['get_feed_refresh', ['feedId', 'refreshId']],
  ['refresh_feed', ['feedId']],
  ['republish_feed_version', ['feedId', 'versionId']],
  ['disable_feed_delivery', ['feedId']],
]);

/** Los selectores obligatorios de una operación externa; sin ellos, no se ofrece. */
function selectorsOf(name: string) {
  return CLI_OPERATIONS.get(name) ?? DELEGATED_OPERATIONS.get(name);
}

@Injectable()
export class IntegrationGatewayService {
  private readonly logger = new Logger(IntegrationGatewayService.name);

  constructor(
    private readonly repository: IntegrationsRepository,
    private readonly catalog: AgentOperationCatalog,
    private readonly oauth: McpOAuthAccess,
    private readonly cliOAuth: CliOAuthAccess,
    @Inject(MCP_ADAPTER_TOKEN)
    private readonly adapterToken: string | null,
    @Inject(AI_SERVICE_CLIENT)
    private readonly ai: AiServiceClient | null,
    @Inject(AGENT_RUN_OPTIONS)
    private readonly options: AgentRunOptions,
    private readonly decisions: ProposalDecisions,
    @Inject(AI_AUTO_CONFIRM)
    private readonly autoConfirm: boolean,
    private readonly worksheetExports: WorksheetExportsService,
    private readonly catalogExports: ExportsService,
    private readonly feeds: FeedsService,
  ) {}

  async session(headers: RequestedIntegration) {
    const access = await this.authorizeRequest(headers);
    const { delegation } = access;
    const capabilities: CredentialCapability[] = ['read'];
    if (canPrepare(access)) {
      capabilities.push('prepare');
    }
    return {
      credentialId: delegation.credentialId,
      audience: audienceOf(headers),
      ...(headers.channel === 'cli' &&
        headers.project && { authentication: 'oauth' }),
      organizationId: delegation.scope.organizationId,
      projectId: delegation.scope.projectId,
      capabilities,
      expiresAt: delegation.expiresAt,
    };
  }

  async operations(
    headers: RequestedIntegration,
  ): Promise<{ operations: OperationDescription[] }> {
    const access = await this.authorizeRequest(headers);
    const allowed = this.catalog
      .all(true)
      .filter(
        (operation) =>
          selectorsOf(operation.name) !== undefined &&
          canUse(access, operation),
      );
    const knowledge = knowledgeOperation(this.ai, headers.requestId);
    if (knowledge) {
      allowed.push(knowledge);
    }
    return {
      operations: [
        ...this.catalog.describe(allowed).map(withRequiredSelectors),
        ...CREDENTIAL_TOOLS,
      ],
    };
  }

  async call(
    headers: RequestedIntegration,
    name: string,
    body: IntegrationCallDto,
  ): Promise<unknown> {
    const access = await this.authorizeRequest(headers);
    if (isCredentialTool(name)) {
      return this.callCredentialTool(access, headers, name, body);
    }
    const selectors = selectorsOf(name);
    const operation =
      name === SEARCH_KNOWLEDGE
        ? knowledgeOperation(this.ai, headers.requestId)
        : selectors && this.catalog.find(name, true);
    if (!operation) {
      throw apiError(ErrorCodes.AGENT_OPERATION_NOT_FOUND);
    }

    try {
      assertCallAllowed(access, operation, body, selectors ?? []);
      const result = await this.runOperation(
        access.delegation,
        operation,
        body,
        this.autoConfirm,
      );
      // Entre la autorización inicial y el resultado pudo cambiar la membresía
      // o revocarse el secreto, en particular durante la búsqueda remota.
      assertOperationAccess(await this.authenticate(headers), operation);
      this.audit(access.delegation, name, 'succeeded', headers);
      return result;
    } catch (error) {
      this.audit(access.delegation, name, 'failed', headers);
      throw error;
    }
  }

  /** Una propuesta de esta credencial, con `expired` si venció sin decidir. */
  async proposalAccess(headers: RequestedIntegration, proposalId: string) {
    const access = await this.authorizeRequest(headers);
    const stored = await this.repository.findOwnerProposal(
      access.delegation.scope,
      access.delegation.actorId,
      proposalId,
      access.delegation.credentialId,
    );
    const operation = this.catalog.find(stored.operation, true);
    if (!operation || !canUse(access, operation)) {
      throw apiError(ErrorCodes.AGENT_PROPOSAL_NOT_FOUND);
    }
    const proposal = toProposalView(stored);
    const status =
      proposal.status === 'ready' &&
      Date.parse(proposal.expiresAt) <= this.options.clock().getTime()
        ? 'expired'
        : proposal.status;
    const { hash: _hash, ...view } = proposal;
    return { delegation: access.delegation, proposal: { ...view, status } };
  }

  async reader(headers: RequestedIntegration) {
    return (await this.authorizeRequest(headers)).delegation;
  }

  /**
   * Las lecturas de la credencial que la CLI hace con sus propias rutas
   * (estado y archivos): el MCP las usa como herramientas.
   */
  private async callCredentialTool(
    access: AuthorizedDelegation,
    headers: RequestedIntegration,
    name: CredentialToolName,
    body: IntegrationCallDto,
  ) {
    if (body.mode !== 'execute') {
      throw apiError(ErrorCodes.AGENT_OPERATION_MODE_INVALID);
    }
    try {
      const result = await this.readForCredential(
        headers,
        name,
        body.arguments,
      );
      this.audit(access.delegation, name, 'succeeded', headers);
      return result;
    } catch (error) {
      this.audit(access.delegation, name, 'failed', headers);
      throw error;
    }
  }

  private async readForCredential(
    headers: RequestedIntegration,
    name: CredentialToolName,
    input: Record<string, unknown>,
  ) {
    switch (name) {
      case 'get_proposal_status': {
        const { proposalId } = await parseProposalRef(input);
        return {
          proposal: (await this.proposalAccess(headers, proposalId)).proposal,
        };
      }
      case 'read_worksheet_export_file': {
        const { proposalId } = await parseProposalRef(input);
        const { proposal, delegation } = await this.proposalAccess(
          headers,
          proposalId,
        );
        const exportId = confirmedWorksheetExportId(proposal);
        const { content, file } = await this.worksheetExports.openDownload(
          delegation.identity,
          delegation.scope,
          exportId,
        );
        return fileContent(
          content,
          `hoja-${exportId}.${file.format}`,
          file.format === 'csv'
            ? 'text/csv; charset=utf-8'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );
      }
      case 'read_catalog_export_file': {
        const { exportId } = await parseExportRef(input);
        const { identity, scope } = await this.reader(headers);
        const { content } = await this.catalogExports.openDownload(
          identity,
          scope.projectId,
          exportId,
        );
        return fileContent(
          content,
          `export-${exportId}.tsv`,
          'text/tab-separated-values; charset=utf-8',
        );
      }
      case 'read_feed_version_file': {
        const { feedId, versionId } = await parseFeedVersionRef(input);
        const { identity, scope } = await this.reader(headers);
        const { content } = await this.feeds.openVersionFile(
          identity,
          scope.projectId,
          feedId,
          versionId,
        );
        return fileContent(
          content,
          `feed-${versionId}.tsv`,
          'text/tab-separated-values; charset=utf-8',
        );
      }
    }
  }

  private async authorizeRequest(
    headers: RequestedIntegration,
  ): Promise<AuthorizedDelegation> {
    const access = await this.authenticate(headers);
    await this.repository.recordUse(access.delegation, this.options.clock());
    return access;
  }

  private async authenticate(
    headers: RequestedIntegration,
  ): Promise<AuthorizedDelegation> {
    const stored =
      headers.channel === 'cli'
        ? headers.project === undefined
          ? await this.authenticateOpaque(headers.authorization, 'cli')
          : await this.cliOAuth.authenticate(
              headers.authorization,
              headers.project,
              this.options.clock(),
            )
        : await this.authenticateMcp(headers);
    const access = await this.repository.requireMember(
      stored.scope,
      stored.actorId,
    );
    if (access.isArchived) {
      throw apiError(ErrorCodes.ORGANIZATION_ARCHIVED);
    }
    return { delegation: stored, role: access.role };
  }

  private async authenticateMcp(headers: McpRequest): Promise<Delegation> {
    if (!this.adapterToken) {
      throw apiError(ErrorCodes.INTEGRATIONS_UNAVAILABLE);
    }
    const presented = bearerOf(headers.authorization);
    const matchesAdapter =
      presented &&
      sameHash(credentialHash(this.adapterToken), credentialHash(presented));
    if (!matchesAdapter) {
      throw apiError(ErrorCodes.INTEGRATION_ADAPTER_INVALID);
    }
    if (
      (headers.oauth !== undefined && headers.delegation !== undefined) ||
      (headers.oauth === undefined && headers.project !== undefined)
    ) {
      throw apiError(ErrorCodes.INTEGRATION_CREDENTIAL_INVALID);
    }
    return headers.oauth === undefined
      ? this.authenticateOpaque(headers.delegation, 'mcp')
      : this.oauth.authenticate(
          headers.oauth,
          this.options.clock(),
          headers.project,
        );
  }

  private async authenticateOpaque(
    header: string | undefined,
    audience: 'mcp' | 'cli',
  ): Promise<Delegation> {
    const token = parseIntegrationToken(header);
    const stored = token
      ? await this.repository.findDelegation(token.credentialId)
      : null;
    const isValid =
      token !== null &&
      stored !== null &&
      sameHash(stored.secretHash, credentialHash(token.secret)) &&
      stored.audience === audience &&
      stored.revokedAt === null &&
      stored.expiresAt > this.options.clock().toISOString();
    if (!isValid) {
      throw apiError(ErrorCodes.INTEGRATION_CREDENTIAL_INVALID);
    }
    return stored;
  }

  private async runOperation(
    delegation: Delegation,
    operation: AgentOperation,
    body: IntegrationCallDto,
    autoConfirm: boolean,
  ) {
    const input = await operation.parse(body.arguments);
    const context: OperationContext = {
      identity: delegation.identity,
      actorId: delegation.actorId,
      scope: delegation.scope,
      context: EXTERNAL_CONTEXT,
    };
    if (operation.level === 'read') {
      const result = (await operation.execute(context, input)) ?? null;
      if (jsonBytes(result) > AGENT_RUN_LIMITS.readResultBytes) {
        throw apiError(ErrorCodes.AGENT_RESULT_TOO_LARGE);
      }
      return result;
    }
    return this.prepare(
      operation,
      delegation,
      context,
      input,
      body,
      autoConfirm,
    );
  }

  private async prepare(
    operation: WriteOperation,
    delegation: Delegation,
    context: OperationContext,
    input: unknown,
    body: IntegrationCallDto,
    autoConfirm: boolean,
  ) {
    const call = {
      id: body.callId,
      operation: operation.name,
      argumentsHash: canonicalHash(body.arguments),
    };
    const existing = await this.repository.findPreparedCall(delegation, call);
    const proposal =
      existing ??
      (await this.prepareNew(operation, delegation, context, input, call));
    if (autoConfirm) {
      const confirmed = await this.confirmNow(delegation, context, proposal);
      return {
        proposalId: confirmed.id,
        status: confirmed.status,
        summary: confirmed.summary,
        result: confirmed.result,
        ...(confirmed.error && { error: confirmed.error }),
      };
    }
    return {
      proposalId: proposal.id,
      summary: proposal.summary,
      expiresAt: proposal.expiresAt,
      reviewPath: `/projects/${delegation.scope.projectId}/integrations/proposals/${proposal.id}`,
    };
  }

  /**
   * La misma confirmación que hace la persona en la web: plan guardado,
   * hash, permisos vigentes y credencial activa. Repetir la llamada devuelve
   * el resultado ya guardado.
   */
  private confirmNow(
    delegation: Delegation,
    context: OperationContext,
    proposal: StoredProposal,
  ) {
    const { scope, actorId } = delegation;
    return this.decisions.confirm(
      context,
      () => this.repository.findOwnerProposal(scope, actorId, proposal.id),
      proposal.hash,
      (stored, permission) =>
        this.repository.beginConfirm(
          scope,
          actorId,
          stored,
          permission,
          this.options.clock,
        ),
    );
  }

  private async prepareNew(
    operation: WriteOperation,
    delegation: Delegation,
    context: OperationContext,
    input: unknown,
    call: Parameters<IntegrationsRepository['insertProposal']>[1],
  ) {
    const prepared = await operation.prepare(context, input);
    return this.repository.insertProposal(
      delegation,
      call,
      {
        plan: prepared.plan,
        target: prepared.target,
        summary: prepared.summary.slice(0, 2000),
        hash: canonicalHash({ operation: operation.name, plan: prepared.plan }),
      },
      operation.permission,
      this.options.clock,
    );
  }

  private audit(
    delegation: Delegation,
    operation: string,
    status: 'succeeded' | 'failed',
    headers: RequestedIntegration,
  ) {
    this.logger.log({
      code: 'INTEGRATION_CALL',
      channel: audienceOf(headers),
      credentialId: delegation.credentialId,
      actorId: delegation.actorId,
      ...delegation.scope,
      operation,
      status,
      requestId: headers.requestId,
    });
  }
}

function audienceOf(
  headers: RequestedIntegration,
): 'cli' | 'mcp' | 'mcp_oauth' {
  if (headers.channel === 'cli') return 'cli';
  return headers.oauth === undefined ? 'mcp' : 'mcp_oauth';
}

function assertCallAllowed(
  access: AuthorizedDelegation,
  operation: AgentOperation,
  body: IntegrationCallDto,
  selectors: readonly string[],
) {
  assertOperationAccess(access, operation);
  const expectedMode = operation.level === 'read' ? 'execute' : 'prepare';
  if (body.mode !== expectedMode) {
    throw apiError(ErrorCodes.AGENT_OPERATION_MODE_INVALID);
  }
  if (jsonBytes(body.arguments) > INTEGRATION_LIMITS.argumentsBytes) {
    throw apiError(ErrorCodes.PAYLOAD_TOO_LARGE);
  }
  if (selectors.some((name) => body.arguments[name] == null)) {
    throw apiError(ErrorCodes.VALIDATION_FAILED);
  }
}

function assertOperationAccess(
  access: AuthorizedDelegation,
  operation: AgentOperation,
) {
  if (operation.level === 'write' && !canPrepare(access)) {
    throw apiError(ErrorCodes.INTEGRATION_CAPABILITY_REQUIRED);
  }
  if (!can(access.role, operation.permission)) {
    throw apiError(ErrorCodes.FORBIDDEN);
  }
}

function canPrepare({ delegation, role }: AuthorizedDelegation) {
  return delegation.canPrepare && can(role, 'ai.use');
}

function canUse(access: AuthorizedDelegation, operation: AgentOperation) {
  return (
    (operation.level === 'read' || canPrepare(access)) &&
    can(access.role, operation.permission)
  );
}

function withRequiredSelectors(
  operation: OperationDescription,
): OperationDescription {
  const selectors = selectorsOf(operation.name);
  if (!selectors?.length) {
    return operation;
  }
  const required = Array.isArray(operation.inputSchema.required)
    ? operation.inputSchema.required
    : [];
  const description =
    operation.name === 'list_worksheets'
      ? 'Hojas de un libro con su número de filas.'
      : operation.description;
  return {
    ...operation,
    description,
    inputSchema: {
      ...operation.inputSchema,
      required: [...new Set([...required, ...selectors])],
    },
  };
}

function jsonBytes(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}
