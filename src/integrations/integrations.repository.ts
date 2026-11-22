import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AgentRunsRepository,
  PROPOSAL_COLUMNS,
  type StoredProposal,
} from '../agent-runs/agent-runs.repository.js';
import { AGENT_RUN_LIMITS } from '../agent-runs/agent-runs.types.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { lockOrganization } from '../organizations/organization-lock.js';
import {
  can,
  type OrganizationPermission,
} from '../organizations/organization-roles.js';
import {
  assertProjectPermission,
  joinProjectAccess,
  PROJECT_ACCESS_COLUMNS,
  type ProjectMemberAccess,
} from '../projects/project-access.js';
import type { ProjectScope } from '../worksheets/worksheets.types.js';
import {
  CREDENTIAL_AUDIENCES,
  INTEGRATION_LIMITS,
  type CredentialAudience,
  type CredentialView,
  type Delegation,
} from './integrations.types.js';

type DatabaseReader = Pick<Prisma.TransactionClient, '$queryRaw'>;

type CredentialRow = Readonly<{
  id: string;
  ownerId: string;
  label: string;
  audience: CredentialAudience;
  canPrepare: boolean;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}>;

export type StoredDelegation = Delegation &
  Readonly<{ secretHash: string; revokedAt: string | null; audience: string }>;

type NewCredential = Readonly<{
  label: string;
  canPrepare: boolean;
  secretHash: string;
  expiresAt: Date;
  issueKey: string;
  audience: CredentialAudience;
  resourceUrl: string | null;
}>;

export type PreparedCall = Readonly<{
  id: string;
  operation: string;
  argumentsHash: string;
}>;

type NewProposal = Readonly<{
  plan: Record<string, unknown>;
  target: Record<string, unknown> | null;
  summary: string;
  hash: string;
}>;

const PROJECT_QUOTA_SUBJECT = '*';
const MINUTE_MS = 60_000;

const MANAGED_AUDIENCES = Prisma.join(CREDENTIAL_AUDIENCES);
const CREDENTIAL_COLUMNS = Prisma.sql`
  c.id,
  c.owner_id AS "ownerId",
  c.label,
  c.audience,
  c.can_prepare AS "canPrepare",
  c.created_at AS "createdAt",
  c.expires_at AS "expiresAt",
  c.revoked_at AS "revokedAt",
  c.last_used_at AS "lastUsedAt"`;

