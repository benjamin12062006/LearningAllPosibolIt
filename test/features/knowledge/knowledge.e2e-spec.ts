import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { ArtifactStore } from '../../../src/artifacts/artifact.store.js';
import { ARTIFACT_STORE_OPTIONS } from '../../../src/artifacts/artifacts.types.js';
import type { AuthenticatedIdentity } from '../../../src/auth/authenticated-request.js';
import { DescopeService } from '../../../src/auth/descope.service.js';
import { CatalogImportModule } from '../../../src/catalog-import/catalog-import.module.js';
import { CATALOG_IMPORT_OPTIONS } from '../../../src/catalog-import/import.types.js';
import { publicError } from '../../../src/common/http/public-error.js';
import { configureHttp } from '../../../src/configure-http.js';
import { POSTGRESQL_CONNECTION } from '../../../src/database/postgresql.connection.js';
import { EvaluationsModule } from '../../../src/evaluations/evaluations.module.js';
import { EVALUATION_OPTIONS } from '../../../src/evaluations/evaluations.types.js';
import { EvaluationWorker } from '../../../src/evaluations/evaluations.worker.js';
import { ExportsModule } from '../../../src/exports/exports.module.js';
import { EXPORT_OPTIONS } from '../../../src/exports/exports.types.js';
import { FeedsModule } from '../../../src/feeds/feeds.module.js';
import { FEED_OPTIONS } from '../../../src/feeds/feeds.types.js';
import {
  AI_SERVICE_CLIENT,
  AiServiceRejectedError,
  AiServiceUnavailableError,
} from '../../../src/knowledge/ai-service.client.js';
import { KnowledgeSyncWorker } from '../../../src/knowledge/knowledge-sync.worker.js';
import { KnowledgeModule } from '../../../src/knowledge/knowledge.module.js';
import {
  KNOWLEDGE_OPTIONS,
  type KnowledgeDocument,
  type SourceKey,
  type SourceType,
} from '../../../src/knowledge/knowledge.types.js';
import type { OrganizationRole } from '../../../src/organizations/organization-roles.js';
import { ProjectsService } from '../../../src/projects/projects.service.js';
import { RulesetsModule } from '../../../src/rulesets/rulesets.module.js';
import { UsersService } from '../../../src/users/users.service.js';
import {
  insertReadySnapshot,
  mixedCatalog,
} from '../evaluations/support/snapshot-fixtures.js';
import { rulesetBody } from '../rulesets/support/ruleset-fixtures.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';

const carol: AuthenticatedIdentity = {
  ...alice,
  subject: 'carol',
  email: 'carol@example.test',
};
const SESSIONS: Record<string, AuthenticatedIdentity> = {
  'alice-session': alice,
  'bob-session': bob,
  'carol-session': carol,
};
type Session = keyof typeof SESSIONS;

const SYNC_TIME = '2026-11-12T10:00:00.000Z';
const PRODUCT_SOURCES: SourceType[] = [
  'catalog',
  'evaluation',
  'feed',
  'project',
  'ruleset',
];

type Replacement = { key: SourceKey; documents: readonly KnowledgeDocument[] };

/**
 * Servicio de IA de mentira: anota lo que Nest le manda y puede caerse o
 * rechazar una fuente, que son los dos fallos que el reconciliador distingue.
 */
class FakeAiService {
  replacements: Replacement[] = [];
  removedSources: SourceKey[] = [];
  removedProjects: { organizationId: string; projectId: string }[] = [];
  isDown = false;
  rejectedType: SourceType | null = null;

  reset() {
    this.replacements = [];
    this.removedSources = [];
    this.removedProjects = [];
    this.isDown = false;
    this.rejectedType = null;
  }

  async replaceSource(key: SourceKey, documents: readonly KnowledgeDocument[]) {
    this.failIfDown();
    if (key.sourceType === this.rejectedType) {
      throw new AiServiceRejectedError(422, 'DOCUMENT_TOO_LARGE');
    }
    this.replacements.push({ key, documents });
    return { written: documents.length, unchanged: 0, removed: 0 };
  }

