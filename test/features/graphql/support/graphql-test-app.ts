import { expect } from '@jest/globals';
import { type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import request from 'supertest';
import { ARTIFACT_STORE_OPTIONS } from '../../../../src/artifacts/artifacts.types.js';
import type { AuthenticatedIdentity } from '../../../../src/auth/authenticated-request.js';
import { DescopeService } from '../../../../src/auth/descope.service.js';
import { CATALOG_IMPORT_OPTIONS } from '../../../../src/catalog-import/import.types.js';
import { configureHttp } from '../../../../src/configure-http.js';
import { POSTGRESQL_CONNECTION } from '../../../../src/database/postgresql.connection.js';
import { EVALUATION_OPTIONS } from '../../../../src/evaluations/evaluations.types.js';
import { EXPORT_OPTIONS } from '../../../../src/exports/exports.types.js';
import { FEED_REFRESH_OPTIONS } from '../../../../src/feed-refreshes/feed-refreshes.types.js';
import { FEED_OPTIONS } from '../../../../src/feeds/feeds.types.js';
import { GraphqlApiModule } from '../../../../src/graphql/graphql-api.module.js';
import type { OrganizationRole } from '../../../../src/organizations/organization-roles.js';
import { ProjectsService } from '../../../../src/projects/projects.service.js';
import { UsersService } from '../../../../src/users/users.service.js';
import { WORKSHEET_EXPORT_OPTIONS } from '../../../../src/worksheet-exports/worksheet-exports.types.js';
import { alice, bob, projectInput } from '../../support/project-fixtures.js';
import { createTestDatabase } from '../../support/test-database.js';

export type GraphQLBody = {
  data?: Record<string, any> | null;
  errors?: { message: string; extensions: Record<string, any> }[];
};

/** Las sesiones de prueba: Alice es dueña de su organización; Bob, de la suya. */
const IDENTITIES: Record<string, AuthenticatedIdentity> = {
  'alice-session': alice,
  'bob-session': bob,
};

/**
 * La API GraphQL con sus módulos (que traen también sus rutas REST, para
 * comparar) sobre PGlite, con los procesos de fondo parados.
 */
export async function startGraphqlApp(
  extraImports: any[] = [],
  configure: (builder: TestingModuleBuilder) => TestingModuleBuilder = (
    builder,
  ) => builder,
) {
  const database = await createTestDatabase();
  const root = await mkdtemp(join(tmpdir(), 'graphql-c7-'));
  const idle = { autoStart: false, pollMs: 1000, shutdownMs: 1000 };
  const builder = Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      GraphqlApiModule,
      ...extraImports,
    ],
  })
    .overrideProvider(POSTGRESQL_CONNECTION)
    .useValue(database.connection)
    .overrideProvider(ARTIFACT_STORE_OPTIONS)
    .useValue({ root })
    .overrideProvider(CATALOG_IMPORT_OPTIONS)
    .useValue(idle)
    .overrideProvider(EVALUATION_OPTIONS)
    .useValue(idle)
    .overrideProvider(EXPORT_OPTIONS)
    .useValue({ autoStart: false })
    .overrideProvider(FEED_REFRESH_OPTIONS)
    .useValue({
      autoStart: false,
      pollMs: 1_000,
      waitMs: 0,
      leaseMs: 60_000,
      shutdownMs: 200,
      retry: { baseDelayMs: 1, maxDelayMs: 4, maxAttempts: 3 },
      clock: () => new Date(),
    })
    .overrideProvider(FEED_OPTIONS)
    .useValue({ autoStart: false, retainedFiles: 3 })
    .overrideProvider(WORKSHEET_EXPORT_OPTIONS)
    .useValue({ autoStart: false })
    .overrideProvider(DescopeService)
    .useValue({
      validateSession: async (session: string) => {
        const identity = IDENTITIES[session];
        if (!identity) throw new Error('Token de prueba inválido');
        return {
          jwt: session,
          token: {
            sub: identity.subject,
            iss: identity.issuer,
            email: identity.email,
          },
        };
      },
    });
  const module = await configure(builder).compile();
  const app = module.createNestApplication();
  configureHttp(app);
  await app.init();

  async function close() {
    try {
      await app.close();
    } finally {
      await database.close();
      await rm(root, { recursive: true, force: true });
    }
  }
  return { app, pool: database.connection.pool, close };
}

/** Llamadas por GraphQL y por REST a la misma app, con la sesión elegida. */
export function clientsFor(app: INestApplication) {
  function gql(query: string, variables: object = {}, token = 'alice-session') {
    const call = request(app.getHttpServer()).post('/api/graphql');
    if (token) call.auth(token, { type: 'bearer' });
    return call.send({ query, variables });
  }
  async function ok(query: string, variables: object = {}, token?: string) {
    const { body } = await gql(query, variables, token).expect(200);
    const result = body as GraphQLBody;
    expect(result.errors).toBeUndefined();
    return result.data!;
  }
  async function failure(
    query: string,
    variables: object = {},
    token?: string,
  ) {
    const { body } = await gql(query, variables, token);
    const result = body as GraphQLBody;
    expect(result.errors).toHaveLength(1);
    return result.errors![0];
  }
  function rest(token = 'alice-session') {
    const agent = request(app.getHttpServer());
    const as = (call: request.Test) => call.auth(token, { type: 'bearer' });
    return {
      get: (path: string) => as(agent.get(path)),
      post: (path: string) => as(agent.post(path)),
      put: (path: string) => as(agent.put(path)),
      patch: (path: string) => as(agent.patch(path)),
      delete: (path: string) => as(agent.delete(path)),
    };
  }
  return { gql, ok, failure, rest };
}

/** Alice y Bob registrados, cada uno con un proyecto en su organización. */
export async function seedTwoOrganizations(app: INestApplication, pool: Pool) {
  await pool.query('TRUNCATE estadistica_forms.app_users CASCADE');
  const users = app.get(UsersService);
  const aliceId = (await users.provision(alice)).id;
  const bobId = (await users.provision(bob)).id;
  const projects = app.get(ProjectsService);
  const projectId = (await projects.create(alice, projectInput)).id;
  const bobProjectId = (await projects.create(bob, projectInput)).id;
  const { rows } = await pool.query<{ id: string }>(
    `SELECT organization_id AS id FROM estadistica_forms.projects WHERE id = $1`,
    [projectId],
  );
  return {
    aliceId,
    bobId,
    projectId,
    bobProjectId,
    organizationId: rows[0].id,
  };
}

/** Hace a Bob miembro de la organización de Alice con ese rol. */
export async function setRole(
  pool: Pool,
  organizationId: string,
  userId: string,
  role: OrganizationRole,
) {
  await pool.query(
    `INSERT INTO estadistica_forms.organization_members
       (organization_id, user_id, role, created_at)
     VALUES ($1, $2, $3, '2026-11-14T09:00:00.000Z')
     ON CONFLICT (organization_id, user_id) DO UPDATE SET role = $3`,
    [organizationId, userId, role],
  );
}
