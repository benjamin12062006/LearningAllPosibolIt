import { expect, it } from '@jest/globals';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import request from 'supertest';
import { AgentRunWorker } from '../../../src/agent-runs/agent-run.worker.js';
import {
  AGENT_RUN_DEFAULTS,
  AGENT_RUN_OPTIONS,
} from '../../../src/agent-runs/agent-runs.types.js';
import { MCP_ADAPTER_TOKEN } from '../../../src/integrations/integrations.types.js';
import {
  AiServiceClient,
  AI_SERVICE_CLIENT,
} from '../../../src/knowledge/ai-service.client.js';
import { KnowledgeSyncWorker } from '../../../src/knowledge/knowledge-sync.worker.js';
import {
  KNOWLEDGE_DEFAULTS,
  KNOWLEDGE_OPTIONS,
} from '../../../src/knowledge/knowledge.types.js';
import { ProjectsService } from '../../../src/projects/projects.service.js';
import {
  clientsFor,
  seedTwoOrganizations,
  startGraphqlApp,
} from '../graphql/support/graphql-test-app.js';
import { alice, projectInput } from '../support/project-fixtures.js';

const runProcess = promisify(execFile);
const aiDir = process.env.KTSU_E2E_AI_DIR;
const localStack = aiDir ? it : it.skip;
const AI_TOKEN = 'token_ia_para_prueba_local_0123456789abcdef';
const ADAPTER_TOKEN = 'token_mcp_para_prueba_local_0123456789abcdef';
const FIXTURE = ['-m', 'tests.support.local_mcp_stack'];

localStack(
  'Nest y FastAPI reales con MCP stdio y el chat de KTSU',
  async () => {
    const { AppModule } = await import('../../../src/app.module.js');
    const cwd = resolve(aiDir!);
    const python = resolve(cwd, '.venv/bin/python');
    let aiUrl = 'http://127.0.0.1:1';
    const api = await startGraphqlApp([AppModule], (builder) =>
      builder
        .overrideProvider(MCP_ADAPTER_TOKEN)
        .useValue(ADAPTER_TOKEN)
        .overrideProvider(AI_SERVICE_CLIENT)
        .useValue(
          new AiServiceClient({
            get url() {
              return aiUrl;
            },
            token: AI_TOKEN,
            timeoutMs: 15_000,
          }),
        )
        .overrideProvider(KNOWLEDGE_OPTIONS)
        .useValue({ ...KNOWLEDGE_DEFAULTS, autoStart: false })
        .overrideProvider(AGENT_RUN_OPTIONS)
        .useValue({ ...AGENT_RUN_DEFAULTS, autoStart: false, parallelRuns: 1 }),
    );
    let finishAi: (() => Promise<void>) | undefined;
    try {
      await api.app.listen(0, '127.0.0.1');
      const nestPort = (api.app.getHttpServer().address() as AddressInfo).port;
      const env = {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NEST_AGENT_BASE_URL: `http://127.0.0.1:${nestPort}`,
        AI_SERVICE_TOKEN: AI_TOKEN,
        GOOGLE_CLOUD_PROJECT: 'ktsu-local-test',
        KTSU_TEST_QDRANT_URL: process.env.KTSU_TEST_QDRANT_URL,
      };
      const ai = await startAi(python, cwd, env);
      finishAi = ai.close;
      aiUrl = ai.url;
      await waitForFastApi(aiUrl);
      await request(api.app.getHttpServer()).get('/api/v1/health').expect(200);

      const { pool } = api;
      const seed = await seedTwoOrganizations(api.app, pool);
      const project = await api.app.get(ProjectsService).create(alice, {
        ...projectInput,
        name: 'ajenomarcador del mismo equipo',
      });
      const { rows: outside } = await pool.query<{ organization_id: string }>(
        'SELECT organization_id FROM estadistica_forms.projects WHERE id = $1',
        [seed.bobProjectId],
      );
      const { rest } = clientsFor(api.app);
      const base = projectPath(seed.organizationId, seed.projectId);
      const main = await createSheet(rest(), base, 'propioverde');
      const sibling = await createSheet(
        rest(),
        projectPath(seed.organizationId, project.id),
        'ajenomarcador del mismo equipo',
      );
      const foreign = await createSheet(
        rest('bob-session'),
        projectPath(outside[0].organization_id, seed.bobProjectId),
        'ajenomarcador de otra organización',
      );

      const indexed = await api.app.get(KnowledgeSyncWorker).syncOnce();
      expect(indexed).toMatchObject({ rejected: 0, interrupted: false });
      expect(indexed.replaced).toBeGreaterThanOrEqual(9);

      const integration = `${base}/integrations`;
      const issued = await rest()
        .post(`${integration}/credentials`)
        .set('Idempotency-Key', randomUUID())
        .send({
          label: 'Cliente MCP local',
          audience: 'mcp',
          capabilities: ['read', 'prepare'],
        })
        .expect(201);
      const mcpEnvironment = {
        ...env,
        KTSU_MCP_ADAPTER_TOKEN: ADAPTER_TOKEN,
        KTSU_MCP_CREDENTIAL: issued.body.token as string,
        KTSU_TEST_PROJECT: seed.projectId,
        KTSU_TEST_WORKBOOK: main.workbookId,
        KTSU_TEST_WORKSHEET: main.worksheetId,
        KTSU_TEST_FOREIGN_WORKSHEETS: JSON.stringify([
          sibling.worksheetId,
          foreign.worksheetId,
        ]),
      };
      const mcp = await runProcess(python, [...FIXTURE, 'verify'], {
        cwd,
        env: mcpEnvironment,
        timeout: 40_000,
      });
      const { proposalId } = JSON.parse(mcp.stdout) as { proposalId: string };
      const review = `${integration}/proposals/${proposalId}`;
      const { body: prepared } = await rest().get(review).expect(200);
      expect(prepared.proposal.status).toBe('ready');
      const workbookPath = `${base}/workbooks/${main.workbookId}`;
      const before = await rest().get(`${workbookPath}/worksheets`).expect(200);
      expect(before.body.worksheets).toHaveLength(1);
      await rest()
        .post(`${review}/confirm`)
        .send({ proposalHash: prepared.proposal.hash })
        .expect(200)
        .expect(({ body }) => expect(body.proposal.status).toBe('confirmed'));
      await rest()
        .get(`${workbookPath}/worksheets`)
        .expect(200)
        .expect(({ body }) =>
          expect(
            body.worksheets.map((sheet: { name: string }) => sheet.name),
          ).toContain('Hoja desde MCP'),
        );
      await rest()
        .post(`${integration}/credentials/${issued.body.credential.id}/revoke`)
        .expect(204);
      await runProcess(python, [...FIXTURE, 'revoked'], {
        cwd,
        env: mcpEnvironment,
        timeout: 15_000,
      });

      const conversation = await rest()
        .post(`${base}/worksheets/${main.worksheetId}/conversations`)
        .send({ title: 'Comprobación local' })
        .expect(201);
      const messages = `${base}/conversations/${conversation.body.conversation.id}`;
      const posted = await rest()
        .post(`${messages}/messages`)
        .send({
          clientMessageId: randomUUID(),
          content:
            'Lee las columnas (id, nombre, tipo) y revisión vigente de una hoja. Prepara una hoja nueva y vacía con nombre y columnas tipadas.',
        })
        .expect(201);
      await rest('bob-session').get(`${messages}/messages`).expect(404);
      const queued = await rest()
        .post(`${messages}/runs`)
        .send({ messageId: posted.body.message.id })
        .expect(202);
      await api.app.get(AgentRunWorker).runUntilIdle();
      const runPath = `${base}/ai-runs/${queued.body.run.id}`;
      const result = await rest().get(runPath).expect(200);
      expect(result.body.run).toMatchObject({
        status: 'succeeded',
        outcome: 'confirmation_required',
        proposal: { status: 'ready', operation: 'propose_sheet_layout' },
      });
      const { id, hash } = result.body.run.proposal;
      await rest()
        .post(`${runPath}/proposals/${id}/confirm`)
        .send({ proposalHash: hash })
        .expect(200);
      const events = await pool.query<{
        type: string;
        payload: { operation?: string };
      }>(
        'SELECT type, payload FROM estadistica_forms.ai_run_events WHERE run_id = $1 ORDER BY sequence',
        [queued.body.run.id],
      );
      expect(events.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'tool.completed',
            payload: expect.objectContaining({
              operation: 'get_sheet_schema',
              status: 'succeeded',
            }),
          }),
          expect.objectContaining({
            type: 'tool.completed',
            payload: expect.objectContaining({
              operation: 'propose_sheet_layout',
              status: 'succeeded',
            }),
          }),
        ]),
      );
    } finally {
      try {
        await finishAi?.();
      } finally {
        await api.close();
      }
    }
  },
  90_000,
);

