import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { apiError } from '../../common/http/api-error.js';
import { ErrorCodes } from '../../common/http/error-codes.js';
import { validateAs } from '../../common/http/validation-options.js';
import type { AiServiceClient } from '../../knowledge/ai-service.client.js';
import type { ReadOperation } from './agent-operation.js';
import { objectSchema } from './operation-inputs.js';

export const SEARCH_KNOWLEDGE = 'search_knowledge';
const QUERY_LIMIT = 1000;
const RESULT_LIMIT = 8;

class KnowledgeQuery {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, QUERY_LIMIT)
  query!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(RESULT_LIMIT)
  limit?: number;
}

export function knowledgeOperation(
  ai: AiServiceClient | null,
  requestId?: string,
): ReadOperation<KnowledgeQuery> | undefined {
  if (!ai) return undefined;
  return {
    name: SEARCH_KNOWLEDGE,
    description:
      'Busca conocimiento indexado de este proyecto a partir de una consulta.',
    level: 'read',
    permission: 'organization.read',
    inputSchema: objectSchema(
      {
        query: { type: 'string', minLength: 1, maxLength: QUERY_LIMIT },
        limit: { type: 'integer', minimum: 1, maximum: RESULT_LIMIT },
      },
      ['query'],
    ),
    parse: (input) => validateAs(KnowledgeQuery, input),
    targetOf: ({ scope }) => ({ projectId: scope.projectId }),
    async execute({ scope }, input) {
      try {
        return await ai.searchKnowledge(
          scope,
          input.query,
          input.limit ?? RESULT_LIMIT,
          requestId ?? randomUUID(),
        );
      } catch {
        throw apiError(ErrorCodes.SERVICE_UNAVAILABLE);
      }
    },
  };
}
