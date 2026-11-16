import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import type { GraphQLFormattedError } from 'graphql';
import { randomUUID } from 'node:crypto';
import { ErrorCodes } from '../common/http/error-codes.js';
import { publicError } from '../common/http/public-error.js';
import { maxQueryDepth } from './common/max-query-depth.rule.js';
import { queryCostPlugin } from './common/query-cost.plugin.js';

/**
 * Cada lista paginada suma un nivel (`items`): con 8 caben las lecturas
 * compuestas previstas (libros con sus hojas, evaluaciones con su «Requiere
 * atención») y el límite de coste acota el tamaño (plan C7, ajuste a G3).
 */
export const GRAPHQL_MAX_DEPTH = 8;

/** Sirve `/api/graphql` junto a REST; el esquema se genera en memoria (code first). */
export const graphqlRootModule = GraphQLModule.forRootAsync<ApolloDriverConfig>(
  {
    driver: ApolloDriver,
    inject: [ConfigService],
    useFactory: (config: ConfigService) => {
      const production = config.get<string>('NODE_ENV') === 'production';
      return {
        autoSchemaFile: true,
        sortSchema: true,
        path: '/graphql',
        useGlobalPrefix: true,
        playground: false,
        introspection: !production,
        hideSchemaDetailsFromClientErrors: production,
        includeStacktraceInErrorResponses: false,
        allowBatchedHttpRequests: false,
        validationRules: [maxQueryDepth(GRAPHQL_MAX_DEPTH)],
        // Además de la profundidad, el coste con sus variables (plan C7, G3).
        plugins: [queryCostPlugin],
        // Nest no aplica los filtros a los campos (`@ResolveField`) si no se
        // pide: sin esto, un 404 o un 409 lanzado desde un campo saldría como
        // `INTERNAL_ERROR`. Los guards no se repiten por campo a propósito: la
        // consulta raíz ya validó la sesión y cada campo volvería a hacerlo.
        fieldResolverEnhancers: ['filters'],
        context: ({ req }: { req: unknown }) => ({ req }),
        formatError: normalizeApolloError,
      };
    },
  },
);

/**
 * Los errores de los resolvers ya salen del filtro global con `requestId`.
 * Aquí se adaptan al mismo contrato los que genera Apollo antes de llegar a un
 * resolver: análisis, validación del documento y variables.
 */
function normalizeApolloError(
  formatted: GraphQLFormattedError,
): GraphQLFormattedError {
  if (formatted.extensions?.requestId) {
    return formatted;
  }

  const internal = formatted.extensions?.code === 'INTERNAL_SERVER_ERROR';
  const { message, ...rest } = publicError(
    internal ? ErrorCodes.INTERNAL_ERROR : ErrorCodes.BAD_REQUEST,
  );
  return {
    message: internal ? message.es : formatted.message,
    locations: formatted.locations,
    path: formatted.path,
    extensions: { ...rest, message, requestId: randomUUID() },
  };
}
