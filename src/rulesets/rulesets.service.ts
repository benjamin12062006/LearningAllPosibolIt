import { Injectable } from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes, type ErrorCode } from '../common/http/error-codes.js';
import {
  fetchWindow,
  resolvePage,
  toPage,
  type PageRequest,
} from '../common/http/pagination.js';
import {
  publicError,
  type ValidationIssue,
} from '../common/http/public-error.js';
import {
  findRulesetIssues,
  type Rule,
  type Ruleset,
  type RulesetIssue,
  type RulesetIssueCode,
} from '../evaluations/engine/ruleset.js';
import { ProjectsService } from '../projects/projects.service.js';
import { UsersService } from '../users/users.service.js';
import {
  BuildTitleRuleDto,
  CleanTextRuleDto,
  ExcludeWhenRuleDto,
  type CreateRulesetDto,
  type RuleDto,
} from './rulesets.dto.js';
import { RulesetsRepository } from './rulesets.repository.js';

/** La columna `revision` es INTEGER: un número mayor no puede existir. */
const MAX_REVISION = 2_147_483_647;

const ISSUE_ERROR_CODES: Record<RulesetIssueCode, ErrorCode> = {
  MAPPING_DUPLICATE: ErrorCodes.RULESET_MAPPING_DUPLICATE,
  REFERENCE_INVALID: ErrorCodes.RULESET_REFERENCE_INVALID,
  REQUIRED_ATTRIBUTE_MISSING: ErrorCodes.RULESET_REQUIRED_ATTRIBUTE_MISSING,
};

@Injectable()
export class RulesetsService {
  constructor(
    private readonly usersService: UsersService,
    private readonly projectsService: ProjectsService,
    private readonly repository: RulesetsRepository,
  ) {}

  /** Comprueba la coherencia antes de tocar la base y guarda la revisión siguiente. */
  async create(
    identity: AuthenticatedIdentity,
    projectId: string,
    input: CreateRulesetDto,
  ) {
    const ruleset = toRuleset(input);
    assertRulesetIsConsistent(ruleset);

    const owner = await this.usersService.findCurrent(identity);
    return this.repository.create(owner.id, projectId, ruleset);
  }

  async findAll(
    identity: AuthenticatedIdentity,
    projectId: string,
    query?: Partial<PageRequest>,
  ) {
    await this.projectsService.findVisible(identity, projectId);
    const page = resolvePage(query);
    const rows = await this.repository.findAllByProject(
      projectId,
      fetchWindow(page),
    );
    return toPage(rows, page);
  }

  async findRevision(
    identity: AuthenticatedIdentity,
    projectId: string,
    revision: number,
  ) {
    await this.projectsService.findVisible(identity, projectId);
    if (!isStorableRevision(revision)) {
      throw apiError(ErrorCodes.RULESET_NOT_FOUND);
    }
    const ruleset = await this.repository.findByRevision(projectId, revision);
    if (!ruleset) {
      throw apiError(ErrorCodes.RULESET_NOT_FOUND);
    }
    return ruleset;
  }
}

/**
 * Copia el body a objetos de dominio: la base guarda datos simples, nunca
 * instancias de los DTO. La usa también la vista previa de reglas de
 * evaluaciones, que recibe el mismo body sin guardarlo.
 */
export function toRuleset(input: CreateRulesetDto): Ruleset {
  return {
    mapping: input.mapping.map(({ attribute, column }) => ({
      attribute,
      column,
    })),
    rules: input.rules.map(toRule),
  };
}

function toRule(dto: RuleDto): Rule {
  if (dto instanceof CleanTextRuleDto) {
    return { type: 'clean_text', attributes: [...dto.attributes] };
  }
  if (dto instanceof BuildTitleRuleDto) {
    return { type: 'build_title', template: dto.template };
  }
  if (dto instanceof ExcludeWhenRuleDto) {
    return {
      type: 'exclude_when',
      attribute: dto.attribute,
      operator: dto.operator,
      value: dto.value ?? '',
    };
  }
  // El DTO ya rechazó los tipos desconocidos: llegar aquí es un error del backend.
  throw new Error(`Regla sin clase conocida: ${dto.type}`);
}

/**
 * Responde como cualquier otro error de validación (`VALIDATION_FAILED` con un
 * issue por problema), para que el cliente los trate igual.
 */
export function assertRulesetIsConsistent(ruleset: Ruleset) {
  const issues = findRulesetIssues(ruleset);
  if (issues.length > 0) {
    throw apiError(ErrorCodes.VALIDATION_FAILED, issues.map(toValidationIssue));
  }
}

function toValidationIssue(issue: RulesetIssue): ValidationIssue {
  return {
    field: issueField(issue),
    ...publicError(ISSUE_ERROR_CODES[issue.code]),
  };
}

/**
 * El filtro de errores solo conserva `field` y `code`, así que el atributo va
 * en el campo: `mapping.price` para el mapeo y `rules.2.color` para la regla de
 * índice 2. Un marcador vacío (`{}`) se muestra como `{}`.
 */
function issueField(issue: RulesetIssue) {
  const attribute = issue.attribute === '' ? '{}' : issue.attribute;
  if (issue.rulePosition === undefined) {
    return `mapping.${attribute}`;
  }
  return `rules.${issue.rulePosition - 1}.${attribute}`;
}

function isStorableRevision(revision: number) {
  return (
    Number.isSafeInteger(revision) && revision >= 1 && revision <= MAX_REVISION
  );
}
