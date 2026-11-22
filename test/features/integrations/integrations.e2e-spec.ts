import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { CLI_OAUTH_CONFIG } from '../../../src/integrations/cli-oauth-config.js';
import type { AddressInfo } from 'node:net';
import type { Pool } from 'pg';
import request from 'supertest';
import {
  AGENT_RUN_DEFAULTS,
  AGENT_RUN_OPTIONS,
} from '../../../src/agent-runs/agent-runs.types.js';
import { DescopeService } from '../../../src/auth/descope.service.js';
import { MCP_OAUTH_CONFIG } from '../../../src/integrations/mcp-oauth-config.js';
import { FORBIDDEN_OPERATIONS } from '../../../src/agent-runs/operations/agent-operation-catalog.js';
import { IntegrationsModule } from '../../../src/integrations/integrations.module.js';
import {
  INTEGRATION_LIMITS,
  MCP_ADAPTER_TOKEN,
} from '../../../src/integrations/integrations.types.js';
import {
  AiServiceClient,
  AI_SERVICE_CLIENT,
} from '../../../src/knowledge/ai-service.client.js';
import {
  KNOWLEDGE_DEFAULTS,
  KNOWLEDGE_OPTIONS,
} from '../../../src/knowledge/knowledge.types.js';
import { ProjectsService } from '../../../src/projects/projects.service.js';
import {
  clientsFor,
  seedTwoOrganizations,
  setRole,
  startGraphqlApp,
} from '../graphql/support/graphql-test-app.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';

const ADAPTER_TOKEN = 'adaptador_mcp_de_pruebas_0123456789abcdef';
const AI_TOKEN = 'servicio_ia_de_pruebas_0123456789abcdef';
const MCP = '/internal/v1/mcp-integrations';
const START_TIME = '2026-11-14T15:00:00.000Z';
const RESOURCE = 'https://mcp.ktsu.example/mcp';
const CLI_RESOURCE = 'https://api.ktsu.example/api/v1/integrations';
const CLI_ISSUER = 'https://api.descope.com/v1/apps/Ptest';
const CLI_CLIENT = 'CliTestPublicClient';
const ISSUER = 'https://api.descope.com/v1/apps/agentic/Ptest/MStest';

type Scope = { organizationId: string; projectId: string };
type Sheet = { workbookId: string; worksheetId: string };
type Integration = {
  token: string;
  credential: { id: string; expiresAt: string };
};
type Preparation = {
  proposalId: string;
  summary: string;
  reviewPath: string;
  expiresAt: string;
};