function projectPath(organizationId: string, projectId: string) {
  return `/api/v1/organizations/${organizationId}/projects/${projectId}`;
}

async function createSheet(
  rest: ReturnType<ReturnType<typeof clientsFor>['rest']>,
  base: string,
  name: string,
) {
  const workbook = await rest
    .post(`${base}/workbooks`)
    .send({ name })
    .expect(201);
  const workbookId = workbook.body.workbook.id as string;
  const sheet = await rest
    .post(`${base}/workbooks/${workbookId}/worksheets`)
    .send({ name, columns: [{ name: 'SKU', type: 'text' }] })
    .expect(201);
  return { workbookId, worksheetId: sheet.body.worksheet.id as string };
}

async function startAi(python: string, cwd: string, env: NodeJS.ProcessEnv) {
  const child = spawn(python, [...FIXTURE, 'serve'], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let diagnostics = '';
  child.stderr.on('data', (chunk: Buffer) => {
    diagnostics = (diagnostics + chunk.toString()).slice(-4000);
  });
  child.on('error', (error) => {
    diagnostics = error.message;
  });
  const closed = new Promise<void>((done) => child.once('close', () => done()));
  async function close() {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
    await closed;
  }
  const output = createInterface({ input: child.stdout });
  try {
    const [line] = await Promise.race([
      once(output, 'line', { signal: AbortSignal.timeout(15_000) }),
      closed.then(() => []),
    ]);
    if (typeof line !== 'string' || !/^\d+$/.test(line)) {
      throw new Error('El servicio de IA de pruebas no anunció su puerto.');
    }
    return { url: `http://127.0.0.1:${line}`, close };
  } catch (error) {
    await close();
    throw new Error(`FastAPI de pruebas no arrancó. ${diagnostics}`, {
      cause: error,
    });
  } finally {
    output.close();
    child.stdout.resume();
  }
}

async function waitForFastApi(url: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await fetch(`${url}/health`).catch(() => undefined);
    if (response?.ok) {
      return;
    }
    await delay(100);
  }
  throw new Error('FastAPI de pruebas no respondió a /health.');
}