@Injectable()
export class IntegrationsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly proposals: AgentRunsRepository,
  ) {}

  requireMember(scope: ProjectScope, actorId: string) {
    return requireScopedAccess(
      this.prisma,
      scope,
      actorId,
      'organization.read',
    );
  }

  /** El bloqueo ordena las emisiones simultáneas y los cambios de membresía. */
  async insert(
    scope: ProjectScope,
    ownerId: string,
    credential: NewCredential,
    now: Date,
  ): Promise<CredentialView> {
    return this.prisma.$transaction(async (tx) => {
      await lockOrganization(tx, scope.organizationId);
      const permission = credential.canPrepare ? 'ai.use' : 'organization.read';
      const access = await requireScopedAccess(tx, scope, ownerId, permission);
      if (access.isArchived) {
        throw apiError(ErrorCodes.ORGANIZATION_ARCHIVED);
      }
      await assertCanIssue(tx, scope, ownerId, credential.issueKey, now);
      const oauthAudience = credential.audience;
      if (
        credential.resourceUrl &&
        (oauthAudience === 'mcp_oauth' || oauthAudience === 'cli_oauth') &&
        (await this.oauthGrant(
          scope,
          ownerId,
          credential.resourceUrl,
          now,
          tx,
          oauthAudience,
        ))
      ) {
        throw apiError(ErrorCodes.INTEGRATION_OAUTH_GRANT_EXISTS);
      }
      const rows = await tx.$queryRaw<CredentialRow[]>`
        INSERT INTO estadistica_forms.integration_credentials AS c
          (id, organization_id, project_id, owner_id, label, audience,
           can_prepare, secret_hash, issue_key, created_at, expires_at, resource_url)
        VALUES (
          ${randomUUID()}, ${scope.organizationId}, ${scope.projectId}, ${ownerId},
          ${credential.label}, ${credential.audience}, ${credential.canPrepare}, ${credential.secretHash},
          ${credential.issueKey}, ${now.toISOString()}, ${credential.expiresAt.toISOString()}, ${credential.resourceUrl}
        )
        RETURNING ${CREDENTIAL_COLUMNS}`;
      return toCredentialView(rows[0], now);
    });
  }

  async list(
    scope: ProjectScope,
    ownerId: string | null,
    page: { limit: number; cursor?: string },
    now: Date,
  ) {
    const filter = Prisma.sql`
      c.organization_id = ${scope.organizationId} AND c.project_id = ${scope.projectId}
      AND c.audience IN (${MANAGED_AUDIENCES})
      AND (${ownerId}::text IS NULL OR c.owner_id = ${ownerId})`;
    const after = await credentialAfter(this.prisma, filter, page.cursor);
    const rows = await this.prisma.$queryRaw<CredentialRow[]>`
      SELECT ${CREDENTIAL_COLUMNS}
      FROM estadistica_forms.integration_credentials c
      WHERE ${filter} ${after}
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT ${page.limit + 1}`;
    const items = rows
      .slice(0, page.limit)
      .map((row) => toCredentialView(row, now));
    return {
      items,
      nextCursor: rows.length > page.limit ? (items.at(-1)?.id ?? null) : null,
    };
  }

  /** Revocar también se puede en una organización archivada. */
  async revoke(
    scope: ProjectScope,
    credentialId: string,
    actorId: string,
    now: Date,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await lockOrganization(tx, scope.organizationId);
      const access = await requireScopedAccess(
        tx,
        scope,
        actorId,
        'organization.read',
      );
      const rows = await tx.$queryRaw<{ ownerId: string }[]>`
        SELECT owner_id AS "ownerId" FROM estadistica_forms.integration_credentials
        WHERE id = ${credentialId} AND organization_id = ${scope.organizationId}
          AND project_id = ${scope.projectId} AND audience IN (${MANAGED_AUDIENCES})`;
      const credential = rows[0];
      if (
        !credential ||
        (credential.ownerId !== actorId && !can(access.role, 'members.manage'))
      ) {
        throw apiError(ErrorCodes.INTEGRATION_CREDENTIAL_NOT_FOUND);
      }
      await tx.$executeRaw`
        UPDATE estadistica_forms.integration_credentials
        SET revoked_at = ${now.toISOString()}, revoked_by = ${actorId}
        WHERE id = ${credentialId} AND revoked_at IS NULL`;
    });
  }

  async oauthGrant(
    scope: ProjectScope,
    actorId: string,
    resource: string,
    now: Date,
    db: DatabaseReader = this.prisma,
    audience: 'mcp_oauth' | 'cli_oauth' = 'mcp_oauth',
  ) {
    const [grant] = await db.$queryRaw<CredentialRow[]>`
      SELECT ${CREDENTIAL_COLUMNS}
      FROM estadistica_forms.integration_credentials c
      WHERE c.organization_id = ${scope.organizationId} AND c.project_id = ${scope.projectId}
        AND c.owner_id = ${actorId} AND c.audience = ${audience}
        AND c.resource_url = ${resource} AND c.revoked_at IS NULL
        AND c.expires_at > ${now.toISOString()}`;
    return grant ?? null;
  }

  async oauthGrantForProject(
    projectId: string,
    actorId: string,
    resource: string,
    now: Date,
    audience: 'mcp_oauth' | 'cli_oauth',
  ) {
    const [grant] = await this.prisma.$queryRaw<
      (CredentialRow & { organizationId: string })[]
    >`
      SELECT ${CREDENTIAL_COLUMNS}, c.organization_id AS "organizationId"
      FROM estadistica_forms.integration_credentials c
      WHERE c.project_id = ${projectId} AND c.owner_id = ${actorId}
        AND c.audience = ${audience} AND c.resource_url = ${resource}
        AND c.revoked_at IS NULL AND c.expires_at > ${now.toISOString()}`;
    return grant ?? null;
  }

  async findDelegation(credentialId: string): Promise<StoredDelegation | null> {
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        organizationId: string;
        projectId: string;
        ownerId: string;
        issuer: string;
        subject: string;
        canPrepare: boolean;
        audience: string;
        secretHash: string;
        expiresAt: string;
        revokedAt: string | null;
      }[]
    >`
      SELECT c.id,
             c.organization_id AS "organizationId",
             c.project_id AS "projectId",
             c.owner_id AS "ownerId",
             u.identity_issuer AS issuer,
             u.identity_subject AS subject,
             c.can_prepare AS "canPrepare",
             c.audience,
             c.secret_hash AS "secretHash",
             c.expires_at AS "expiresAt",
             c.revoked_at AS "revokedAt"
      FROM estadistica_forms.integration_credentials c
      JOIN estadistica_forms.app_users u ON u.id = c.owner_id
      WHERE c.id = ${credentialId}`;
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      credentialId: row.id,
      scope: { organizationId: row.organizationId, projectId: row.projectId },
      actorId: row.ownerId,
      identity: { issuer: row.issuer, subject: row.subject },
      canPrepare: row.canPrepare,
      expiresAt: row.expiresAt,
      audience: row.audience,
      secretHash: row.secretHash,
      revokedAt: row.revokedAt,
    };
  }

  /** Las dos cuotas se reservan juntas, incluso entre procesos de Nest. */
  async recordUse(delegation: Delegation, now: Date) {
    const minute = new Date(
      Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS,
    ).toISOString();
    const { projectId } = delegation.scope;
    await this.prisma.$transaction(async (tx) => {
      const usage = await tx.$queryRaw<{ subject: string; used: number }[]>`
        INSERT INTO estadistica_forms.integration_usage AS u (project_id, subject, minute, used)
        VALUES (${projectId}, ${PROJECT_QUOTA_SUBJECT}, ${minute}, 1),
               (${projectId}, ${delegation.actorId}, ${minute}, 1)
        ON CONFLICT (project_id, subject) DO UPDATE
        SET minute = EXCLUDED.minute,
            used = CASE WHEN u.minute = EXCLUDED.minute THEN u.used + 1 ELSE 1 END
        RETURNING subject, used`;
      if (usage.some(exceedsQuota)) {
        throw apiError(ErrorCodes.INTEGRATION_QUOTA_EXCEEDED);
      }
      const before = new Date(
        now.getTime() - INTEGRATION_LIMITS.lastUsedEveryMs,
      ).toISOString();
      await tx.$executeRaw`
        UPDATE estadistica_forms.integration_credentials
        SET last_used_at = ${now.toISOString()}
        WHERE id = ${delegation.credentialId}
          AND revoked_at IS NULL
          AND (last_used_at IS NULL OR last_used_at <= ${before})`;
    });
  }

  findPreparedCall(delegation: Delegation, call: PreparedCall) {
    return proposalForCall(this.prisma, delegation.credentialId, call);
  }

  async insertProposal(
    delegation: Delegation,
    call: PreparedCall,
    proposal: NewProposal,
    permission: OrganizationPermission,
    clock: () => Date,
  ): Promise<StoredProposal> {
    return this.prisma.$transaction(async (tx) => {
      const { scope, actorId, credentialId } = delegation;
      await lockOrganization(tx, scope.organizationId);
      await assertCanPrepare(tx, scope, actorId, permission);
      const now = clock();
      if (
        delegation.expiresAt <= now.toISOString() ||
        !(await isCredentialActive(tx, credentialId, now))
      ) {
        throw apiError(ErrorCodes.INTEGRATION_CREDENTIAL_INVALID);
      }
      const existing = await proposalForCall(tx, credentialId, call);
      if (existing) {
        return existing;
      }
      const pending = await tx.$queryRaw<{ total: number }[]>`
        SELECT count(*)::int AS total FROM estadistica_forms.ai_proposals
        WHERE credential_id = ${credentialId}
          AND status IN ('ready', 'confirming') AND expires_at > ${now.toISOString()}`;
      if ((pending[0]?.total ?? 0) >= INTEGRATION_LIMITS.pendingProposals) {
        throw apiError(ErrorCodes.INTEGRATION_QUOTA_EXCEEDED);
      }
      const expiresAt = new Date(
        Math.min(
          now.getTime() + AGENT_RUN_LIMITS.proposalTtlMs,
          Date.parse(delegation.grantExpiresAt ?? delegation.expiresAt),
        ),
      ).toISOString();
      const rows = await tx.$queryRaw<StoredProposal[]>`
        INSERT INTO estadistica_forms.ai_proposals AS p
          (id, organization_id, project_id, actor_id, credential_id, call_id,
           arguments_hash, operation, plan, target, summary, hash, status, expires_at, created_at)
        VALUES (
          ${randomUUID()}, ${scope.organizationId}, ${scope.projectId},
          ${actorId}, ${credentialId}, ${call.id}, ${call.argumentsHash}, ${call.operation},
          ${JSON.stringify(proposal.plan)}::jsonb,
          ${proposal.target === null ? null : JSON.stringify(proposal.target)}::jsonb,
          ${proposal.summary}, ${proposal.hash}, 'ready', ${expiresAt}, ${now.toISOString()}
        )
        RETURNING ${PROPOSAL_COLUMNS}`;
      return rows[0];
    });
  }

  async findOwnerProposal(
    scope: ProjectScope,
    actorId: string,
    proposalId: string,
    credentialId?: string,
  ): Promise<StoredProposal & { audience: CredentialAudience }> {
    const rows = await this.prisma.$queryRaw<
      (StoredProposal & { audience: CredentialAudience })[]
    >`
      SELECT ${PROPOSAL_COLUMNS}, c.audience
      FROM estadistica_forms.ai_proposals p
      JOIN estadistica_forms.integration_credentials c ON c.id = p.credential_id
      WHERE p.id = ${proposalId}
        AND p.organization_id = ${scope.organizationId}
        AND p.project_id = ${scope.projectId}
        AND p.actor_id = ${actorId}
        AND (${credentialId ?? null}::text IS NULL OR p.credential_id = ${credentialId ?? null})`;
    if (!rows[0]) {
      throw apiError(ErrorCodes.AGENT_PROPOSAL_NOT_FOUND);
    }
    return rows[0];
  }

  /** Revocar y reservar la confirmación se ordenan con el mismo bloqueo. */
  async beginConfirm(
    scope: ProjectScope,
    actorId: string,
    proposal: StoredProposal,
    permission: OrganizationPermission,
    clock: () => Date,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await lockOrganization(tx, scope.organizationId);
      await assertCanPrepare(tx, scope, actorId, permission);
      const now = clock();
      const origins = await tx.$queryRaw<{ credentialId: string }[]>`
        SELECT credential_id AS "credentialId" FROM estadistica_forms.ai_proposals
        WHERE id = ${proposal.id} AND actor_id = ${actorId}
          AND organization_id = ${scope.organizationId} AND project_id = ${scope.projectId}
          AND credential_id IS NOT NULL`;
      if (
        !origins[0] ||
        !(await isCredentialActive(tx, origins[0].credentialId, now))
      ) {
        throw apiError(ErrorCodes.AGENT_PROPOSAL_EXPIRED);
      }
      return this.proposals.beginConfirm(proposal.id, proposal.hash, now, tx);
    });
  }
}

