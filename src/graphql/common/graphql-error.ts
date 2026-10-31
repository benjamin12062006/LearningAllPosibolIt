import { GraphQLError } from 'graphql';
import type { ErrorCode } from '../../common/http/error-codes.js';
import {
  publicError,
  type ValidationIssue,
} from '../../common/http/public-error.js';

/** Error GraphQL con el mismo contrato público bilingüe que REST. */
export function toGraphQLError(
  code: ErrorCode,
  requestId: string,
  issues: ValidationIssue[] = [],
): GraphQLError {
  const { message, ...rest } = publicError(code);
  return new GraphQLError(message.es, {
    extensions: {
      ...rest,
      message,
      requestId,
      ...(issues.length > 0 ? { issues } : {}),
    },
  });
}
