import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GraphQLSchemaHost } from '@nestjs/graphql';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { printSchema } from 'graphql';
import request from 'supertest';
import { DescopeService } from '../../../src/auth/descope.service.js';
import { CATALOG_IMPORT_OPTIONS } from '../../../src/catalog-import/import.types.js';
import { configureHttp } from '../../../src/configure-http.js';
import { POSTGRESQL_CONNECTION } from '../../../src/database/postgresql.connection.js';
import { PrismaService } from '../../../src/database/prisma.service.js';
import { GraphqlApiModule } from '../../../src/graphql/graphql-api.module.js';
import { UsersService } from '../../../src/users/users.service.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';

type GraphQLBody = {
  data?: Record<string, any> | null;
  errors?: { message: string; extensions: Record<string, any> }[];
};

describe('GraphQL sobre los servicios, el guard y la persistencia reales', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  let prisma: PrismaService;

  function gql(query: string, variables?: object, token = 'alice-session') {
    const call = request(app.getHttpServer()).post('/api/graphql');
    if (token) call.auth(token, { type: 'bearer' });
    return call.send({ query, variables });
  }
  async function ok(query: string, variables?: object, token?: string) {
    const { body } = await gql(query, variables, token).expect(200);
    const result = body as GraphQLBody;
    expect(result.errors).toBeUndefined();
    return result.data!;
  }
  // Apollo responde 200 a los errores de resolvers y 400 a los de análisis,
  // validación del documento y variables.
  async function failure(
    query: string,
    variables?: object,
    token?: string,
    status = 200,
  ) {
    const { body } = await gql(query, variables, token).expect(status);
    const result = body as GraphQLBody;
    expect(result.errors).toHaveLength(1);
    return result.errors![0];
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        GraphqlApiModule,
      ],
    })
      .overrideProvider(POSTGRESQL_CONNECTION)
      .useValue(database.connection)
      .overrideProvider(CATALOG_IMPORT_OPTIONS)
      .useValue({
        root: resolve('.test-build/graphql-artifacts'),
        autoStart: false,
        pollMs: 1000,
        shutdownMs: 1000,
      })
      .overrideProvider(DescopeService)
      .useValue({
        validateSession: async (session: string) => {
          const identity =
            session === 'alice-session'
              ? alice
              : session === 'bob-session'
                ? bob
                : null;
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
      })
      .compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    await database.connection.pool.query(
      'TRUNCATE estadistica_forms.app_users CASCADE',
    );
    const users = app.get(UsersService);
    await users.provision(alice);
    await users.provision(bob);
  });
  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await database?.close();
    }
  });

  const createProject = `mutation($input: CreateProjectInput!) {
    createProject(input: $input) { id name country currency channelProfile configurationStatus createdAt }
  }`;
  const input = { ...projectInput };

  it('sin Bearer o con token inválido devuelve el contrato bilingüe de REST', async () => {
    const missing = await failure('{ me { id } }', undefined, '');
    expect(missing.extensions).toMatchObject({
      code: 'AUTH_SESSION_REQUIRED',
      message: { es: expect.any(String), en: expect.any(String) },
      requestId: expect.any(String),
    });
    expect(missing.message).toBe(missing.extensions.message.es);

    const invalid = await failure('{ me { id } }', undefined, 'otro');
    expect(invalid.extensions.code).toBe('AUTH_SESSION_INVALID');
  });

  it('me y updateMe usan la identidad de la sesión', async () => {
    const me = await ok('{ me { id email displayName } }');
    expect(me.me).toMatchObject({ email: alice.email, displayName: null });

    const updated = await ok(
      'mutation($i: UpdateMeInput!) { updateMe(input: $i) { displayName } }',
      { i: { displayName: '  Alicia  ' } },
    );
    expect(updated.updateMe.displayName).toBe('Alicia');

    const empty = await failure(
      'mutation { updateMe(input: { displayName: "" }) { id } }',
    );
    expect(empty.extensions.code).toBe('VALIDATION_FAILED');
    expect(empty.extensions.issues).toEqual([
      expect.objectContaining({ field: 'displayName', code: 'FIELD_REQUIRED' }),
    ]);
  });

  it('crea, lista con paginación y consulta proyectos normalizados', async () => {
    const created = await ok(createProject, {
      input: { ...input, name: '  Tienda A  ', country: 'us', currency: 'usd' },
    });
    expect(created.createProject).toMatchObject({
      name: 'Tienda A',
      country: 'US',
      currency: 'USD',
      channelProfile: 'google_merchant',
      configurationStatus: 'ready',
    });
    await ok(createProject, { input: { ...input, name: 'Tienda B' } });
    await ok(createProject, { input: { ...input, name: 'Tienda C' } });

    const page = await ok('{ projects(limit: 2, offset: 1) { id name } }');
    expect(page.projects).toHaveLength(2);
    const all = await ok('{ projects { name } }');
    expect(all.projects.map((p: { name: string }) => p.name)).toEqual([
      'Tienda C',
      'Tienda B',
      'Tienda A',
    ]);

    const one = await ok('query($id: ID!) { project(id: $id) { name } }', {
      id: created.createProject.id,
    });
    expect(one.project.name).toBe('Tienda A');
  });

  it('el mismo proyecto es idéntico por REST y por GraphQL', async () => {
    const { createProject: project } = await ok(createProject, { input });
    const rest = await request(app.getHttpServer())
      .get(`/api/v1/projects/${project.id}`)
      .auth('alice-session', { type: 'bearer' })
      .expect(200);
    expect(rest.body.project).toEqual(project);
  });

  it('valida límites de paginación y UUID con códigos estables', async () => {
    const tooMany = await failure('{ projects(limit: 101) { id } }');
    expect(tooMany.extensions.code).toBe('VALIDATION_FAILED');
    const negative = await failure('{ projects(offset: -1) { id } }');
    expect(negative.extensions.code).toBe('VALIDATION_FAILED');

    const uuid = await failure('{ project(id: "no-es-uuid") { id } }');
    expect(uuid.extensions.code).toBe('INVALID_UUID');
    expect(uuid.extensions.issues).toEqual([
      expect.objectContaining({ field: 'id', code: 'INVALID_UUID' }),
    ]);
  });

  it('rechaza entradas inválidas con las mismas reglas del DTO REST', async () => {
    const invalid = await failure(createProject, {
      input: { ...input, name: '', country: 'ZZZ', currency: 'XXX1' },
    });
    expect(invalid.extensions.code).toBe('VALIDATION_FAILED');
    expect(
      invalid.extensions.issues.map((i: { field: string }) => i.field),
    ).toEqual(expect.arrayContaining(['name', 'country', 'currency']));

    const unknownEnum = await failure(
      createProject,
      { input: { ...input, channelProfile: 'tienda' } },
      undefined,
      400,
    );
    expect(unknownEnum.extensions.code).toBe('BAD_REQUEST');
  });

  it('no permite ver ni modificar proyectos de otro usuario', async () => {
    const { createProject: mine } = await ok(createProject, { input });
    const read = await failure(
      'query($id: ID!) { project(id: $id) { id } }',
      { id: mine.id },
      'bob-session',
    );
    expect(read.extensions.code).toBe('PROJECT_NOT_FOUND');
    const write = await failure(
      'mutation($id: ID!) { updateProject(id: $id, input: { name: "X" }) { id } }',
      { id: mine.id },
      'bob-session',
    );
    expect(write.extensions.code).toBe('PROJECT_NOT_FOUND');
    const bobs = await ok('{ projects { id } }', undefined, 'bob-session');
    expect(bobs.projects).toEqual([]);
  });

  it('updateProject conserva las reglas de servicio de REST', async () => {
    const { createProject: project } = await ok(createProject, { input });
    const renamed = await ok(
      'mutation($id: ID!) { updateProject(id: $id, input: { name: "Nuevo" }) { name } }',
      { id: project.id },
    );
    expect(renamed.updateProject.name).toBe('Nuevo');

    const partial = await failure(
      'mutation($id: ID!) { updateProject(id: $id, input: { country: "BO" }) { id } }',
      { id: project.id },
    );
    expect(partial.extensions.code).toBe('PROJECT_CONFIGURATION_INCOMPLETE');
    const empty = await failure(
      'mutation($id: ID!) { updateProject(id: $id, input: {}) { id } }',
      { id: project.id },
    );
    expect(empty.extensions.code).toBe('PROJECT_UPDATE_EMPTY');
  });

  it('lee trabajos y snapshots de importación solo del propietario', async () => {
    const { createProject: project } = await ok(createProject, { input });
    const owner = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM estadistica_forms.app_users WHERE identity_subject = ${alice.subject}`;
    const snapshotId = '11111111-1111-4111-8111-111111111111';
    const jobId = '22222222-2222-4222-8222-222222222222';
    await database.connection.pool.query(
      `INSERT INTO estadistica_forms.catalog_snapshots
        (id, project_id, id_column, delimiter, headers, source_hash, artifact_key, byte_size,
         original_name, project_configuration, status, row_count, created_at, finished_at)
       VALUES ($1,$2,'id','comma','["id","title"]','${'a'.repeat(64)}','k1',10,'a.csv','{}','ready',1,
         '2026-10-30T10:00:00.000Z','2026-10-30T10:00:01.000Z')`,
      [snapshotId, project.id],
    );
    await database.connection.pool.query(
      `INSERT INTO estadistica_forms.catalog_rows (snapshot_id, source_row, external_id, original_values)
       VALUES ($1,1,'000123','{"id":"000123","title":"Café"}')`,
      [snapshotId],
    );
    await database.connection.pool.query(
      `INSERT INTO estadistica_forms.catalog_import_jobs
        (id, project_id, snapshot_id, request_id, status, processed_rows, created_at, started_at, finished_at)
       VALUES ($1,$2,$3,'r','succeeded',1,'2026-10-30T10:00:00.000Z','2026-10-30T10:00:00.500Z','2026-10-30T10:00:01.000Z')`,
      [jobId, project.id, snapshotId],
    );
    expect(owner).toHaveLength(1);

    const data = await ok(
      `query($p: ID!, $s: ID!, $j: ID!) {
        importJob(projectId: $p, id: $j) { status processedRows error { code } }
        importSnapshot(projectId: $p, id: $s) {
          status delimiter headers rowCount sample { sourceRow externalId originalValues }
        }
      }`,
      { p: project.id, s: snapshotId, j: jobId },
    );
    expect(data.importJob).toEqual({
      status: 'succeeded',
      processedRows: 1,
      error: null,
    });
    expect(data.importSnapshot).toEqual({
      status: 'ready',
      delimiter: 'comma',
      headers: ['id', 'title'],
      rowCount: 1,
      sample: [
        {
          sourceRow: 1,
          externalId: '000123',
          originalValues: { id: '000123', title: 'Café' },
        },
      ],
    });

    const rest = await request(app.getHttpServer())
      .get(`/api/v1/projects/${project.id}/imports/${snapshotId}`)
      .auth('alice-session', { type: 'bearer' })
      .expect(200);
    expect(rest.body.sample).toEqual(data.importSnapshot.sample);

    const foreign = await failure(
      'query($p: ID!, $j: ID!) { importJob(projectId: $p, id: $j) { id } }',
      { p: project.id, j: jobId },
      'bob-session',
    );
    expect(foreign.extensions.code).toBe('IMPORT_NOT_FOUND');
  });

  describe('borrado', () => {
    const artifactsDir = resolve('.test-build/graphql-artifacts/artifacts');
    const deleteImport = `mutation($p: ID!, $s: ID!) { deleteImport(projectId: $p, id: $s) }`;
    const deleteProject = `mutation($id: ID!) { deleteProject(id: $id) }`;

    /** Inserta una importación con su archivo; `queued` simula una en curso. */
    async function insertImport(
      projectId: string,
      jobStatus: 'succeeded' | 'queued',
    ) {
      const snapshotId = randomUUID();
      const artifactKey = `${randomUUID()}.csv`;
      await writeFile(join(artifactsDir, artifactKey), 'id\n1\n');
      const finished = jobStatus === 'succeeded';
      await database.connection.pool.query(
        `INSERT INTO estadistica_forms.catalog_snapshots
          (id, project_id, id_column, delimiter, headers, source_hash, artifact_key, byte_size,
           original_name, project_configuration, status, row_count, created_at, finished_at)
         VALUES ($1, $2, 'id', 'comma', $3, '${'a'.repeat(64)}', $4, 5, 'a.csv', '{}', $5, $6,
           '2026-10-30T10:00:00.000Z', $7)`,
        [
          snapshotId,
          projectId,
          finished ? '["id"]' : null,
          artifactKey,
          finished ? 'ready' : 'pending',
          finished ? 1 : null,
          finished ? '2026-10-30T10:00:01.000Z' : null,
        ],
      );
      if (finished) {
        await database.connection.pool.query(
          `INSERT INTO estadistica_forms.catalog_rows (snapshot_id, source_row, external_id, original_values)
           VALUES ($1, 1, '1', '{"id":"1"}')`,
          [snapshotId],
        );
      }
      await database.connection.pool.query(
        `INSERT INTO estadistica_forms.catalog_import_jobs
          (id, project_id, snapshot_id, request_id, status, processed_rows, created_at, started_at, finished_at)
         VALUES ($1, $2, $3, 'r', $4, $5, '2026-10-30T10:00:00.000Z', $6, $7)`,
        [
          randomUUID(),
          projectId,
          snapshotId,
          jobStatus,
          finished ? 1 : 0,
          finished ? '2026-10-30T10:00:00.500Z' : null,
          finished ? '2026-10-30T10:00:01.000Z' : null,
        ],
      );
      return { snapshotId, artifactKey };
    }

    it('deleteImport borra una importación terminada, sus filas y su archivo', async () => {
      const { createProject: project } = await ok(createProject, { input });
      const { snapshotId, artifactKey } = await insertImport(
        project.id,
        'succeeded',
      );

      const data = await ok(deleteImport, { p: project.id, s: snapshotId });
      expect(data.deleteImport).toBe(true);
      expect(await prisma.catalogRow.count({ where: { snapshotId } })).toBe(0);
      expect(
        await prisma.catalogImportJob.count({ where: { snapshotId } }),
      ).toBe(0);
      expect(await readdir(artifactsDir)).not.toContain(artifactKey);

      const gone = await failure(
        'query($p: ID!, $s: ID!) { importSnapshot(projectId: $p, id: $s) { id } }',
        { p: project.id, s: snapshotId },
      );
      expect(gone.extensions.code).toBe('IMPORT_NOT_FOUND');
      await request(app.getHttpServer())
        .get(`/api/v1/projects/${project.id}/imports/${snapshotId}`)
        .auth('alice-session', { type: 'bearer' })
        .expect(404);
    });

    it('deleteProject borra el proyecto con sus importaciones y archivos', async () => {
      const { createProject: project } = await ok(createProject, { input });
      const { createProject: other } = await ok(createProject, { input });
      const first = await insertImport(project.id, 'succeeded');
      const second = await insertImport(project.id, 'succeeded');

      expect((await ok(deleteProject, { id: project.id })).deleteProject).toBe(
        true,
      );
      const gone = await failure(
        'query($id: ID!) { project(id: $id) { id } }',
        {
          id: project.id,
        },
      );
      expect(gone.extensions.code).toBe('PROJECT_NOT_FOUND');
      const files = await readdir(artifactsDir);
      expect(files).not.toContain(first.artifactKey);
      expect(files).not.toContain(second.artifactKey);
      expect(
        (
          await ok('query($id: ID!) { project(id: $id) { id } }', {
            id: other.id,
          })
        ).project.id,
      ).toBe(other.id);
    });

    it('con una importación en curso responde IMPORT_IN_PROGRESS y no borra nada', async () => {
      const { createProject: project } = await ok(createProject, { input });
      const { snapshotId, artifactKey } = await insertImport(
        project.id,
        'queued',
      );

      const importError = await failure(deleteImport, {
        p: project.id,
        s: snapshotId,
      });
      expect(importError.extensions).toMatchObject({
        code: 'IMPORT_IN_PROGRESS',
        message: { es: expect.any(String), en: expect.any(String) },
      });
      const projectError = await failure(deleteProject, { id: project.id });
      expect(projectError.extensions.code).toBe('IMPORT_IN_PROGRESS');
      expect(
        await prisma.catalogSnapshot.count({ where: { id: snapshotId } }),
      ).toBe(1);
      expect(await readdir(artifactsDir)).toContain(artifactKey);
    });

    it('no permite borrar recursos de otro usuario y valida los UUID', async () => {
      const { createProject: project } = await ok(createProject, { input });
      const { snapshotId } = await insertImport(project.id, 'succeeded');

      const foreignImport = await failure(
        deleteImport,
        { p: project.id, s: snapshotId },
        'bob-session',
      );
      expect(foreignImport.extensions.code).toBe('IMPORT_NOT_FOUND');
      const foreignProject = await failure(
        deleteProject,
        { id: project.id },
        'bob-session',
      );
      expect(foreignProject.extensions.code).toBe('PROJECT_NOT_FOUND');
      expect(
        await prisma.catalogSnapshot.count({ where: { id: snapshotId } }),
      ).toBe(1);

      const uuid = await failure(
        'mutation { deleteProject(id: "no-es-uuid") }',
      );
      expect(uuid.extensions.code).toBe('INVALID_UUID');
      const missing = await failure(deleteProject, { id: project.id }, '');
      expect(missing.extensions.code).toBe('AUTH_SESSION_REQUIRED');
    });
  });

  it('normaliza errores de análisis y desactiva el batching', async () => {
    const syntax = await failure('{ me { ', undefined, undefined, 400);
    expect(syntax.extensions).toMatchObject({
      code: 'BAD_REQUEST',
      message: { es: expect.any(String), en: expect.any(String) },
    });
    const unknown = await failure('{ noExiste }', undefined, undefined, 400);
    expect(unknown.extensions.code).toBe('BAD_REQUEST');

    await request(app.getHttpServer())
      .post('/api/graphql')
      .auth('alice-session', { type: 'bearer' })
      .send([{ query: '{ me { id } }' }, { query: '{ me { id } }' }])
      .expect((response) => {
        expect(response.body?.data).toBeUndefined();
      });
  });

  it('el esquema generado coincide con el esperado', async () => {
    const schema = app.get(GraphQLSchemaHost).schema;
    const file = resolve('test/features/graphql/schema.expected.graphql');
    // Con UPDATE_GRAPHQL_SCHEMA=1 se regenera el esperado para revisarlo en Git.
    if (process.env.UPDATE_GRAPHQL_SCHEMA) {
      await writeFile(file, `${printSchema(schema).trim()}\n`);
    }
    const expected = await readFile(file, 'utf8');
    expect(printSchema(schema).trim()).toBe(expected.trim());
  });
});