async function requireScopedAccess(
  db: DatabaseReader,
  scope: ProjectScope,
  actorId: string,
  permission: OrganizationPermission,
): Promise<ProjectMemberAccess> {
  const rows = await db.$queryRaw<ProjectMemberAccess[]>`
    SELECT ${PROJECT_ACCESS_COLUMNS}
    FROM estadistica_forms.projects p
    ${joinProjectAccess(actorId)}
    WHERE p.organization_id = ${scope.organizationId} AND p.id = ${scope.projectId}`;
  const access = rows[0] ?? null;
  assertProjectPermission(access, permission);
  return access;
}

async function assertCanIssue(
  tx: DatabaseReader,
  scope: ProjectScope,
  ownerId: string,
  issueKey: string,
  now: Date,
) {
  const rows = await tx.$queryRaw<{ repeated: boolean; active: number }[]>`
    SELECT
      COALESCE(bool_or(issue_key = ${issueKey}), false) AS repeated,
      count(*) FILTER (WHERE revoked_at IS NULL AND expires_at > ${now.toISOString()})::int AS active
    FROM estadistica_forms.integration_credentials
    WHERE project_id = ${scope.projectId} AND owner_id = ${ownerId}`;
  const usage = rows[0];
  if (usage.repeated) {
    throw apiError(ErrorCodes.INTEGRATION_CREDENTIAL_ALREADY_ISSUED);
  }
  if (usage.active >= INTEGRATION_LIMITS.activePerOwner) {
    throw apiError(ErrorCodes.INTEGRATION_CREDENTIAL_LIMIT);
  }
}