describe('E6.7: credenciales, catálogo y confirmación MCP', () => {
  let app: INestApplication;
  let pool: Pool;
  let close: () => Promise<void>;
  let first: Scope;
  let sibling: Scope;
  let outside: Scope;
  let aliceId: string;
  let bobId: string;
  let sheet: Sheet;
  let siblingSheet: Sheet;
  let outsideSheet: Sheet;
  let now: Date;
  let aiRequest: { body: unknown; requestId: string | undefined };
  let knowledgeReply: (body: unknown) => Promise<unknown>;

  const rest = (session?: string) => clientsFor(app).rest(session);
  const http = () => request(app.getHttpServer());
  const projectPath = ({ organizationId, projectId }: Scope) =>
    `/api/v1/organizations/${organizationId}/projects/${projectId}`;
  const integrations = (scope = first) => `${projectPath(scope)}/integrations`;

  const searchServer = createServer((req, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      if (
        req.url !== '/v1/knowledge/search' ||
        req.headers.authorization !== `Bearer ${AI_TOKEN}`
      ) {
        response.writeHead(404).end();
        return;
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const header = req.headers['x-request-id'];
      aiRequest = {
        body,
        requestId: typeof header === 'string' ? header : undefined,
      };
      const payload = await knowledgeReply(body);
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify(payload));
    })().catch(() => response.writeHead(500).end());
  });

  beforeAll(async () => {
    await new Promise<void>((done) =>
      searchServer.listen(0, '127.0.0.1', done),
    );
    const url = `http://127.0.0.1:${(searchServer.address() as AddressInfo).port}`;
    ({ app, pool, close } = await startGraphqlApp(
      [IntegrationsModule],
      (builder) =>
        builder
          .overrideProvider(CLI_OAUTH_CONFIG)
          .useValue({
            clientId: CLI_CLIENT,
            issuer: CLI_ISSUER,
            resource: CLI_RESOURCE,
          })
          .overrideProvider(MCP_OAUTH_CONFIG)
          .useValue({
            resource: RESOURCE,
            issuer: ISSUER,
            get scope() {
              return first;
            },
          })
          .overrideProvider(DescopeService)
          .useValue({
            async validateSession(session: string) {
              const identity =
                session === 'alice-session'
                  ? alice
                  : session === 'bob-session'
                    ? bob
                    : null;
              if (!identity) throw new Error('Sesión de prueba inválida');
              return {
                token: {
                  sub: identity.subject,
                  iss: identity.issuer,
                  email: identity.email,
                },
              };
            },
            validateIntegrationAccess(
              jwt: string,
              audience: string,
              issuer: string,
            ) {
              expect(audience).toBe(CLI_RESOURCE);
              expect(issuer).toBe(CLI_ISSUER);
              const kind = jwt.split('.')[2];
              if (!jwt.startsWith('cli.alice.') || kind === 'wrongissuer')
                throw new Error('JWT inválido');
              return {
                sub: alice.subject,
                iss: alice.issuer,
                azp: kind === 'wrongclient' ? 'otro-cliente' : CLI_CLIENT,
                aud: [kind === 'wrongaudience' ? RESOURCE : CLI_RESOURCE],
                scope:
                  kind === 'wrongscope'
                    ? 'ktsu:mcp:read'
                    : kind === 'read'
                      ? 'ktsu:cli:read'
                      : 'ktsu:cli:read ktsu:cli:prepare',
                iat: Date.parse(START_TIME) / 1000,
                exp:
                  Date.parse(START_TIME) / 1000 +
                  (kind === 'expired' ? 0 : 600),
              };
            },
            async validateMcpAccess(
              jwt: string,
              audience: string,
              issuer: string,
            ) {
              expect(audience).toBe(RESOURCE);
              expect(issuer).toBe(ISSUER);
              if (
                ![
                  'oauth.alice.read',
                  'oauth.alice.prepare',
                  'oauth.alice.denied',
                  'oauth.bob.read',
                ].includes(jwt)
              ) {
                throw new Error('Token de prueba inválido');
              }
              return {
                sub: jwt.includes('.bob.') ? bob.subject : alice.subject,
                iss: alice.issuer,
                scope: jwt.endsWith('.denied')
                  ? 'openid'
                  : jwt.endsWith('.prepare')
                    ? 'ktsu:mcp:read ktsu:mcp:prepare'
                    : 'ktsu:mcp:read',
                iat: Date.parse(START_TIME) / 1000,
                exp: Date.parse(START_TIME) / 1000 + 600,
              };
            },
          })
          .overrideProvider(MCP_ADAPTER_TOKEN)
          .useValue(ADAPTER_TOKEN)
          .overrideProvider(AI_SERVICE_CLIENT)
          .useValue(
            new AiServiceClient({ url, token: AI_TOKEN, timeoutMs: 5000 }),
          )
          .overrideProvider(KNOWLEDGE_OPTIONS)
          .useValue({ ...KNOWLEDGE_DEFAULTS, autoStart: false })
          .overrideProvider(AGENT_RUN_OPTIONS)
          .useValue({
            ...AGENT_RUN_DEFAULTS,
            autoStart: false,
            clock: () => now,
          }),
    ));
    await app.listen(0, '127.0.0.1');
  });

  beforeEach(async () => {
    now = new Date(START_TIME);
    const seed = await seedTwoOrganizations(app, pool);
    ({ aliceId, bobId } = seed);
    const second = await app
      .get(ProjectsService)
      .create(alice, { ...projectInput, name: 'Otra tienda del equipo' });
    const team = await rest()
      .post('/api/v1/organizations')
      .send({ name: 'Organización de integraciones' })
      .expect(201);
    const organizationId = team.body.organization.id as string;
    await pool.query(
      'UPDATE estadistica_forms.projects SET organization_id = $1 WHERE id = ANY($2)',
      [organizationId, [seed.projectId, second.id]],
    );
    first = { organizationId, projectId: seed.projectId };
    sibling = { organizationId: first.organizationId, projectId: second.id };
    const { rows } = await pool.query<{ organization_id: string }>(
      'SELECT organization_id FROM estadistica_forms.projects WHERE id = $1',
      [seed.bobProjectId],
    );
    outside = {
      organizationId: rows[0].organization_id,
      projectId: seed.bobProjectId,
    };
    sheet = await createSheet(first, 'Precios');
    siblingSheet = await createSheet(sibling, 'Mercado de otro proyecto');
    outsideSheet = await createSheet(
      outside,
      'Hoja de otra organización',
      'bob-session',
    );
    knowledgeReply = async () => ({
      hits: [{ projectId: first.projectId, text: 'SKU-LIMON-DEL-PROYECTO' }],
    });
  });

  afterAll(async () => {
    await close?.();
    if (searchServer.listening) {
      await new Promise<void>((done) => searchServer.close(() => done()));
    }
  });

  it('emite una vez, guarda solo la huella y pagina los metadatos por titular', async () => {
    const key = randomUUID();
    const firstIssue = await issueRequest({ key }).expect(201);
    const { token, credential } = firstIssue.body as Integration;
    expect(firstIssue.headers['cache-control']).toBe('no-store');
    expect(credential.expiresAt).toBe('2026-11-15T15:00:00.000Z');
    await issueRequest({ key })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('INTEGRATION_CREDENTIAL_ALREADY_ISSUED');
        expect(body).not.toHaveProperty('token');
      });

    const stored = await pool.query<{ secret_hash: string }>(
      'SELECT secret_hash FROM estadistica_forms.integration_credentials WHERE id = $1',
      [credential.id],
    );
    const secret = token.split('.').at(-1) ?? '';
    expect(stored.rows[0].secret_hash).toBe(
      createHash('sha256').update(secret).digest('hex'),
    );

    await setRole(pool, first.organizationId, bobId, 'editor');
    const bobCredential = await issue({ session: 'bob-session' });
    const page = await rest()
      .get(`${integrations()}/credentials?limit=1`)
      .expect(200);
    expect(page.body.items).toHaveLength(1);
    const next = await rest()
      .get(
        `${integrations()}/credentials?limit=1&cursor=${page.body.nextCursor}`,
      )
      .expect(200);
    expect(next.body.nextCursor).toBeNull();
    expect([page.body.items[0].id, next.body.items[0].id]).toEqual(
      expect.arrayContaining([credential.id, bobCredential.credential.id]),
    );
    expect(JSON.stringify([page.body, next.body])).not.toContain(token);
    expect(page.body.items[0]).not.toHaveProperty('secretHash');
    const own = await rest('bob-session')
      .get(`${integrations()}/credentials`)
      .expect(200);
    expect(own.body.items.map((item: { id: string }) => item.id)).toEqual([
      bobCredential.credential.id,
    ]);
    await rest('bob-session')
      .get(`${integrations()}/credentials?cursor=${credential.id}`)
      .expect(400);
    await rest('bob-session')
      .post(`${integrations()}/credentials/${credential.id}/revoke`)
      .expect(404);
    await rest()
      .post(
        `${integrations()}/credentials/${bobCredential.credential.id}/revoke`,
      )
      .expect(204);
    await rest()
      .post(
        `${integrations()}/credentials/${bobCredential.credential.id}/revoke`,
      )
      .expect(204);
    await catalog(bobCredential.token).expect(401);
  });

  it('distingue las dos credenciales de la sesión humana y de otras audiencias', async () => {
    const { token, credential } = await issue();
    await http().get(`${integrations()}/credentials`).expect(401);
    await http()
      .get(`${MCP}/operations`)
      .auth(ADAPTER_TOKEN, { type: 'bearer' })
      .expect(401);
    await catalog(token, token).expect(401);
    await rest(token).get(`${integrations()}/credentials`).expect(401);
    await rest(token)
      .post(
        `/internal/v1/agent-runs/${randomUUID()}/operations/get_project_overview`,
      )
      .send({ mode: 'execute', arguments: {} })
      .expect(401);
    await catalog(token).expect(200);
    await pool.query(
      "UPDATE estadistica_forms.integration_credentials SET audience = 'cli' WHERE id = $1",
      [credential.id],
    );
    await catalog(token).expect(401);
  });

  it('OAuth exige el grant del titular y cruza scopes con el permiso de KTSU', async () => {
    const grant = (scope = first) =>
      rest()
        .post(`${integrations(scope)}/credentials`)
        .set('Idempotency-Key', randomUUID())
        .send({
          label: 'Codex OAuth',
          audience: 'mcp_oauth',
          capabilities: ['read', 'prepare'],
        });
    const oauth = (token: string, path = '/operations', projectId?: string) => {
      const request = http()
        .get(`${MCP}${path}`)
        .auth(ADAPTER_TOKEN, { type: 'bearer' })
        .set('X-Ktsu-Mcp-OAuth', `Bearer ${token}`);
      return projectId === undefined
        ? request
        : request.set('X-Ktsu-Mcp-Project', projectId);
    };

    await oauth('oauth.alice.read').expect(403);
    await oauth('wrong.test.jwt').expect(401);
    await oauth('oauth.alice.prepare', '/session', sibling.projectId).expect(
      403,
    );
    await oauth('oauth.alice.prepare', '/session', 'incorrecto').expect(400);
    await rest()
      .get(`${integrations(sibling)}/credentials`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.oauthResourceUrl).toBe(
          `${RESOURCE}?project=${sibling.projectId}`,
        );
      });
    const siblingGrant = await grant(sibling).expect(201);
    await oauth('oauth.alice.prepare', '/session', sibling.projectId)
      .expect(200)
      .expect(({ body }) => expect(body.projectId).toBe(sibling.projectId));
    await oauth('oauth.alice.prepare', '/session', outside.projectId).expect(
      403,
    );
    await rest()
      .post(
        `${integrations(sibling)}/credentials/${siblingGrant.body.credential.id}/revoke`,
      )
      .expect(204);
    await oauth('oauth.alice.prepare', '/session', sibling.projectId).expect(
      403,
    );
    const issued = await grant().expect(201);
    expect(issued.body.token).toBeUndefined();
    expect(issued.body.credential.audience).toBe('mcp_oauth');
    await grant().expect(409);
    await rest()
      .get(`${integrations()}/credentials`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.oauthResourceUrl).toBe(RESOURCE);
        expect(body.items[0].id).toBe(issued.body.credential.id);
      });
    await oauth('oauth.bob.read').expect(403);
    await oauth('oauth.alice.denied')
      .expect(403)
      .expect(({ body }) =>
        expect(body.code).toBe('INTEGRATION_OAUTH_SCOPE_REQUIRED'),
      );
    const read = await oauth('oauth.alice.read').expect(200);
    expect(
      read.body.operations.some(
        (item: { level: string }) => item.level === 'write',
      ),
    ).toBe(false);
    const capable = await oauth('oauth.alice.prepare').expect(200);
    expect(
      capable.body.operations.some(
        (item: { level: string }) => item.level === 'write',
      ),
    ).toBe(true);
    const proposal = await http()
      .post(`${MCP}/operations/propose_sheet_layout`)
      .auth(ADAPTER_TOKEN, { type: 'bearer' })
      .set('X-Ktsu-Mcp-OAuth', 'Bearer oauth.alice.prepare')
      .send({ callId: randomUUID(), mode: 'prepare', arguments: layout() })
      .expect(200);
    expect(await numberOfCreatedSheets()).toBe(0);
    const review = await rest()
      .get(`${integrations()}/proposals/${proposal.body.proposalId}`)
      .expect(200);
    await rest()
      .post(`${integrations()}/credentials/${issued.body.credential.id}/revoke`)
      .expect(204);
    await oauth('oauth.alice.prepare').expect(403);
    await rest()
      .post(`${integrations()}/proposals/${proposal.body.proposalId}/confirm`)
      .send({ proposalHash: review.body.proposal.hash })
      .expect(409);
    expect(await numberOfCreatedSheets()).toBe(0);
  });

  it('CLI OAuth separa recurso, cliente, ámbito, rol y revocación', async () => {
    const endpoint = '/api/v1/integrations';
    const status = (
      kind: string,
      projectId = first.projectId,
      path = '/session',
    ) =>
      http()
        .get(`${endpoint}${path}`)
        .auth(`cli.alice.${kind}`, { type: 'bearer' })
        .set('X-Ktsu-Cli-Project', projectId);
    await http()
      .get(`${endpoint}/oauth`)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          issuer: CLI_ISSUER,
          clientId: CLI_CLIENT,
          resource: CLI_RESOURCE,
        }),
      );
    await status('read').expect(403);
    const grant = await rest()
      .post(`${integrations()}/credentials`)
      .set('Idempotency-Key', randomUUID())
      .send({
        label: 'Terminal OAuth',
        audience: 'cli_oauth',
        capabilities: ['read', 'prepare'],
      })
      .expect(201);
    expect(grant.body.token).toBeUndefined();
    await status('read')
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          projectId: first.projectId,
          audience: 'cli',
          authentication: 'oauth',
          capabilities: ['read'],
        }),
      );
    await status('prepare')
      .expect(200)
      .expect(({ body }) =>
        expect(body.capabilities).toEqual(['read', 'prepare']),
      );
    const grantList = await rest()
      .get(`${integrations()}/credentials`)
      .expect(200);
    expect(
      grantList.body.items.map((item: { id: string }) => item.id),
    ).toContain(grant.body.credential.id);
    const prepared = await http()
      .post(`${endpoint}/operations/propose_sheet_layout`)
      .auth('cli.alice.prepare', { type: 'bearer' })
      .set('X-Ktsu-Cli-Project', first.projectId)
      .send({ callId: randomUUID(), mode: 'prepare', arguments: layout() })
      .expect(200);
    const reviewPath = `${integrations()}/proposals/${prepared.body.proposalId}`;
    const { body: preview } = await rest().get(reviewPath).expect(200);
    await rest()
      .post(`${reviewPath}/confirm`)
      .send({ proposalHash: preview.proposal.hash })
      .expect(200)
      .expect(({ body }) => expect(body.proposal.status).toBe('confirmed'));
    await status('prepare', sibling.projectId).expect(403);
    await status('prepare', outside.projectId).expect(403);
    for (const rejection of [
      'wrongissuer',
      'wrongclient',
      'wrongaudience',
      'expired',
    ]) {
      await status(rejection).expect(401);
    }
    await status('wrongscope').expect(403);
    await http()
      .get(`${endpoint}/session`)
      .auth('cli.alice.read', { type: 'bearer' })
      .expect(401);
    await rest('cli.alice.read')
      .get(`${integrations()}/credentials`)
      .expect(401);
    await rest()
      .post(`${integrations()}/credentials/${grant.body.credential.id}/revoke`)
      .expect(204);
    await status('prepare').expect(403);
  });

  it.each([
    ['cli-skill', 'ktsu-cli'],
    ['mcp-skill', 'ktsu-mcp'],
  ])(
    'sirve %s exacta al miembro del proyecto y rechaza usuarios ajenos',
    async (route, name) => {
      const path = `${integrations()}/${route}`;
      const folder = `skills/${name}`;
      await http().get(path).expect(401);
      await rest('bob-session').get(path).expect(404);
      const { body } = await rest()
        .get(path)
        .expect('Cache-Control', 'no-store')
        .expect(200);
      expect(body.name).toBe(name);
      // La lista servida debe cubrir todos los archivos de la carpeta: si se
      // añade uno a la skill sin publicarlo, la copia desde la web quedaría incompleta.
      const onDisk = (
        await readdir(folder, { recursive: true, withFileTypes: true })
      )
        .filter((entry) => entry.isFile())
        .map((entry) => relative(folder, join(entry.parentPath, entry.name)))
        .sort();
      expect(
        (body.files as { path: string }[]).map((file) => file.path).sort(),
      ).toEqual(onDisk);
      for (const file of body.files as { path: string; content: string }[]) {
        expect(file.content).toBe(
          await readFile(`${folder}/${file.path}`, 'utf8'),
        );
      }
    },
  );

  it('ejecuta la CLI incluida en la skill contra Nest con un perfil aislado', async () => {
    const { body } = await rest()
      .post(`${integrations()}/credentials`)
      .set('Idempotency-Key', randomUUID())
      .send({ label: 'CLI incluida', audience: 'cli', capabilities: ['read'] })
      .expect(201);
    const folder = await mkdtemp(join(tmpdir(), 'ktsu-skill-profile-'));
    const profile = join(folder, 'config.json');
    const address = app.getHttpServer().address() as AddressInfo;
    const cli = resolve('skills/ktsu-cli/scripts/ktsu-cli/bin/ktsu.mjs');
    const env = {
      PATH: process.env.PATH,
      KTSU_CONFIG_PATH: profile,
      KTSU_TOKEN: body.token as string,
    };
    const run = async (...args: string[]) => {
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [cli, ...args, '--json'],
        { env },
      );
      expect(stdout).not.toContain(body.token);
      return JSON.parse(stdout);
    };
    try {
      await run(
        'config',
        'set',
        '--api-url',
        `http://127.0.0.1:${address.port}`,
      );
      expect(await run('auth', 'status')).toMatchObject({
        projectId: first.projectId,
        capabilities: ['read'],
      });
      expect(
        (await run('operations', 'list')).operations.map(
          (item: { name: string }) => item.name,
        ),
      ).toContain('list_feed_versions');
      expect(
        (await run('operations', 'describe', 'list_feed_versions')).inputSchema
          .required,
      ).toContain('feedId');
      expect((await run('read', 'get_project_overview')).project.id).toBe(
        first.projectId,
      );
      expect(await readFile(profile, 'utf8')).not.toContain(body.token);
    } finally {
      await rm(folder, { force: true, recursive: true });
    }
  });

  it('eliminar un proyecto elimina también su delegación', async () => {
    const disposable = await app
      .get(ProjectsService)
      .create(alice, { ...projectInput, name: 'Proyecto temporal' });
    const { rows } = await pool.query<{ organization_id: string }>(
      'SELECT organization_id FROM estadistica_forms.projects WHERE id = $1',
      [disposable.id],
    );
    const scope = {
      organizationId: rows[0].organization_id,
      projectId: disposable.id,
    };
    const created = await rest()
      .post(`${integrations(scope)}/credentials`)
      .set('Idempotency-Key', randomUUID())
      .send({ label: 'Temporal', audience: 'mcp', capabilities: ['read'] })
      .expect(201);
    const { token } = created.body as Integration;
    await catalog(token).expect(200);
    await rest().delete(`/api/v1/projects/${disposable.id}`).expect(204);
    await catalog(token).expect(401);
  });

  it('revalida el rol, la expiración, el archivado y la pérdida de membresía', async () => {
    await setRole(pool, first.organizationId, bobId, 'viewer');
    await issueRequest({ session: 'bob-session', prepare: true }).expect(403);
    const viewer = await issue({ session: 'bob-session' });
    const viewed = await catalog(viewer.token).expect(200);
    expect(
      viewed.body.operations.map(
        (operation: { name: string }) => operation.name,
      ),
    ).not.toContain('select_rows');
    expect(
      viewed.body.operations.every(
        (operation: { level: string }) => operation.level === 'read',
      ),
    ).toBe(true);

    await setRole(pool, first.organizationId, bobId, 'editor');
    const editor = await issue({ session: 'bob-session', prepare: true });
    const editorOps = await catalog(editor.token).expect(200);
    expect(
      editorOps.body.operations.map(
        (operation: { name: string }) => operation.name,
      ),
    ).toContain('propose_sheet_layout');
    await setRole(pool, first.organizationId, bobId, 'viewer');
    await call(
      editor.token,
      'propose_sheet_layout',
      'prepare',
      layout(),
    ).expect(403);
    const delegated = await delegatedGet('/session', editor.token).expect(200);
    expect(delegated.body.capabilities).toEqual(['read']);

    await pool.query(
      'DELETE FROM estadistica_forms.organization_members WHERE organization_id=$1 AND user_id=$2',
      [first.organizationId, bobId],
    );
    await catalog(editor.token).expect(404);
    const { token, credential } = await issue({
      expiresAt: '2026-11-14T15:10:00.000Z',
    });
    now = new Date(credential.expiresAt);
    await catalog(token).expect(401);
    await issueRequest({ expiresAt: '2026-11-22T15:00:00.000Z' }).expect(400);

    const active = await issue();
    await rest()
      .post(`/api/v1/organizations/${first.organizationId}/archive`)
      .expect(200);
    await catalog(active.token).expect(409);
    await issueRequest().expect(409);
    await rest()
      .post(`${integrations()}/credentials/${active.credential.id}/revoke`)
      .expect(204);
  });

  it('limita el catálogo y los recursos a un proyecto aunque el titular vea otros', async () => {
    const { token } = await issue({ prepare: true });
    const { body } = await catalog(token).expect(200);
    const names: string[] = body.operations.map(
      (operation: { name: string }) => operation.name,
    );
    expect(names).toEqual(
      expect.arrayContaining([
        'get_project_overview',
        'get_sheet_schema',
        'search_knowledge',
      ]),
    );
    expect(
      names.some((name) =>
        FORBIDDEN_OPERATIONS.some((forbidden) => name === forbidden),
      ),
    ).toBe(false);
    const schema = body.operations.find(
      (item: { name: string }) => item.name === 'get_sheet_schema',
    );
    expect(schema.inputSchema.required).toEqual(['worksheetId']);
    await call(token, 'delete_project', 'execute').expect(404);
    await call(token, 'get_sheet_schema', 'execute', {}).expect(400);
    await call(token, 'get_sheet_schema', 'execute', {
      worksheetId: sheet.worksheetId,
      projectId: sibling.projectId,
    }).expect(400);
    await call(token, 'get_sheet_schema', 'execute', {
      worksheetId: sheet.worksheetId,
    })
      .expect(200)
      .expect(({ body: result }) => expect(result.name).toBe('Precios'));
    for (const worksheetId of [
      siblingSheet.worksheetId,
      outsideSheet.worksheetId,
    ]) {
      await call(token, 'get_sheet_schema', 'execute', { worksheetId }).expect(
        404,
      );
    }
    await call(
      token,
      'propose_sheet_layout',
      'prepare',
      layout(siblingSheet.workbookId),
    ).expect(404);
    await call(token, 'propose_sheet_layout', 'execute', layout()).expect(400);
    await rest()
      .get(
        `${integrations({ ...outside, projectId: first.projectId })}/credentials`,
      )
      .expect(404);
  });

  it('deduplica la preparación y reserva una sola confirmación humana', async () => {
    const { token, credential } = await issue({ prepare: true });
    const callId = randomUUID();
    const proposal = await prepare(token, callId);
    await call(token, 'propose_sheet_layout', 'prepare', layout(), callId)
      .expect(200)
      .expect(({ body }) => expect(body.proposalId).toBe(proposal.proposalId));
    await call(
      token,
      'propose_sheet_layout',
      'prepare',
      { ...layout(), name: 'Otro efecto' },
      callId,
    ).expect(422);
    expect(await numberOfCreatedSheets()).toBe(0);
    await setRole(pool, first.organizationId, bobId, 'manager');
    await rest('bob-session').get(proposalUrl(proposal)).expect(404);
    await rest(token).get(proposalUrl(proposal)).expect(401);
    const review = await rest().get(proposalUrl(proposal)).expect(200);
    const { hash } = review.body.proposal;
    await rest()
      .post(`${proposalUrl(proposal)}/confirm`)
      .send({ proposalHash: 'a'.repeat(64) })
      .expect(409);
    const approvals = await Promise.all([
      rest()
        .post(`${proposalUrl(proposal)}/confirm`)
        .send({ proposalHash: hash }),
      rest()
        .post(`${proposalUrl(proposal)}/confirm`)
        .send({ proposalHash: hash }),
    ]);
    expect(approvals.some((reply) => reply.status === 200)).toBe(true);
    expect(approvals.every((reply) => [200, 409].includes(reply.status))).toBe(
      true,
    );
    expect(await numberOfCreatedSheets()).toBe(1);
    const confirmed = approvals.find((response) => response.status === 200)
      ?.body.proposal;
    await rest()
      .post(`${integrations()}/credentials/${credential.id}/revoke`)
      .expect(204);
    await rest()
      .post(`${proposalUrl(proposal)}/confirm`)
      .send({ proposalHash: hash })
      .expect(200)
      .expect(({ body }) =>
        expect(body.proposal.result).toEqual(confirmed.result),
      );
    expect(await numberOfCreatedSheets()).toBe(1);
  });

  it('el MCP tiene lo mismo que la CLI: sus operaciones, el estado de una propuesta y sus archivos', async () => {
    const { token } = await issue({ prepare: true });
    const { body } = await catalog(token).expect(200);
    const names: string[] = body.operations.map(
      (operation: { name: string }) => operation.name,
    );
    expect(names).toEqual(
      expect.arrayContaining([
        'submit_changeset',
        'rebase_changeset',
        'export_worksheet',
        'delete_catalog_import',
        'create_feed',
        'refresh_feed',
        'list_feed_versions',
        'get_proposal_status',
        'read_worksheet_export_file',
        'read_catalog_export_file',
        'read_feed_version_file',
      ]),
    );
    const exportSchema = body.operations.find(
      (item: { name: string }) => item.name === 'export_worksheet',
    );
    expect(exportSchema.inputSchema.required).toEqual(
      expect.arrayContaining(['worksheetId']),
    );

    const prepared = (
      await call(token, 'export_worksheet', 'prepare', {
        worksheetId: sheet.worksheetId,
        format: 'csv',
      }).expect(200)
    ).body as Preparation;
    const status = async () =>
      (
        await call(token, 'get_proposal_status', 'execute', {
          proposalId: prepared.proposalId,
        }).expect(200)
      ).body.proposal;
    expect(await status()).toMatchObject({
      operation: 'export_worksheet',
      status: 'ready',
    });
    // Sin confirmar, no hay archivo.
    const early = await call(token, 'read_worksheet_export_file', 'execute', {
      proposalId: prepared.proposalId,
    }).expect(404);
    expect(early.body.code).toBe('WORKSHEET_EXPORT_NOT_FOUND');

    const review = await rest().get(proposalUrl(prepared)).expect(200);
    await rest()
      .post(`${proposalUrl(prepared)}/confirm`)
      .send({ proposalHash: review.body.proposal.hash })
      .expect(200);
    expect((await status()).status).toBe('confirmed');
    const { body: file } = await call(
      token,
      'read_worksheet_export_file',
      'execute',
      { proposalId: prepared.proposalId },
    ).expect(200);
    expect(file).toMatchObject({
      contentType: 'text/csv; charset=utf-8',
      encoding: 'utf-8',
    });
    // El mismo CSV que descarga la CLI: con BOM y la cabecera de la hoja.
    expect(file.content.startsWith('\uFEFF')).toBe(true);
    expect(file.bytes).toBeGreaterThan(3);

    // Lo ajeno o mal escrito no se lee; una lectura no se prepara.
    await call(token, 'get_proposal_status', 'execute', {
      proposalId: randomUUID(),
    }).expect(404);
    await call(token, 'read_feed_version_file', 'execute', {
      feedId: 'no-es-uuid',
      versionId: randomUUID(),
    }).expect(400);
    await call(token, 'get_proposal_status', 'prepare', {
      proposalId: prepared.proposalId,
    }).expect(400);
  });

  it('una propuesta pendiente deja de ser confirmable cuando revocan su credencial', async () => {
    const { token, credential } = await issue({
      prepare: true,
      expiresAt: '2026-11-14T15:10:00Z',
    });
    const proposal = await prepare(token);
    expect(proposal.expiresAt).toBe(credential.expiresAt);
    const { body: review } = await rest()
      .get(proposalUrl(proposal))
      .expect(200);
    const decision = { proposalHash: review.proposal.hash };
    await rest()
      .post(`${integrations()}/credentials/${credential.id}/revoke`)
      .expect(204);
    await rest()
      .post(`${proposalUrl(proposal)}/confirm`)
      .send(decision)
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('AGENT_PROPOSAL_EXPIRED'));
    await rest()
      .post(`${proposalUrl(proposal)}/reject`)
      .send(decision)
      .expect(200)
      .expect(({ body }) => expect(body.proposal.status).toBe('rejected'));
    expect(await numberOfCreatedSheets()).toBe(0);
  });

  it('cobra la cuota de forma compartida por persona y por proyecto', async () => {
    const one = await issue();
    const two = await issue();
    await setUsage(aliceId, INTEGRATION_LIMITS.requestsPerActorMinute - 1);
    await catalog(one.token).expect(200);
    await catalog(two.token)
      .expect(429)
      .expect(({ body }) =>
        expect(body.code).toBe('INTEGRATION_QUOTA_EXCEEDED'),
      );
    now = new Date(now.getTime() + 60_000);
    await catalog(two.token).expect(200);
    await setUsage('*', INTEGRATION_LIMITS.requestsPerProjectMinute);
    await delegatedGet('/session', one.token).expect(429);
  });

  it('envía una búsqueda solo al alcance delegado y la descarta si se revoca en tránsito', async () => {
    const { token, credential } = await issue();
    await call(token, 'search_knowledge', 'execute', {
      query: 'limón',
      projectIds: [sibling.projectId],
    }).expect(400);
    await call(token, 'search_knowledge', 'execute', {
      query: ' limón ',
      limit: 2,
    })
      .set('X-Request-Id', 'integracion-test-01')
      .expect(200)
      .expect(({ body }) => {
        expect(body.hits[0].text).toBe('SKU-LIMON-DEL-PROYECTO');
      });
    expect(aiRequest).toEqual({
      body: {
        organizationId: first.organizationId,
        projectIds: [first.projectId],
        query: 'limón',
        limit: 2,
      },
      requestId: 'integracion-test-01',
    });
    knowledgeReply = async () => ({
      hits: [{ projectId: sibling.projectId, text: 'AJENO' }],
    });
    await call(token, 'search_knowledge', 'execute', { query: 'limón' })
      .expect(503)
      .expect(({ body }) =>
        expect(JSON.stringify(body)).not.toContain('AJENO'),
      );

    knowledgeReply = async () => {
      await rest()
        .post(`${integrations()}/credentials/${credential.id}/revoke`)
        .expect(204);
      return { hits: [{ projectId: first.projectId, text: 'NO ENTREGAR' }] };
    };
    await call(token, 'search_knowledge', 'execute', { query: 'limón' })
      .expect(401)
      .expect(({ body }) =>
        expect(JSON.stringify(body)).not.toContain('NO ENTREGAR'),
      );
  });

  async function createSheet(
    scope: Scope,
    name: string,
    session?: string,
  ): Promise<Sheet> {
    const base = projectPath(scope);
    const created = await rest(session)
      .post(`${base}/workbooks`)
      .send({ name: 'Libro' })
      .expect(201);
    const workbookId = created.body.workbook.id as string;
    const result = await rest(session)
      .post(`${base}/workbooks/${workbookId}/worksheets`)
      .send({ name, columns: [{ name: 'Precio', type: 'decimal' }] })
      .expect(201);
    return { workbookId, worksheetId: result.body.worksheet.id as string };
  }

  function issueRequest(
    options: {
      session?: string;
      prepare?: boolean;
      key?: string;
      expiresAt?: string;
    } = {},
  ) {
    return rest(options.session)
      .post(`${integrations()}/credentials`)
      .set('Idempotency-Key', options.key ?? randomUUID())
      .send({
        label: 'MCP de pruebas',
        audience: 'mcp',
        capabilities: options.prepare ? ['read', 'prepare'] : ['read'],
        expiresAt: options.expiresAt,
      });
  }

  async function issue(
    options?: Parameters<typeof issueRequest>[0],
  ): Promise<Integration> {
    return (await issueRequest(options).expect(201)).body as Integration;
  }

  function delegatedGet(path: string, token: string, adapter = ADAPTER_TOKEN) {
    return http()
      .get(`${MCP}${path}`)
      .auth(adapter, { type: 'bearer' })
      .set('X-Ktsu-Delegation', `Bearer ${token}`);
  }

  function catalog(token: string, adapter?: string) {
    return delegatedGet('/operations', token, adapter);
  }

  function call(
    token: string,
    name: string,
    mode: 'execute' | 'prepare',
    args = {},
    callId: string = randomUUID(),
  ) {
    return http()
      .post(`${MCP}/operations/${name}`)
      .auth(ADAPTER_TOKEN, { type: 'bearer' })
      .set('X-Ktsu-Delegation', `Bearer ${token}`)
      .send({ callId, mode, arguments: args });
  }

  function layout(workbookId = sheet.workbookId) {
    return {
      workbookId,
      name: 'Nueva desde MCP',
      columns: [{ name: 'SKU', type: 'text' }],
    };
  }

  async function prepare(token: string, callId?: string): Promise<Preparation> {
    return (
      await call(
        token,
        'propose_sheet_layout',
        'prepare',
        layout(),
        callId,
      ).expect(200)
    ).body as Preparation;
  }

  function proposalUrl({ proposalId }: Preparation) {
    return `${integrations()}/proposals/${proposalId}`;
  }

  async function numberOfCreatedSheets() {
    const { rows } = await pool.query<{ total: number }>(
      'SELECT count(*)::int AS total FROM estadistica_forms.worksheets WHERE workbook_id=$1 AND name=$2',
      [sheet.workbookId, layout().name],
    );
    return rows[0].total;
  }

  async function setUsage(subject: string, used: number) {
    await pool.query(
      `INSERT INTO estadistica_forms.integration_usage (project_id, subject, minute, used)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id, subject) DO UPDATE SET minute=EXCLUDED.minute, used=EXCLUDED.used`,
      [first.projectId, subject, now.toISOString(), used],
    );
  }

  it('ofrece por MCP las lecturas de historial con la hoja obligatoria (plan 09, etapa 1)', async () => {
    const { token } = await issue();
    const offered = (await catalog(token).expect(200)).body as {
      operations: { name: string; inputSchema: { required?: string[] } }[];
    };
    const byName = new Map(
      offered.operations.map((operation) => [operation.name, operation]),
    );
    expect(byName.get('list_workbooks')).toBeDefined();
    expect(byName.get('open_changeset')?.inputSchema.required).toEqual([
      'changesetId',
    ]);
    for (const name of ['list_sheet_history', 'compare_revisions']) {
      expect(byName.get(name)?.inputSchema.required).toContain('worksheetId');
    }

    await call(token, 'list_workbooks', 'execute')
      .expect(200)
      .expect(({ body }) =>
        expect(body.workbooks).toEqual([
          expect.objectContaining({ id: sheet.workbookId }),
        ]),
      );
    await call(token, 'list_sheet_history', 'execute', {
      kind: 'revisions',
    }).expect(400);
    await call(token, 'list_sheet_history', 'execute', {
      worksheetId: sheet.worksheetId,
      kind: 'revisions',
    })
      .expect(200)
      .expect(({ body }) => expect(body.items).toHaveLength(1));
    await call(token, 'list_sheet_history', 'execute', {
      worksheetId: siblingSheet.worksheetId,
      kind: 'revisions',
    }).expect(404);
  });
});