  async removeSource(key: SourceKey) {
    this.failIfDown();
    this.removedSources.push(key);
  }

  async removeProject(organizationId: string, projectId: string) {
    this.failIfDown();
    this.removedProjects.push({ organizationId, projectId });
  }

  replacedTypes(projectId: string) {
    return this.replacements
      .filter(({ key }) => key.projectId === projectId)
      .map(({ key }) => key.sourceType)
      .sort();
  }

  documentsOf(projectId: string, sourceType: SourceType) {
    const found = this.replacements.find(
      ({ key }) => key.projectId === projectId && key.sourceType === sourceType,
    );
    return found?.documents ?? [];
  }

  private failIfDown() {
    if (this.isDown) {
      throw new AiServiceUnavailableError('El servicio de IA no responde.');
    }
  }
}

/**
 * E6.1b.1: Nest convierte lo que tiene cada proyecto en documentos y los manda
 * al servicio de IA, solo cuando cambian. Alice tiene el recorrido completo;
 * Bob, otra organización con un proyecto recién creado; Carol no es de ninguna
 * de las dos salvo que una prueba la invite.
 */
describe('Conocimiento por HTTP: Nest manda al servicio de IA lo que cambió', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  let disabledApp: INestApplication;
  let sync: KnowledgeSyncWorker;
  let root: string;
  let projectId: string;
  let bobProjectId: string;
  let organizationId: string;
  let carolId: string;
  let snapshotId: string;
  const ai = new FakeAiService();
  const validateSession = jest.fn<DescopeService['validateSession']>();

  const pool = () => database.connection.pool;
  const base = (id = projectId) => `/api/v1/projects/${id}`;

  function send(
    method: 'get' | 'post' | 'delete',
    path: string,
    session: Session = 'alice-session',
    target: INestApplication = app,
  ) {
    return request(target.getHttpServer())
      [method](path)
      .auth(session, { type: 'bearer' });
  }

  /** Evalúa el catálogo de Alice y devuelve lo que hay que aprobar para exportarlo. */
  async function evaluate() {
    const { body: accepted } = await send('post', `${base()}/evaluations`)
      .send({ snapshotId, rulesetRevision: 1 })
      .expect(202);
    await app.get(EvaluationWorker).runUntilIdle();
    const { body } = await send('get', accepted.statusUrl).expect(200);
    return {
      evaluationId: body.evaluation.id as string,
      resultChecksum: body.evaluation.resultChecksum as string,
      acceptedInvalidCount: body.evaluation.counts.invalid as number,
      acceptedExcludedCount: body.evaluation.counts.excluded as number,
    };
  }

  /** Reglas, catálogo, evaluación, exportación y feed publicado. */
  async function completeAliceProject() {
    await send('post', `${base()}/rulesets`).send(rulesetBody()).expect(201);
    snapshotId = await insertReadySnapshot(pool(), projectId, mixedCatalog(6));
    const approval = await evaluate();
    const { body: created } = await send('post', `${base()}/exports`)
      .send(approval)
      .expect(201);
    const { body: feed } = await send('post', `${base()}/feeds`).expect(201);
    await send('post', `${base()}/feeds/${feed.feed.id}/publications`)
      .send({ exportId: created.export.id, expectedGeneration: 0 })
      .expect(201);
  }

  async function setCarolRole(role: OrganizationRole) {
    await pool().query(
      `INSERT INTO estadistica_forms.organization_members
         (organization_id, user_id, role, created_at)
       VALUES ($1, $2, $3, '2026-11-12T09:00:00.000Z')
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = $3`,
      [organizationId, carolId, role],
    );
  }

  async function knowledgeStatus(session: Session = 'alice-session') {
    const { body } = await send('get', `${base()}/knowledge`, session).expect(
      200,
    );
    return body as {
      enabled: boolean;
      sources: {
        sourceType: SourceType;
        sourceId: string;
        syncedAt: string | null;
        pending: boolean;
      }[];
    };
  }

  const pendingTypes = async () =>
    (await knowledgeStatus()).sources
      .filter((source) => source.pending)
      .map((source) => source.sourceType)
      .sort();

  function productText(externalId: string) {
    const found = ai
      .documentsOf(projectId, 'catalog')
      .find((document) => document.metadata.external_id === externalId);
    return found?.text ?? '';
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    root = await mkdtemp(join(tmpdir(), 'knowledge-http-'));
    const idle = { autoStart: false, pollMs: 1000, shutdownMs: 1000 };
    const knowledgeOptions = { ...idle, clock: () => new Date(SYNC_TIME) };
    const module = await Test.createTestingModule({
      imports: [
        CatalogImportModule,
        RulesetsModule,
        EvaluationsModule,
        ExportsModule,
        FeedsModule,
        KnowledgeModule,
      ],
    })
      .overrideProvider(POSTGRESQL_CONNECTION)
      .useValue(database.connection)
      .overrideProvider(DescopeService)
      .useValue({ validateSession })
      .overrideProvider(ARTIFACT_STORE_OPTIONS)
      .useValue({ root })
      .overrideProvider(CATALOG_IMPORT_OPTIONS)
      .useValue(idle)
      .overrideProvider(EVALUATION_OPTIONS)
      .useValue(idle)
      .overrideProvider(EXPORT_OPTIONS)
      .useValue({ autoStart: false })
      .overrideProvider(FEED_OPTIONS)
      .useValue({ autoStart: false, retainedFiles: 3 })
      .overrideProvider(AI_SERVICE_CLIENT)
      .useValue(ai)
      .overrideProvider(KNOWLEDGE_OPTIONS)
      .useValue(knowledgeOptions)
      .compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
    sync = app.get(KnowledgeSyncWorker);

    // La misma API sin `AI_SERVICE_URL`: el conocimiento está desactivado.
    const disabledModule = await Test.createTestingModule({
      imports: [KnowledgeModule],
    })
      .overrideProvider(POSTGRESQL_CONNECTION)
      .useValue(database.connection)
      .overrideProvider(DescopeService)
      .useValue({ validateSession })
      .overrideProvider(AI_SERVICE_CLIENT)
      .useValue(null)
      .overrideProvider(KNOWLEDGE_OPTIONS)
      .useValue(knowledgeOptions)
      .compile();
    disabledApp = disabledModule.createNestApplication();
    configureHttp(disabledApp);
    await disabledApp.init();
  });
  beforeEach(async () => {
    validateSession.mockReset().mockImplementation(async (token) => {
      const identity = SESSIONS[token];
      if (!identity) throw new Error('Sesión de prueba inválida');
      return {
        jwt: token,
        token: {
          sub: identity.subject,
          iss: identity.issuer,
          email: identity.email,
        },
      };
    });
    ai.reset();
    await pool().query('TRUNCATE estadistica_forms.app_users CASCADE');
    // Sin clave foránea (D16): el TRUNCATE en cascada no la alcanza.
    await pool().query('TRUNCATE estadistica_forms.knowledge_sync_state');
    await rm(join(root, 'exports'), { recursive: true, force: true });
    await rm(join(root, 'feeds'), { recursive: true, force: true });
    await app.get(ArtifactStore).onModuleInit();
    const users = app.get(UsersService);
    const aliceId = (await users.provision(alice)).id;
    await users.provision(bob);
    carolId = (await users.provision(carol)).id;
    projectId = (await app.get(ProjectsService).create(alice, projectInput)).id;
    bobProjectId = (await app.get(ProjectsService).create(bob, projectInput))
      .id;
    const { rows } = await pool().query<{ id: string }>(
      `SELECT id FROM estadistica_forms.organizations
       WHERE personal_owner_id = $1`,
      [aliceId],
    );
    organizationId = rows[0].id;
  });
  afterAll(async () => {
    try {
      await disabledApp?.close();
      await app?.close();
    } finally {
      await database?.close();
      if (root) await rm(root, { recursive: true, force: true });
    }
  });

  describe('una pasada del reconciliador', () => {
    it('manda las cinco fuentes del proyecto completo y deja el estado al día', async () => {
      await completeAliceProject();

      const outcome = await sync.syncOnce();

      expect(ai.replacedTypes(projectId)).toEqual(PRODUCT_SOURCES);
      // El proyecto de Bob solo tiene su configuración.
      expect(ai.replacedTypes(bobProjectId)).toEqual(['project']);
      expect(outcome).toEqual({
        replaced: 6,
        removed: 0,
        removedProjects: 0,
        rejected: 0,
        interrupted: false,
      });
      const status = await knowledgeStatus();
      expect(status.enabled).toBe(true);
      expect(status.sources.map((source) => source.sourceType).sort()).toEqual(
        PRODUCT_SOURCES,
      );
      for (const source of status.sources) {
        expect(source).toMatchObject({
          sourceId: projectId,
          syncedAt: SYNC_TIME,
          pending: false,
        });
      }
    });

    it('la ficha de cada producto junta catálogo, evaluación y feed', async () => {
      await completeAliceProject();

      await sync.syncOnce();

      // mixedCatalog: SKU-1 válido, SKU-2 con el precio mal y SKU-3 excluido.
      expect(productText('SKU-1')).toContain('Evaluación: válido para Google.');
      expect(productText('SKU-1')).toContain('En el feed publicado: sí.');
      expect(productText('SKU-2')).toContain('Evaluación: inválido — price:');
      expect(productText('SKU-2')).toContain('En el feed publicado: no.');
      expect(productText('SKU-3')).toContain(
        'Evaluación: excluido por una regla del proyecto.',
      );
      expect(productText('SKU-3')).toContain('En el feed publicado: no.');
      // Una ficha por producto y una del catálogo.
      expect(ai.documentsOf(projectId, 'catalog')).toHaveLength(7);
    });

    it('una evaluación en cola no borra de la ficha el resultado de la última terminada', async () => {
      await completeAliceProject();
      await send('post', `${base()}/evaluations`)
        .send({ snapshotId, rulesetRevision: 1 })
        .expect(202);

      await sync.syncOnce();

      expect(productText('SKU-1')).toContain('Evaluación: válido para Google.');
      expect(productText('SKU-2')).toContain('Evaluación: inválido — price:');
    });

    it('no manda correos, tokens de entrega ni la URL pública del feed', async () => {
      await completeAliceProject();
      const { rows } = await pool().query<{ token: string | null }>(
        `SELECT delivery_token_hash AS token FROM estadistica_forms.feeds
         WHERE project_id = $1`,
        [projectId],
      );

      await sync.syncOnce();

      const sent = JSON.stringify(ai.replacements);
      expect(sent).not.toContain('@example.test');
      expect(sent).not.toContain('/feeds/');
      if (rows[0]?.token) {
        expect(sent).not.toContain(rows[0].token);
      }
    });

    it('sin cambios no manda nada; una evaluación nueva manda solo catálogo y evaluación', async () => {
      await completeAliceProject();
      await sync.syncOnce();
      ai.reset();

      const idle = await sync.syncOnce();

      expect(ai.replacements).toEqual([]);
      expect(idle.replaced).toBe(0);

      await evaluate();
      const outcome = await sync.syncOnce();

      expect(ai.replacedTypes(projectId)).toEqual(['catalog', 'evaluation']);
      expect(outcome.replaced).toBe(2);
    });
  });

  describe('fallos del servicio de IA', () => {
    it('si no responde, la pasada para sin guardar huellas y la siguiente lo manda todo', async () => {
      await completeAliceProject();
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      ai.isDown = true;

      const failed = await sync.syncOnce();

      expect(failed).toMatchObject({ replaced: 0, interrupted: true });
      expect(await pendingTypes()).toEqual(PRODUCT_SOURCES);

      ai.isDown = false;
      const recovered = await sync.syncOnce();

      expect(recovered).toMatchObject({ replaced: 6, interrupted: false });
      expect(await pendingTypes()).toEqual([]);
    });

    it('si rechaza una fuente, sigue con las demás y esa queda pendiente', async () => {
      await completeAliceProject();
      const logError = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      ai.rejectedType = 'catalog';

      const outcome = await sync.syncOnce();

      expect(outcome).toMatchObject({
        replaced: 5,
        rejected: 1,
        interrupted: false,
      });
      expect(await pendingTypes()).toEqual(['catalog']);
      // El registro dice qué fuente, nunca su contenido.
      expect(logError).toHaveBeenCalledWith({
        code: 'KNOWLEDGE_SOURCE_REJECTED',
        status: 422,
        serviceCode: 'DOCUMENT_TOO_LARGE',
        projectId,
        sourceType: 'catalog',
        sourceId: projectId,
      });
    });
  });

  describe('lo que desaparece', () => {
    it('al borrar el proyecto retira sus puntos y olvida su estado', async () => {
      await completeAliceProject();
      await sync.syncOnce();
      await send('delete', base()).expect(204);
      ai.reset();

      const outcome = await sync.syncOnce();

      expect(ai.removedProjects).toEqual([{ organizationId, projectId }]);
      expect(ai.replacements).toEqual([]);
      expect(outcome).toMatchObject({ removedProjects: 1, replaced: 0 });
      const { rows } = await pool().query(
        `SELECT 1 FROM estadistica_forms.knowledge_sync_state
         WHERE project_id = $1`,
        [projectId],
      );
      expect(rows).toEqual([]);

      // Ya olvidado: la pasada siguiente no vuelve a pedir el borrado.
      ai.reset();
      await sync.syncOnce();
      expect(ai.removedProjects).toEqual([]);
    });

    it('al borrar el catálogo retira esa fuente y deja las demás', async () => {
      await send('post', `${base()}/rulesets`).send(rulesetBody()).expect(201);
      snapshotId = await insertReadySnapshot(
        pool(),
        projectId,
        mixedCatalog(3),
      );
      await sync.syncOnce();
      await send('delete', `${base()}/imports/${snapshotId}`).expect(204);
      ai.reset();

      const outcome = await sync.syncOnce();

      expect(ai.removedSources).toHaveLength(1);
      expect(ai.removedSources[0]).toMatchObject({
        organizationId,
        projectId,
        sourceType: 'catalog',
        sourceId: projectId,
      });
      expect(outcome).toMatchObject({ removed: 1, replaced: 0 });
      const status = await knowledgeStatus();
      expect(status.sources.map((source) => source.sourceType).sort()).toEqual([
        'project',
        'ruleset',
      ]);
    });

    it('si el servicio cae al borrar, el proyecto se recuerda para reintentarlo', async () => {
      await sync.syncOnce();
      await send('delete', base()).expect(204);
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      ai.reset();
      ai.isDown = true;

      const failed = await sync.syncOnce();
      ai.isDown = false;
      const recovered = await sync.syncOnce();

      expect(failed).toMatchObject({ removedProjects: 0, interrupted: true });
      expect(recovered.removedProjects).toBe(1);
      expect(ai.removedProjects).toEqual([{ organizationId, projectId }]);
    });
  });

  describe('dos organizaciones (T18b)', () => {
    it('cada documento viaja con la organización de su proyecto', async () => {
      await completeAliceProject();
      const { rows } = await pool().query<{
        id: string;
        organizationId: string;
      }>(
        `SELECT id, organization_id AS "organizationId"
         FROM estadistica_forms.projects`,
      );
      const organizationOf = new Map(
        rows.map((row) => [row.id, row.organizationId]),
      );

      await sync.syncOnce();

      expect(ai.replacements.length).toBeGreaterThan(0);
      for (const { key } of ai.replacements) {
        expect(key.organizationId).toBe(organizationOf.get(key.projectId));
      }
      expect(organizationOf.get(bobProjectId)).not.toBe(organizationId);
      // Nada de Alice entra en lo que se manda del proyecto de Bob.
      const bobDocuments = JSON.stringify(
        ai.replacements.filter(({ key }) => key.projectId === bobProjectId),
      );
      expect(bobDocuments).not.toContain(projectId);
      expect(bobDocuments).not.toContain('SKU-1');
    });
  });

  describe('rutas', () => {
    it('cualquier miembro ve el estado; antes de la primera pasada todo está pendiente', async () => {
      await completeAliceProject();
      await setCarolRole('viewer');

      const status = await knowledgeStatus('carol-session');

      expect(status.enabled).toBe(true);
      expect(status.sources).toHaveLength(5);
      for (const source of status.sources) {
        expect(source).toMatchObject({ syncedAt: null, pending: true });
      }
    });

    it('reindexar pide Manager: Viewer y Editor reciben 403', async () => {
      for (const role of ['viewer', 'editor'] as const) {
        await setCarolRole(role);
        await send('post', `${base()}/knowledge/reindex`, 'carol-session')
          .expect(403)
          .expect(({ body }) =>
            expect(body).toMatchObject(publicError('FORBIDDEN')),
          );
      }
    });

    it('un Manager reindexa: 202 y la pasada siguiente manda el proyecto entero', async () => {
      await completeAliceProject();
      await sync.syncOnce();
      await setCarolRole('manager');
      ai.reset();

      await send('post', `${base()}/knowledge/reindex`, 'carol-session')
        .expect(202)
        .expect(({ body }) => expect(body).toEqual({ status: 'queued' }));

      expect(await pendingTypes()).toEqual(PRODUCT_SOURCES);
      await sync.syncOnce();
      expect(ai.replacedTypes(projectId)).toEqual(PRODUCT_SOURCES);
      // Reindexar un proyecto no toca el estado de los demás.
      expect(ai.replacedTypes(bobProjectId)).toEqual([]);
    });

    it('un proyecto ajeno responde 404 al leer y al reindexar', async () => {
      for (const [method, path] of [
        ['get', `${base()}/knowledge`],
        ['post', `${base()}/knowledge/reindex`],
      ] as const) {
        await send(method, path, 'bob-session')
          .expect(404)
          .expect(({ body }) =>
            expect(body).toMatchObject(publicError('PROJECT_NOT_FOUND')),
          );
      }
    });

    it('sin sesión responde 401 y un id que no es UUID, 400', async () => {
      await request(app.getHttpServer()).get(`${base()}/knowledge`).expect(401);
      await request(app.getHttpServer())
        .post(`${base()}/knowledge/reindex`)
        .expect(401);
      await send('get', '/api/v1/projects/no-es-uuid/knowledge').expect(400);
    });

    it('desactivado: el estado lo dice, reindexar responde 503 y no hay pasadas', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const { body } = await send(
        'get',
        `${base()}/knowledge`,
        'alice-session',
        disabledApp,
      ).expect(200);
      expect(body.enabled).toBe(false);

      await send(
        'post',
        `${base()}/knowledge/reindex`,
        'alice-session',
        disabledApp,
      )
        .expect(503)
        .expect(({ body: error }) =>
          expect(error).toMatchObject(publicError('KNOWLEDGE_DISABLED')),
        );

      const outcome = await disabledApp.get(KnowledgeSyncWorker).syncOnce();
      expect(outcome).toMatchObject({ replaced: 0, interrupted: false });
      expect(ai.replacements).toEqual([]);
    });
  });
});
