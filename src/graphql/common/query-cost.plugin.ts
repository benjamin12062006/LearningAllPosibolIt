import type { ApolloServerPlugin } from '@apollo/server';
import { Kind, type FragmentDefinitionNode } from 'graphql';
import { randomUUID } from 'node:crypto';
import { ErrorCodes } from '../../common/http/error-codes.js';
import { toGraphQLError } from './graphql-error.js';
import { MAX_QUERY_COST, operationCost } from './query-cost.js';

/**
 * Rechaza antes de ejecutar las operaciones que cuestan más de
 * `MAX_QUERY_COST` (plan C7, G3). Va en un plugin y no en una regla de
 * validación porque necesita las variables: `limit` suele llegar en ellas.
 */
export const queryCostPlugin: ApolloServerPlugin = {
  requestDidStart() {
    return Promise.resolve({
      didResolveOperation({ document, operation, request, schema }) {
        if (!operation) {
          return Promise.resolve();
        }
        const fragments = new Map<string, FragmentDefinitionNode>();
        for (const definition of document.definitions) {
          if (definition.kind === Kind.FRAGMENT_DEFINITION) {
            fragments.set(definition.name.value, definition);
          }
        }
        const cost = operationCost(
          schema,
          operation,
          fragments,
          request.variables ?? {},
        );
        if (cost > MAX_QUERY_COST) {
          const error = toGraphQLError(
            ErrorCodes.GRAPHQL_QUERY_TOO_COSTLY,
            randomUUID(),
          );
          error.extensions.http = { status: 400 };
          error.extensions.cost = cost;
          error.extensions.maxCost = MAX_QUERY_COST;
          throw error;
        }
        return Promise.resolve();
      },
    });
  },
};
