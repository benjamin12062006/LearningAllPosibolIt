import { Injectable } from '@nestjs/common';
import {
  catalogDocuments,
  evaluationDocuments,
  feedDocuments,
  projectDocuments,
  rulesetDocuments,
  TOP_PROBLEMS,
} from './knowledge-documents.js';
import { KnowledgeRepository } from './knowledge.repository.js';
import type { CurrentSource, KnowledgeDocument } from './knowledge.types.js';

/**
 * Los documentos de una fuente tal como están ahora (D18). Si la fuente
 * desapareció entre la huella y esta lectura, devuelve una lista vacía: el
 * servicio de IA vacía la fuente y la pasada siguiente la borra.
 */
@Injectable()
export class SourceDocuments {
  constructor(private readonly repository: KnowledgeRepository) {}

  async of(source: CurrentSource): Promise<KnowledgeDocument[]> {
    switch (source.sourceType) {
      case 'project':
        return this.project(source.projectId);
      case 'catalog':
        return this.catalog(source.projectId);
      case 'evaluation':
        return this.evaluation(source.projectId);
      case 'ruleset':
        return this.ruleset(source.projectId);
      case 'feed':
        return this.feed(source.projectId);
      default:
        // Las demás fuentes llegan en E6.1b.2; la consulta de huellas aún no las da.
        throw new Error(`Fuente sin documentos todavía: ${source.sourceType}.`);
    }
  }

  private async project(projectId: string) {
    const facts = await this.repository.findProjectFacts(projectId);
    return facts ? projectDocuments(facts) : [];
  }

  private async catalog(projectId: string) {
    const facts = await this.repository.findCatalogFacts(projectId);
    if (!facts) {
      return [];
    }
    return catalogDocuments(
      facts,
      await this.repository.findCatalogProducts(projectId),
    );
  }

  private async evaluation(projectId: string) {
    const facts = await this.repository.findLatestEvaluation(projectId);
    if (!facts) {
      return [];
    }
    return evaluationDocuments(
      facts,
      await this.repository.findProblemCounts(facts.id, TOP_PROBLEMS),
    );
  }

  private async ruleset(projectId: string) {
    const facts = await this.repository.findLatestRuleset(projectId);
    return facts ? rulesetDocuments(facts) : [];
  }

  private async feed(projectId: string) {
    const facts = await this.repository.findFeedFacts(projectId);
    return facts ? feedDocuments(facts) : [];
  }
}