async function credentialAfter(
  db: DatabaseReader,
  filter: Prisma.Sql,
  cursor?: string,
) {
  if (!cursor) {
    return Prisma.empty;
  }
  const rows = await db.$queryRaw<{ createdAt: string }[]>`
    SELECT c.created_at AS "createdAt"
    FROM estadistica_forms.integration_credentials c
    WHERE ${filter} AND c.id = ${cursor}`;
  const anchor = rows[0];
  if (!anchor) {
    throw apiError(ErrorCodes.INTEGRATION_CURSOR_INVALID);
  }
  return Prisma.sql`AND (c.created_at, c.id) < (${anchor.createdAt}, ${cursor})`;
}

function exceedsQuota({ subject, used }: { subject: string; used: number }) {
  const limit =
    subject === PROJECT_QUOTA_SUBJECT
      ? INTEGRATION_LIMITS.requestsPerProjectMinute
      : INTEGRATION_LIMITS.requestsPerActorMinute;
  return used > limit;
}

async function proposalForCall(
  db: DatabaseReader,
  credentialId: string,
  call: PreparedCall,
) {
  const rows = await db.$queryRaw<
    (StoredProposal & { argumentsHash: string })[]
  >`
    SELECT ${PROPOSAL_COLUMNS}, p.arguments_hash AS "argumentsHash"
    FROM estadistica_forms.ai_proposals p
    WHERE p.credential_id = ${credentialId} AND p.call_id = ${call.id}`;
  const proposal = rows[0];
  if (
    proposal &&
    (proposal.operation !== call.operation ||
      proposal.argumentsHash !== call.argumentsHash)
  ) {
    throw apiError(ErrorCodes.IDEMPOTENCY_KEY_REUSED);
  }
  return proposal ?? null;
}

async function assertCanPrepare(
  db: DatabaseReader,
  scope: ProjectScope,
  actorId: string,
  permission: OrganizationPermission,
) {
  const access = await requireScopedAccess(db, scope, actorId, 'ai.use');
  assertProjectPermission(access, permission);
}

async function isCredentialActive(
  db: DatabaseReader,
  credentialId: string,
  now: Date,
) {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM estadistica_forms.integration_credentials
    WHERE id = ${credentialId} AND audience IN (${MANAGED_AUDIENCES}) AND can_prepare
      AND revoked_at IS NULL AND expires_at > ${now.toISOString()}`;
  return rows.length > 0;
}

function toCredentialView(row: CredentialRow, now: Date): CredentialView {
  let status: CredentialView['status'] = 'active';
  if (row.revokedAt) {
    status = 'revoked';
  } else if (row.expiresAt <= now.toISOString()) {
    status = 'expired';
  }
  return {
    id: row.id,
    ownerId: row.ownerId,
    label: row.label,
    audience: row.audience,
    capabilities: row.canPrepare ? ['read', 'prepare'] : ['read'],
    status,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    lastUsedAt: row.lastUsedAt,
  };
}
