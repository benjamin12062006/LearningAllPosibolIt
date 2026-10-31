import { randomUUID } from 'node:crypto';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { maxQueryDepth } from './common/max-query-depth.rule.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { publicError } from '../common/http/public-error.js';

export const GRAPHQL_MAX_DEPTH = 6;

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
        context: ({ req }: { req: unknown }) => ({ req }),
        // Los errores de resolvers ya salen del filtro global; aquí se
        // normalizan los de análisis, validación y variables de Apollo.
        formatError: (formatted) => {
          if (formatted.extensions?.requestId) return formatted;
          const internal =
            formatted.extensions?.code === 'INTERNAL_SERVER_ERROR';
          const { message, ...rest } = publicError(
            internal ? ErrorCodes.INTERNAL_ERROR : ErrorCodes.BAD_REQUEST,
          );
          return {
            message: internal ? message.es : formatted.message,
            locations: formatted.locations,
            path: formatted.path,
            extensions: { ...rest, message, requestId: randomUUID() },
          };
        },
      };
    },
  },
);
