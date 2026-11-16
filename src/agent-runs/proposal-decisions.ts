import { Inject, Injectable } from '@nestjs/common';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import type { OrganizationPermission } from '../organizations/organization-roles.js';
import {
  AgentRunsRepository,
  toProposalView,
  type StoredProposal,
} from './agent-runs.repository.js';
import {
  AGENT_RUN_OPTIONS,
  type AgentRunOptions,
  type ProposalView,
} from './agent-runs.types.js';
import type { OperationContext } from './operations/agent-operation.js';
import { AgentOperationCatalog } from './operations/agent-operation-catalog.js';

/**
 * Confirmar o rechazar una propuesta (plan 05, «Confirmación humana»), venga
 * de una ejecución del chat o de un cliente externo. Se ejecuta el plan
 * guardado, nunca lo que dijo el modelo, con la identidad de la persona y los
 * servicios de siempre. Repetir la confirmación devuelve el mismo resultado; el
 * hash tiene que ser el de la propuesta que vio.
 */
@Injectable()
export class ProposalDecisions {
  constructor(
    private readonly repository: AgentRunsRepository,
    private readonly catalog: AgentOperationCatalog,
    @Inject(AGENT_RUN_OPTIONS)
    private readonly options: AgentRunOptions,
  ) {}

  /**
   * `load` lee la propuesta comprobando que es de esta persona.
   * `claim` comprueba el origen y reserva la decisión antes del efecto.
   */
  async confirm(
    actor: OperationContext,
    load: () => Promise<StoredProposal>,
    proposalHash: string,
    claim: (
      proposal: StoredProposal,
      permission: OrganizationPermission,
    ) => Promise<boolean>,
  ): Promise<ProposalView> {
    const proposal = await load();
    if (proposal.hash !== proposalHash) {
      throw apiError(ErrorCodes.AGENT_PROPOSAL_STALE);
    }
    if (proposal.status === 'confirmed') {
      return toProposalView(proposal);
    }
    if (proposal.status === 'rejected') {
      throw apiError(ErrorCodes.AGENT_PROPOSAL_DECIDED);
    }
    if (proposal.status === 'confirming') {
      throw apiError(ErrorCodes.AGENT_PROPOSAL_IN_PROGRESS);
    }
    const operation = this.catalog.find(proposal.operation);
    if (operation?.level !== 'write') {
      throw apiError(ErrorCodes.AGENT_OPERATION_NOT_FOUND);
    }
    if (!(await claim(proposal, operation.permission))) {
      return resolveConcurrentConfirmation(await load());
    }
    try {
      const result = await operation.confirm(actor, proposal.plan, proposal.id);
      await this.repository.completeConfirm(
        proposal.id,
        result,
        this.options.clock(),
      );
    } catch (error) {
      await this.repository.abortConfirm(proposal.id);
      throw error;
    }
    return toProposalView(await load());
  }

  async reject(
    load: () => Promise<StoredProposal>,
    proposalHash: string,
  ): Promise<ProposalView> {
    const proposal = await load();
    if (proposal.hash !== proposalHash) {
      throw apiError(ErrorCodes.AGENT_PROPOSAL_STALE);
    }
    if (proposal.status === 'rejected') {
      return toProposalView(proposal);
    }
    const rejected = await this.repository.reject(
      proposal.id,
      proposalHash,
      this.options.clock(),
    );
    if (!rejected) {
      throw apiError(ErrorCodes.AGENT_PROPOSAL_DECIDED);
    }
    return toProposalView(await load());
  }
}

function resolveConcurrentConfirmation(proposal: StoredProposal): ProposalView {
  switch (proposal.status) {
    case 'confirmed':
      return toProposalView(proposal);
    case 'rejected':
      throw apiError(ErrorCodes.AGENT_PROPOSAL_DECIDED);
    case 'confirming':
      throw apiError(ErrorCodes.AGENT_PROPOSAL_IN_PROGRESS);
    case 'ready':
      throw apiError(ErrorCodes.AGENT_PROPOSAL_EXPIRED);
  }
}
