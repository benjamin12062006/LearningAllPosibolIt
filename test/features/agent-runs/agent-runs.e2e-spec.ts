import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import { AgentGatewayService } from '../../../src/agent-runs/agent-gateway.service.js';
import { AgentRunWorker } from '../../../src/agent-runs/agent-run.worker.js';
import {
  AGENT_RUN_OPTIONS,
  AGENT_RUN_DEFAULTS,
  AGENT_RUN_LIMITS,
  type AgentRunQuota,
} from '../../../src/agent-runs/agent-runs.types.js';
import { FORBIDDEN_OPERATIONS } from '../../../src/agent-runs/operations/agent-operation-catalog.js';
import {
  AI_SERVICE_CLIENT,
  AiServiceClient,
} from '../../../src/knowledge/ai-service.client.js';
import {
  KNOWLEDGE_DEFAULTS,
  KNOWLEDGE_OPTIONS,
} from '../../../src/knowledge/knowledge.types.js';
import {
  CATALOG_RULESET,
  catalogValues,
  insertReadySnapshot,
} from '../evaluations/support/snapshot-fixtures.js';
import {
  clientsFor,
  seedTwoOrganizations,
  setRole,
  startGraphqlApp,
} from '../graphql/support/graphql-test-app.js';
import {
  columnIdsOf,
  FIXTURE_COLUMNS,
  ROW_IDS,
  SECOND_REVISION_ID,
  seedTwoRevisions,
  type FixtureColumnIds,
} from '../worksheets/support/row-fixtures.js';
import { postgresTestUrl } from '../support/postgres-database.js';

/** Los campos de cada evento SSE que promete el contrato de la web (E6.6). */
const EVENT_KEYS = JSON.parse(
  readFileSync(resolve('contracts/chat/events.json'), 'utf8'),
) as Record<string, string[]>;
const postgresUrl = postgresTestUrl();
const hasPostgres = postgresUrl !== null;
const itOnPostgres = hasPostgres ? it : it.skip;

type SseEvent = Readonly<{ id: number; type: string; data: any }>;

/** Lee un flujo SSE ya terminado: `id`, `event` y `data` de cada bloque. */
function parseSse(text: string): SseEvent[] {
  return text
    .split('\n\n')
    .filter((block) => block.startsWith('id: '))
    .map((block) => {
      const fields = Object.fromEntries(
        block.split('\n').map((line) => {
          const at = line.indexOf(': ');
          return [line.slice(0, at), line.slice(at + 2)];
        }),
      );
      return {
        id: Number(fields.id),
        type: fields.event,
        data: JSON.parse(fields.data),
      };
    });
}

const SERVICE_TOKEN = 'token-de-servicio-de-pruebas-0123456789abcdef';
const FIVE_PERCENT = {
  kind: 'percentage',
  rate: '5',
  scale: 2,
  rounding: 'half_up',
};

type AgentRequest = Record<string, any>;
type GatewayReply = Readonly<{ status: number; body: any }>;
/** Lo que hace el agente de mentira en una ejecución, llamando a la pasarela. */
type Script = (
  request: AgentRequest,
  call: (
    name: string,
    mode: 'execute' | 'prepare',
    args: object,
    credential?: string,
  ) => Promise<GatewayReply>,
) => Promise<{ status: number; body: object }>;

/**
 * E6.3a: la persona inicia una ejecución desde su mensaje; el agente (aquí un
 * servidor HTTP que hace lo que haría FastAPI) llama a la pasarela de Nest con
 * la credencial de la ejecución; lo que escribe queda como propuesta y solo la
 * persona la confirma.
 */
describe('E6.3a: ejecuciones del agente, pasarela y confirmación', () => {
  let app: INestApplication;
  let pool: Pool;
  let close: () => Promise<void>;
  let nestUrl: string;
  let agent: Server;
  let script: Script;
  const received: AgentRequest[] = [];
  let organizationId: string;
  let projectId: string;
  let aliceId: string;
  let bobId: string;
  let worksheetId: string;
  let col: FixtureColumnIds;
  let quota: AgentRunQuota = AGENT_RUN_DEFAULTS.quota;
  /** Cuánto se adelanta el reloj de las ejecuciones en una prueba. */
  let clockAheadMs = 0;

  const client = () => clientsFor(app);
  const base = () =>
    `/api/v1/organizations/${organizationId}/projects/${projectId}`;

  function gateway(
    runId: string,
    credential: string,
  ): (
    name: string,
    mode: 'execute' | 'prepare',
    args: object,
    override?: string,
  ) => Promise<GatewayReply> {
    return async (name, mode, args, override) => {
      const response = await fetch(
        `${nestUrl}/internal/v1/agent-runs/${runId}/operations/${name}`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${override ?? credential}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ mode, arguments: args }),
        },
      );
      return { status: response.status, body: await response.json() };
    };
  }

  async function startAgent() {
    agent = createServer((request, response) => {
      let raw = '';
      request.on('data', (chunk) => (raw += chunk));
      request.on('end', () => {
        void (async () => {
          const body = JSON.parse(raw || '{}') as AgentRequest;
          if (request.url === '/v1/agent/runs') {
            received.push(body);
            const reply = await script(
              body,
              gateway(body.runId, body.credential),
            );
            response.writeHead(reply.status, {
              'content-type': 'application/json',
            });
            response.end(JSON.stringify(reply.body));
            return;
          }
          if (request.url === '/v1/knowledge/search') {
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ hits: [] }));
            return;
          }
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({ written: 0, unchanged: 0, removed: 0 }),
          );
        })();
      });
    });
    await new Promise<void>((done) => agent.listen(0, '127.0.0.1', done));
    return `http://127.0.0.1:${(agent.address() as AddressInfo).port}`;
  }

  /** Conversación con un mensaje de Alice; devuelve sus IDs. */
  async function conversationWithMessage(
    content = 'Sube un 5 % los precios',
    parent = `${base()}/worksheets/${worksheetId}`,
  ) {
    const { rest } = client();
    const { body: created } = await rest()
      .post(`${parent}/conversations`)
      .send({ title: 'Precios' })
      .expect(201);
    const { body: posted } = await rest()
      .post(`${base()}/conversations/${created.conversation.id}/messages`)
      .send({ clientMessageId: randomUUID(), content })
      .expect(201);
    return {
      conversationId: created.conversation.id as string,
      messageId: posted.message.id as string,
    };
  }

  /** Abre el SSE de una ejecución terminada y devuelve sus eventos. */
  async function eventsOf(
    runId: string,
    query = '',
    headers: Record<string, string> = {},
  ): Promise<SseEvent[]> {
    let request = client()
      .rest()
      .get(`${base()}/ai-runs/${runId}/events${query}`);
    for (const [name, value] of Object.entries(headers)) {
      request = request.set(name, value);
    }
    const response = await request
      .buffer(true)
      .parse((res, done) => {
        let text = '';
        res.on('data', (chunk: Buffer) => (text += chunk.toString()));
        res.on('end', () => done(null, text));
      })
      .expect(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    return parseSse(response.body as string);
  }

  async function runToEnd(
    context?: object,
    trigger?: Awaited<ReturnType<typeof conversationWithMessage>>,
  ) {
    const { conversationId, messageId } =
      trigger ?? (await conversationWithMessage());
    const { body } = await client()
      .rest()
      .post(`${base()}/conversations/${conversationId}/runs`)
      .send({ messageId, ...(context ? { context } : {}) })
      .expect(202);
    expect(body.run.status).toBe('queued');
    await app.get(AgentRunWorker).runUntilIdle();
    const { body: done } = await client()
      .rest()
      .get(`${base()}/ai-runs/${body.run.id}`)
      .expect(200);
    return { run: done.run, conversationId, messageId };
  }

  /** El recorrido completo del 5 %: leer, seleccionar, calcular y preparar. */
  const fivePercentScript: Script = async (request, call) => {
    const schema = await call('get_sheet_schema', 'execute', {});
    const price = schema.body.columns.find(
      (column: { name: string }) => column.name === 'Precio',
    ).id;
    const selection = await call('select_rows', 'execute', {
      columnIds: [price],
      rows: { kind: 'selectedRows', rowIds: [ROW_IDS.a, ROW_IDS.b] },
    });
    const preview = await call('preview_transform', 'execute', {
      selectionId: selection.body.selectionId,
      columnIds: [price],
      transform: FIVE_PERCENT,
    });
    const prepared = await call('create_change_proposal', 'prepare', {
      previewId: preview.body.previewId,
      explanation: 'Subir un 5 % los precios',
    });
    return {
      status: 200,
      body: {
        status: 'confirmation_required',
        answer: prepared.body.summary,
        calls: [],
        confirmation: null,
      },
    };
  };

  beforeAll(async () => {
    const agentUrl = await startAgent();
    ({ app, pool, close } = await startGraphqlApp(
      [],
      (builder) =>
        builder
          .overrideProvider(AI_SERVICE_CLIENT)
          .useValue(
            new AiServiceClient({
              url: agentUrl,
              token: SERVICE_TOKEN,
              timeoutMs: 10_000,
            }),
          )
          .overrideProvider(KNOWLEDGE_OPTIONS)
          .useValue({ ...KNOWLEDGE_DEFAULTS, autoStart: false })
          .overrideProvider(AGENT_RUN_OPTIONS)
          .useValue({
            ...AGENT_RUN_DEFAULTS,
            parallelRuns: hasPostgres ? AGENT_RUN_DEFAULTS.parallelRuns : 1,
            autoStart: false,
            // Cada prueba puede bajar la cuota sin arrancar otra aplicación.
            clock: () => new Date(Date.now() + clockAheadMs),
            get quota() {
              return quota;
            },
          }),
      postgresUrl,
    ));
    await app.listen(0, '127.0.0.1');
    nestUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });
  beforeEach(async () => {
    received.length = 0;
    script = fivePercentScript;
    quota = AGENT_RUN_DEFAULTS.quota;
    clockAheadMs = 0;
    ({ organizationId, projectId, aliceId, bobId } = await seedTwoOrganizations(
      app,
      pool,
    ));
    const { rest } = client();
    const { body: workbook } = await rest()
      .post(`${base()}/workbooks`)
      .send({ name: 'Libro' })
      .expect(201);
    const { body } = await rest()
      .post(`${base()}/workbooks/${workbook.workbook.id}/worksheets`)
      .send({ name: 'Precios', columns: FIXTURE_COLUMNS })
      .expect(201);
    worksheetId = body.worksheet.id;
    col = columnIdsOf(body.worksheet);
    await seedTwoRevisions(pool, body.worksheet, organizationId, aliceId);
  });
  afterAll(async () => {
    await close?.();
    await new Promise((done) => agent?.close(done));
  });

  it('usa las herramientas de proyecto sin libro ni hoja y exige confirmar reglas y evaluaciones', async () => {
    const { rest } = client();
    const snapshotId = await insertReadySnapshot(pool, projectId, [
      catalogValues('A1'),
    ]);
    const calls: GatewayReply[] = [];
    const readAndPropose: Script = async (_request, call) => {
      calls.push(await call('get_catalog_snapshot', 'execute', { snapshotId }));
      calls.push(await call('get_ruleset', 'execute', {}));
      calls.push(await call('get_evaluation_report', 'execute', {}));
      calls.push(await call('get_feed_status', 'execute', {}));
      const proposal = await call('create_ruleset', 'prepare', {
        ...CATALOG_RULESET,
        baseRevision: 0,
      });
      calls.push(proposal);
      return {
        status: 200,
        body: {
          status: 'confirmation_required',
          answer: 'Revisa el mapeo y las reglas.',
          proposalId: proposal.body.proposalId,
        },
      };
    };
    script = readAndPropose;
    await setRole(pool, organizationId, bobId, 'viewer');
    await rest('bob-session')
      .post(`${base()}/conversations`)
      .send({ title: 'Probar permiso' })
      .expect(403);
    const trigger = await conversationWithMessage('Prepara las reglas', base());
    const { run, conversationId } = await runToEnd(undefined, trigger);
    expect(received[0].context).toEqual({
      workbookId: null,
      worksheetId: null,
      revisionId: null,
      selectionId: null,
    });
    expect(calls.map(({ status }) => status)).toEqual([
      200, 200, 200, 200, 200,
    ]);
    expect(calls[0].body).toMatchObject({ id: snapshotId, status: 'ready' });
    expect(run.proposal.rulesetReview).toEqual(CATALOG_RULESET);
    await rest('bob-session')
      .get(`${base()}/conversations/${conversationId}`)
      .expect(404);
    const history = await rest()
      .get(`${base()}/conversations/${conversationId}/messages`)
      .expect(200);
    expect(
      history.body.items.map((message: { role: string }) => message.role),
    ).toEqual(['user', 'assistant']);
    expect(
      await pool.query(
        'SELECT id FROM estadistica_forms.ruleset_versions WHERE project_id = $1',
        [projectId],
      ),
    ).toMatchObject({ rowCount: 0 });

    async function confirm(active: typeof run) {
      const path = `${base()}/ai-runs/${active.id}/proposals/${active.proposal.id}/confirm`;
      const { body } = await rest()
        .post(path)
        .send({ proposalHash: active.proposal.hash })
        .expect(200);
      return body.proposal.result;
    }

    expect(await confirm(run)).toEqual({ rulesetRevision: 1 });
    expect(await confirm(run)).toEqual({ rulesetRevision: 1 });

    let preview: GatewayReply | undefined;
    script = async (_request, call) => {
      preview = await call('preview_rules', 'execute', {
        ...CATALOG_RULESET,
        snapshotId,
        baseRevision: 1,
      });
      const proposal = await call('request_evaluation', 'prepare', {
        snapshotId,
        rulesetRevision: 1,
      });
      return {
        status: 200,
        body: {
          status: 'confirmation_required',
          answer: 'Revisa la evaluación.',
          proposalId: proposal.body.proposalId,
        },
      };
    };
    const next = await conversationWithMessage(
      'Prueba la revisión y lanza la evaluación',
      base(),
    );
    const { run: evaluationRun } = await runToEnd(undefined, next);
    expect(preview).toMatchObject({
      status: 200,
      body: { baseRevision: 1, changedProducts: 0 },
    });
    expect(
      await pool.query(
        'SELECT id FROM estadistica_forms.evaluations WHERE project_id = $1',
        [projectId],
      ),
    ).toMatchObject({ rowCount: 0 });
    const result = await confirm(evaluationRun);
    expect(result).toEqual({ evaluationId: evaluationRun.proposal.id });
    expect(await confirm(evaluationRun)).toEqual(result);
    expect(
      await pool.query(
        'SELECT id FROM estadistica_forms.evaluations WHERE project_id = $1',
        [projectId],
      ),
    ).toMatchObject({ rowCount: 1 });
  });

  itOnPostgres(
    'atiende dos conversaciones aunque la primera siga esperando al modelo',
    async () => {
      function gate() {
        let resolve!: () => void;
        const promise = new Promise<void>((release) => {
          resolve = release;
        });
        return { promise, resolve };
      }
      const first = await conversationWithMessage('Primera tarea', base());
      const second = await conversationWithMessage('Segunda tarea', base());
      const release = gate();
      const secondStarted = gate();
      script = async (request) => {
        if (request.message === 'Primera tarea') await release.promise;
        if (request.message === 'Segunda tarea') secondStarted.resolve();
        return {
          status: 200,
          body: { status: 'answered', answer: 'Listo.', calls: [] },
        };
      };
      const { rest } = client();
      const accepted = await Promise.all(
        [first, second].map(({ conversationId, messageId }) =>
          rest()
            .post(`${base()}/conversations/${conversationId}/runs`)
            .send({ messageId })
            .expect(202),
        ),
      );
      const work = app.get(AgentRunWorker).runUntilIdle();
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          secondStarted.promise,
          new Promise<never>((_, reject) => {
            deadline = setTimeout(
              () =>
                reject(
                  new Error(
                    'La segunda conversación quedó esperando a la primera.',
                  ),
                ),
              4_000,
            );
          }),
        ]);
      } finally {
        clearTimeout(deadline);
        release.resolve();
        await work;
      }
      for (const response of accepted) {
        const { body } = await rest()
          .get(`${base()}/ai-runs/${response.body.run.id}`)
          .expect(200);
        expect(body.run.status).toBe('succeeded');
      }
    },
  );

  it('mantiene la conversación al cambiar el contexto y prepara un catálogo con actividad en vivo', async () => {
    const trigger = await conversationWithMessage(
      'Lleva SKU al catálogo',
      base(),
    );
    const path = `${base()}/conversations/${trigger.conversationId}`;
    const { rest } = client();
    const empty = await rest().get(`${path}/runs/latest`).expect(200);
    expect(empty.body.run).toBeNull();
    const selection = await rest()
      .post(`${base()}/worksheets/${worksheetId}/selections`)
      .send({
        revisionId: SECOND_REVISION_ID,
        columnIds: [col.sku],
        rows: { kind: 'selectedRows', rowIds: [ROW_IDS.a] },
      })
      .expect(201);
    const calls: GatewayReply[] = [];
    script = async (_run, call) => {
      calls.push(
        await call('search_knowledge', 'execute', {
          query: 'catálogo de prueba',
        }),
      );
      calls.push(
        await call('propose_catalog_from_sheet', 'prepare', {
          idColumnId: col.sku,
          columns: [col.sku],
        }),
      );
      return {
        status: 200,
        body: {
          status: 'confirmation_required',
          answer: 'Revisa la importación.',
          calls: [],
        },
      };
    };
    const { run } = await runToEnd(
      {
        section: 'worksheets',
        language: 'en',
        worksheetId,
        revisionId: SECOND_REVISION_ID,
        selectionId: selection.body.selectionId,
      },
      trigger,
    );
    expect(received[0].context).toMatchObject({
      section: 'worksheets',
      language: 'en',
      worksheetId,
      selectionId: selection.body.selectionId,
    });
    expect(calls.map(({ status }) => status)).toEqual([200, 200]);
    const events = await eventsOf(run.id);
    expect(
      events
        .filter(({ type }) => type === 'tool.completed')
        .map(({ data }) => data.operation),
    ).toEqual(['search_knowledge', 'propose_catalog_from_sheet']);
    const restored = await rest().get(`${path}/runs/latest`).expect(200);
    expect(restored.body.run.proposal).toMatchObject({
      id: run.proposal.id,
      status: 'ready',
      summary: expect.stringContaining('Create an import'),
    });
    const catalogPath = `/api/v1/projects/${projectId}/imports/${run.proposal.id}`;
    await rest().get(catalogPath).expect(404);
    const confirmPath = `${base()}/ai-runs/${run.id}/proposals/${run.proposal.id}/confirm`;
    const confirm = () =>
      rest().post(confirmPath).send({ proposalHash: run.proposal.hash });
    const result = await confirm().expect(200);
    expect(result.body.proposal.result).toMatchObject({
      snapshotId: run.proposal.id,
    });
    expect((await confirm().expect(200)).body.proposal.result).toEqual(
      result.body.proposal.result,
    );
    await rest().get(catalogPath).expect(200);

    const next = await rest()
      .post(`${path}/messages`)
      .send({
        clientMessageId: randomUUID(),
        content: 'Ahora revisa las reglas',
      })
      .expect(201);
    script = async () => ({
      status: 200,
      body: { status: 'answered', answer: 'Reglas consultadas.', calls: [] },
    });
    await runToEnd(
      { section: 'rules' },
      { ...trigger, messageId: next.body.message.id },
    );
    expect(received[1].context).toMatchObject({
      section: 'rules',
      worksheetId: null,
      selectionId: null,
    });
  });

  it('el agente lee y prepara; la persona confirma y solo entonces nace el borrador', async () => {
    const before = await client()
      .rest()
      .post(`${base()}/worksheets/${worksheetId}/rows/query`)
      .send({})
      .expect(200);

    const { run, conversationId } = await runToEnd();

    // Lo que recibió el agente: su proyecto, la hoja de la conversación y el catálogo.
    const request = received[0];
    expect(request.scope).toEqual({ organizationId, projectIds: [projectId] });
    expect(request.context).toMatchObject({ worksheetId });
    expect(request.message).toBe('Sube un 5 % los precios');
    const names = request.operations.map((op: { name: string }) => op.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'get_sheet_schema',
        'query_rows',
        'preview_transform',
        'create_change_proposal',
      ]),
    );
    expect(
      names.filter((name: string) =>
        FORBIDDEN_OPERATIONS.includes(name as never),
      ),
    ).toEqual([]);

    expect(run).toMatchObject({
      status: 'succeeded',
      outcome: 'confirmation_required',
      proposal: { operation: 'create_change_proposal', status: 'ready' },
    });
    expect(run.answer).toContain('2 cambios en 2 filas');
    // La respuesta queda en la conversación como mensaje del asistente.
    const { body: history } = await client()
      .rest()
      .get(`${base()}/conversations/${conversationId}/messages`)
      .expect(200);
    expect(history.items.map((m: { role: string }) => m.role)).toEqual([
      'user',
      'assistant',
    ]);

    // Nada cambió todavía: ni hoja ni borradores.
    const { body: drafts } = await client()
      .rest()
      .get(`${base()}/worksheets/${worksheetId}/changesets`)
      .expect(200);
    expect(drafts.changesets).toEqual([]);

    const confirmPath = `${base()}/ai-runs/${run.id}/proposals/${run.proposal.id}/confirm`;
    const stale = await client()
      .rest()
      .post(confirmPath)
      .send({ proposalHash: 'a'.repeat(64) })
      .expect(409);
    expect(stale.body.code).toBe('AGENT_PROPOSAL_STALE');

    const { body: confirmed } = await client()
      .rest()
      .post(confirmPath)
      .send({ proposalHash: run.proposal.hash })
      .expect(200);
    expect(confirmed.proposal).toMatchObject({ status: 'confirmed' });
    const changesetId = confirmed.proposal.result.changesetId;
    const { body: draft } = await client()
      .rest()
      .get(`${base()}/changesets/${changesetId}`)
      .expect(200);
    expect(draft.changeset).toMatchObject({ source: 'ai', status: 'draft' });
    expect(draft.changeset.operations).toEqual([
      {
        type: 'set_cell',
        rowId: ROW_IDS.a,
        columnId: col.price,
        value: '11.03',
      },
      {
        type: 'set_cell',
        rowId: ROW_IDS.b,
        columnId: col.price,
        value: '12.60',
      },
    ]);
    // La hoja sigue igual hasta que la persona aplique el borrador.
    const after = await client()
      .rest()
      .post(`${base()}/worksheets/${worksheetId}/rows/query`)
      .send({})
      .expect(200);
    expect(after.body).toEqual(before.body);

    // Confirmar otra vez devuelve lo mismo; rechazar ya no se puede.
    const { body: again } = await client()
      .rest()
      .post(confirmPath)
      .send({ proposalHash: run.proposal.hash })
      .expect(200);
    expect(again.proposal.result).toEqual(confirmed.proposal.result);
    const late = await client()
      .rest()
      .post(`${base()}/ai-runs/${run.id}/proposals/${run.proposal.id}/reject`)
      .send({ proposalHash: run.proposal.hash })
      .expect(409);
    expect(late.body.code).toBe('AGENT_PROPOSAL_DECIDED');
  });

  it('la credencial solo vale durante su ejecución y la pasarela valida todo', async () => {
    const replies: Record<string, GatewayReply> = {};
    let credential = '';
    script = async (request, call) => {
      credential = request.credential;
      replies.wrongToken = await call(
        'get_sheet_schema',
        'execute',
        {},
        'x'.repeat(43),
      );
      replies.unknown = await call('borrar_todo', 'execute', {});
      replies.forbidden = await call('delete_project', 'prepare', {});
      replies.readAsPrepare = await call('get_sheet_schema', 'prepare', {});
      replies.writeAsExecute = await call('create_change_proposal', 'execute', {
        previewId: randomUUID(),
        explanation: 'x',
      });
      replies.badArgs = await call('query_rows', 'execute', { limit: 500 });
      replies.extraArgs = await call('get_sheet_schema', 'execute', {
        worksheetId,
        organizationId: randomUUID(),
      });
      replies.foreignSheet = await call('get_sheet_schema', 'execute', {
        worksheetId: randomUUID(),
      });
      replies.ok = await call('query_rows', 'execute', { limit: 2 });
      return {
        status: 200,
        body: { status: 'answered', answer: 'Listo.', calls: [] },
      };
    };

    const { run } = await runToEnd();

    expect(replies.wrongToken.status).toBe(401);
    expect(replies.wrongToken.body.code).toBe('AGENT_CREDENTIAL_INVALID');
    expect(replies.unknown.body.code).toBe('AGENT_OPERATION_NOT_FOUND');
    expect(replies.forbidden.body.code).toBe('AGENT_OPERATION_NOT_FOUND');
    expect(replies.readAsPrepare.body.code).toBe(
      'AGENT_OPERATION_MODE_INVALID',
    );
    expect(replies.writeAsExecute.body.code).toBe(
      'AGENT_OPERATION_MODE_INVALID',
    );
    expect(replies.badArgs.status).toBe(400);
    expect(replies.badArgs.body.code).toBe('VALIDATION_FAILED');
    expect(replies.extraArgs.body.issues).toEqual([
      expect.objectContaining({
        field: 'organizationId',
        code: 'FIELD_NOT_ALLOWED',
      }),
    ]);
    expect(replies.foreignSheet.status).toBe(404);
    expect(replies.ok.status).toBe(200);
    expect(replies.ok.body.items).toHaveLength(2);
    expect(run).toMatchObject({
      status: 'succeeded',
      outcome: 'answered',
      answer: 'Listo.',
    });

    // Terminada la ejecución, su credencial ya no sirve.
    const afterwards = await gateway(run.id, credential)(
      'get_sheet_schema',
      'execute',
      {},
    );
    expect(afterwards.status).toBe(401);
  });

  it('una propuesta por ejecución y un límite de llamadas', async () => {
    const replies: GatewayReply[] = [];
    script = async (_request, call) => {
      replies.push(
        await call('suggest_view', 'prepare', {
          name: 'Caros',
          query: { sort: [{ columnId: col.price, direction: 'desc' }] },
        }),
      );
      replies.push(
        await call('suggest_view', 'prepare', { name: 'Otra', query: {} }),
      );
      for (let index = 0; index < AGENT_RUN_LIMITS.calls - 1; index += 1) {
        replies.push(await call('get_sheet_schema', 'execute', {}));
      }
      return {
        status: 200,
        body: { status: 'confirmation_required', answer: '', calls: [] },
      };
    };

    const { run } = await runToEnd();

    expect(replies[0].status).toBe(200);
    expect(replies[1].body.code).toBe('AGENT_PROPOSAL_EXISTS');
    expect(
      replies
        .slice(2, AGENT_RUN_LIMITS.calls)
        .every((reply) => reply.status === 200),
    ).toBe(true);
    expect(replies[AGENT_RUN_LIMITS.calls].body.code).toBe(
      'AGENT_RUN_CALL_LIMIT',
    );
    expect(run.answer).toBe('No tengo nada más que añadir.');

    // Confirmar la vista la guarda como personal de Alice.
    const { body } = await client()
      .rest()
      .post(`${base()}/ai-runs/${run.id}/proposals/${run.proposal.id}/confirm`)
      .send({ proposalHash: run.proposal.hash })
      .expect(200);
    const { body: view } = await client()
      .rest()
      .get(`${base()}/saved-views/${body.proposal.result.savedViewId}`)
      .expect(200);
    expect(view.savedView).toMatchObject({
      name: 'Caros',
      visibility: 'personal',
    });
  });

  it('proponer una hoja nueva: se crea vacía solo al confirmar, y rechazar la descarta', async () => {
    script = async (_request, call) => {
      const prepared = await call('propose_sheet_layout', 'prepare', {
        name: 'Proveedores',
        columns: [
          { name: 'Código', type: 'text', required: true },
          { name: 'Plazo', type: 'integer' },
        ],
      });
      return {
        status: 200,
        body: {
          status: 'confirmation_required',
          answer: prepared.body.summary,
          calls: [],
        },
      };
    };
    const { run } = await runToEnd();
    expect(run.answer).toBe(
      'Crear la hoja vacía «Proveedores» con 2 columnas: Código, Plazo.',
    );
    const workbookId = run.context.workbookId;
    const sheets = async () =>
      (
        await client()
          .rest()
          .get(`${base()}/workbooks/${workbookId}/worksheets`)
          .expect(200)
      ).body.worksheets.map((sheet: { name: string }) => sheet.name);
    expect(await sheets()).toEqual(['Precios']);

    const { body } = await client()
      .rest()
      .post(`${base()}/ai-runs/${run.id}/proposals/${run.proposal.id}/confirm`)
      .send({ proposalHash: run.proposal.hash })
      .expect(200);
    expect(body.proposal.result).toMatchObject({ name: 'Proveedores' });
    expect((await sheets()).sort()).toEqual(['Precios', 'Proveedores']);

    // Otra ejecución que se rechaza no crea nada.
    const second = await runToEnd();
    const { body: rejected } = await client()
      .rest()
      .post(
        `${base()}/ai-runs/${second.run.id}/proposals/${second.run.proposal.id}/reject`,
      )
      .send({ proposalHash: second.run.proposal.hash })
      .expect(200);
    expect(rejected.proposal.status).toBe('rejected');
    const confirmLate = await client()
      .rest()
      .post(
        `${base()}/ai-runs/${second.run.id}/proposals/${second.run.proposal.id}/confirm`,
      )
      .send({ proposalHash: second.run.proposal.hash })
      .expect(409);
    expect(confirmLate.body.code).toBe('AGENT_PROPOSAL_DECIDED');
  });

  it('iniciar es idempotente por mensaje; una segunda activa, 409; lo ajeno, 404; un Viewer, 403', async () => {
    const { conversationId, messageId } = await conversationWithMessage();
    const path = `${base()}/conversations/${conversationId}/runs`;
    const { body: first } = await client()
      .rest()
      .post(path)
      .send({ messageId })
      .expect(202);
    const { body: same } = await client()
      .rest()
      .post(path)
      .send({ messageId })
      .expect(202);
    expect(same.run.id).toBe(first.run.id);
    const changed = await client()
      .rest()
      .post(path)
      .send({ messageId, context: { revisionId: randomUUID() } })
      .expect(409);
    expect(changed.body.code).toBe('AGENT_RUN_CONTEXT_CHANGED');

    const { body: second } = await client()
      .rest()
      .post(`${base()}/conversations/${conversationId}/messages`)
      .send({ clientMessageId: randomUUID(), content: 'Y otra cosa' })
      .expect(201);
    const busy = await client()
      .rest()
      .post(path)
      .send({ messageId: second.message.id })
      .expect(409);
    expect(busy.body.code).toBe('AGENT_RUN_ACTIVE');

    const unknownMessage = await client()
      .rest()
      .post(path)
      .send({ messageId: randomUUID() })
      .expect(404);
    expect(unknownMessage.body.code).toBe('AGENT_MESSAGE_NOT_FOUND');

    // Bob, de otra organización, no ve ni la conversación ni la ejecución.
    const foreign = await client()
      .rest('bob-session')
      .post(path)
      .send({ messageId });
    expect(foreign.status).toBe(404);
    const foreignRun = await client()
      .rest('bob-session')
      .get(`${base()}/ai-runs/${first.run.id}`);
    expect(foreignRun.status).toBe(404);

    // Como Viewer de la organización de Alice, tampoco puede iniciar.
    await setRole(pool, organizationId, bobId, 'viewer');
    const viewer = await client()
      .rest('bob-session')
      .post(path)
      .send({ messageId });
    expect(viewer.status).toBe(403);
    // Y como Editor, la conversación de Alice sigue siendo privada.
    await setRole(pool, organizationId, bobId, 'editor');
    const editor = await client()
      .rest('bob-session')
      .post(path)
      .send({ messageId });
    expect(editor.status).toBe(404);
    expect(editor.body.code).toBe('CONVERSATION_NOT_FOUND');
    const othersRun = await client()
      .rest('bob-session')
      .get(`${base()}/ai-runs/${first.run.id}`);
    expect(othersRun.status).toBe(404);
    expect(othersRun.body.code).toBe('AGENT_RUN_NOT_FOUND');

    // Una selección que no es de Alice (o no existe) no entra en el contexto.
    const { messageId: another, conversationId: otherConversation } =
      await conversationWithMessage('Otra conversación');
    const badSelection = await client()
      .rest()
      .post(`${base()}/conversations/${otherConversation}/runs`)
      .send({ messageId: another, context: { selectionId: randomUUID() } })
      .expect(404);
    expect(badSelection.body.code).toBe('AI_SHEET_SELECTION_NOT_FOUND');
    await app.get(AgentRunWorker).runUntilIdle();
  });

  it('si el agente falla, la ejecución queda fallida con su código', async () => {
    script = async () => ({ status: 500, body: { code: 'INTERNAL_ERROR' } });

    const { run } = await runToEnd();

    expect(run).toMatchObject({
      status: 'failed',
      outcome: null,
      error: { code: 'AGENT_RUN_FAILED' },
      proposal: null,
    });
  });

  it('GraphQL inicia, consulta y confirma con los mismos servicios', async () => {
    const { conversationId, messageId } = await conversationWithMessage();
    const { ok } = client();
    const scope = { organizationId, projectId };
    const { startAgentRun } = await ok(
      `mutation($organizationId: ID!, $projectId: ID!, $conversationId: ID!, $input: StartAgentRunInput!) {
        startAgentRun(organizationId: $organizationId, projectId: $projectId, conversationId: $conversationId, input: $input) { id status }
      }`,
      { ...scope, conversationId, input: { messageId } },
    );
    expect(startAgentRun.status).toBe('queued');
    await app.get(AgentRunWorker).runUntilIdle();
    const { agentRun } = await ok(
      `query($organizationId: ID!, $projectId: ID!, $id: ID!) {
        agentRun(organizationId: $organizationId, projectId: $projectId, id: $id) {
          status outcome answer context { worksheetId } proposal { id hash status operation }
        }
      }`,
      { ...scope, id: startAgentRun.id },
    );
    expect(agentRun).toMatchObject({
      status: 'succeeded',
      outcome: 'confirmation_required',
      context: { worksheetId },
      proposal: { status: 'ready', operation: 'create_change_proposal' },
    });
    const { confirmAgentProposal } = await ok(
      `mutation($organizationId: ID!, $projectId: ID!, $runId: ID!, $proposalId: ID!, $input: AgentProposalDecisionInput!) {
        confirmAgentProposal(organizationId: $organizationId, projectId: $projectId, runId: $runId, proposalId: $proposalId, input: $input) { status result }
      }`,
      {
        ...scope,
        runId: startAgentRun.id,
        proposalId: agentRun.proposal.id,
        input: { proposalHash: agentRun.proposal.hash },
      },
    );
    expect(confirmAgentProposal.status).toBe('confirmed');
    expect(confirmAgentProposal.result.changesetId).toEqual(expect.any(String));
  });

  it('E6.4: los hitos salen por SSE en orden, con el contrato de la web y sin datos de celdas', async () => {
    const { run, conversationId, messageId } = await runToEnd();

    const events = await eventsOf(run.id);

    expect(events.map((event) => event.id)).toEqual(
      events.map((_, index) => index + 1),
    );
    expect(events.map((event) => event.type)).toEqual([
      'run.queued',
      'run.started',
      'tool.started',
      'tool.completed',
      'tool.started',
      'tool.completed',
      'tool.started',
      'tool.completed',
      'tool.started',
      'proposal.ready',
      'tool.completed',
      'run.completed',
    ]);
    // Cada evento trae exactamente los campos del contrato (contracts/chat).
    for (const event of events) {
      expect(Object.keys(event.data).sort()).toEqual(
        [...EVENT_KEYS[event.type]].sort(),
      );
    }
    expect(events[0].data).toMatchObject({
      conversationId,
      userMessageId: messageId,
    });
    // `target` dice qué hoja y columnas toca la herramienta, para que la web
    // las resalte; nunca lleva valores de celdas ni correos.
    const select = events.find(
      (event) =>
        event.type === 'tool.started' && event.data.operation === 'select_rows',
    );
    expect(select?.data).toMatchObject({
      mode: 'execute',
      target: expect.objectContaining({ worksheetId }),
    });
    // Al terminar, la herramienta repite su `target` para quitar el resaltado.
    const selected = events.find(
      (event) =>
        event.type === 'tool.completed' &&
        event.data.callId === select?.data.callId,
    );
    expect(selected?.data).toMatchObject({
      status: 'succeeded',
      target: select?.data.target,
    });
    const proposal = events.find((event) => event.type === 'proposal.ready');
    expect(proposal?.data).toMatchObject({
      proposalId: run.proposal.id,
      hash: run.proposal.hash,
      operation: 'create_change_proposal',
    });
    expect(events.at(-1)?.data).toMatchObject({
      outcome: 'confirmation_required',
      answerMessageId: expect.any(String),
    });
    const raw = JSON.stringify(events);
    for (const secret of ['10.50', '9.99', '11.03', '12.60', '@']) {
      expect(raw).not.toContain(secret);
    }
  });

  it('E6.4: el SSE abierto en cola sigue la ejecución en vivo hasta que termina', async () => {
    const { conversationId, messageId } = await conversationWithMessage();
    const { body } = await client()
      .rest()
      .post(`${base()}/conversations/${conversationId}/runs`)
      .send({ messageId })
      .expect(202);

    const streaming = eventsOf(body.run.id);
    // Deja que el flujo lea `run.queued` y quede esperando antes de trabajar.
    await new Promise((resolve) => setTimeout(resolve, 400));
    await app.get(AgentRunWorker).runUntilIdle();
    const events = await streaming;

    expect(events[0].type).toBe('run.queued');
    expect(events.at(-1)?.type).toBe('run.completed');
    expect(events).toHaveLength(12);
  });

  it('E6.4: el SSE se reanuda desde `after` o `Last-Event-ID`, y lo ajeno es 404', async () => {
    const { run } = await runToEnd();
    const all = await eventsOf(run.id);

    const fromQuery = await eventsOf(run.id, '?after=3');
    const fromHeader = await eventsOf(run.id, '', { 'Last-Event-ID': '3' });

    expect(fromQuery).toEqual(all.slice(3));
    expect(fromHeader).toEqual(all.slice(3));
    // Una cabecera rota vale como empezar desde el principio.
    expect(await eventsOf(run.id, '', { 'Last-Event-ID': 'x' })).toEqual(all);
    const invalid = await client()
      .rest()
      .get(`${base()}/ai-runs/${run.id}/events?after=-1`);
    expect(invalid.status).toBe(400);
    // Bob, Editor de la misma organización, no ve la ejecución de Alice.
    await setRole(pool, organizationId, bobId, 'editor');
    const foreign = await client()
      .rest('bob-session')
      .get(`${base()}/ai-runs/${run.id}/events`);
    expect(foreign.status).toBe(404);
    expect(foreign.body.code).toBe('AGENT_RUN_NOT_FOUND');
  });

  it('E6.4: cancelar en cola no llega al agente; en curso, la credencial muere y lo preparado no se publica', async () => {
    const worker = app.get(AgentRunWorker);
    const { rest } = client();
    const queued = await conversationWithMessage();
    const { body: started } = await rest()
      .post(`${base()}/conversations/${queued.conversationId}/runs`)
      .send({ messageId: queued.messageId })
      .expect(202);
    const cancelPath = `${base()}/ai-runs/${started.run.id}/cancel`;

    const { body: cancelled } = await rest().post(cancelPath).expect(200);
    await rest().post(cancelPath).expect(200);
    await worker.runUntilIdle();

    expect(cancelled.run.status).toBe('cancelled');
    expect(received).toHaveLength(0);
    expect((await eventsOf(started.run.id)).map((e) => e.type)).toEqual([
      'run.queued',
      'run.cancelled',
    ]);
    const foreign = await client().rest('bob-session').post(cancelPath);
    expect(foreign.status).toBe(404);

    // En curso: el agente prepara una propuesta y la persona cancela.
    let afterCancel: GatewayReply | undefined;
    let finish!: () => void;
    const scriptDone = new Promise<void>((resolve) => (finish = resolve));
    script = async (request, call) => {
      try {
        await fivePercentScript(request, call);
        await client()
          .rest()
          .post(`${base()}/ai-runs/${request.runId}/cancel`)
          .expect(200);
        afterCancel = await call('get_sheet_schema', 'execute', {});
        return {
          status: 200,
          body: {
            status: 'answered',
            answer: 'tarde',
            calls: [],
            confirmation: null,
          },
        };
      } finally {
        finish();
      }
    };
    const { run, conversationId } = await runToEnd();
    await scriptDone;

    expect(afterCancel?.status).toBe(401);
    expect(run.status).toBe('cancelled');
    expect(run.proposal).toMatchObject({ status: 'ready' });
    const confirm = await rest()
      .post(`${base()}/ai-runs/${run.id}/proposals/${run.proposal.id}/confirm`)
      .send({ proposalHash: run.proposal.hash });
    expect(confirm.status).toBe(409);
    expect(confirm.body.code).toBe('AGENT_PROPOSAL_EXPIRED');
    const { body: history } = await rest()
      .get(`${base()}/conversations/${conversationId}/messages`)
      .expect(200);
    expect(
      history.items.map((message: { role: string }) => message.role),
    ).toEqual(['user']);
    const types = (await eventsOf(run.id)).map((e) => e.type);
    expect(types.at(-1)).toBe('run.cancelled');
    expect(types).not.toContain('run.completed');

    // Una ejecución ya terminada no se cancela.
    script = fivePercentScript;
    const { run: done } = await runToEnd();
    const late = await rest().post(`${base()}/ai-runs/${done.id}/cancel`);
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('AGENT_RUN_FINISHED');
  });

  it('E6.4: una ejecución que nadie atiende a tiempo vence y la web lo ve como un fallo', async () => {
    const { conversationId, messageId } = await conversationWithMessage();
    const { body } = await client()
      .rest()
      .post(`${base()}/conversations/${conversationId}/runs`)
      .send({ messageId })
      .expect(202);

    clockAheadMs = 11 * 60_000;
    await app.get(AgentRunWorker).runUntilIdle();

    const { body: found } = await client()
      .rest()
      .get(`${base()}/ai-runs/${body.run.id}`)
      .expect(200);
    expect(found.run.status).toBe('expired');
    expect(received).toHaveLength(0);
    const events = await eventsOf(body.run.id);
    expect(events.map((event) => event.type)).toEqual([
      'run.queued',
      'run.failed',
    ]);
    expect(events[1].data).toMatchObject({
      status: 'expired',
      code: 'AGENT_RUN_FAILED',
    });
  });

  it('E6.4: la cuota limita las ejecuciones activas y las del día (429)', async () => {
    quota = { activeRuns: 1, dailyRuns: 2 };
    const { rest } = client();
    const start = (conversation: {
      conversationId: string;
      messageId: string;
    }) =>
      rest()
        .post(`${base()}/conversations/${conversation.conversationId}/runs`)
        .send({ messageId: conversation.messageId });
    const first = await conversationWithMessage();
    const second = await conversationWithMessage();
    const third = await conversationWithMessage();

    expect((await start(first)).status).toBe(202);
    const busy = await start(second);
    expect(busy.status).toBe(429);
    expect(busy.body.code).toBe('AGENT_QUOTA_EXCEEDED');
    // Repetir el mismo mensaje no gasta cuota: devuelve la misma ejecución.
    expect((await start(first)).status).toBe(202);
    await app.get(AgentRunWorker).runUntilIdle();
    expect((await start(second)).status).toBe(202);
    await app.get(AgentRunWorker).runUntilIdle();
    const daily = await start(third);
    expect(daily.status).toBe(429);
    expect(daily.body.code).toBe('AGENT_QUOTA_EXCEEDED');
  });

  it('con AI_AUTO_CONFIRM, el chat encadena escrituras y las aplica', async () => {
    const gateway = app.get(AgentGatewayService) as unknown as {
      autoConfirm: boolean;
    };
    gateway.autoConfirm = true;
    try {
      const replies: GatewayReply[] = [];
      script = async (_request, call) => {
        const schema = await call('get_sheet_schema', 'execute', {});
        const price = schema.body.columns.find(
          (column: { name: string }) => column.name === 'Precio',
        ).id;
        const draft = await call('prepare_sheet_edits', 'prepare', {
          explanation: 'Subir A',
          operations: [
            {
              type: 'set_cell',
              rowId: ROW_IDS.a,
              columnId: price,
              value: '11.00',
            },
          ],
        });
        replies.push(draft);
        replies.push(
          await call('apply_changeset', 'prepare', {
            changesetId: draft.body.result.changesetId,
          }),
        );
        return {
          status: 200,
          body: { status: 'answered', answer: 'Aplicado.', calls: [] },
        };
      };
      const { run } = await runToEnd();
      expect(replies.map(({ status }) => status)).toEqual([200, 200]);
      expect(replies[0].body).toMatchObject({ status: 'confirmed' });
      expect(replies[1].body).toMatchObject({
        status: 'confirmed',
        result: { sequence: 3 },
      });
      expect(run.status).toBe('succeeded');
      expect(run.proposal).toBeNull();
    } finally {
      gateway.autoConfirm = false;
    }
  });
});

describe('E6.3a sin agente configurado', () => {
  let app: INestApplication;
  let pool: Pool;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ app, pool, close } = await startGraphqlApp());
  });
  afterAll(async () => {
    await close?.();
  });

  it('iniciar una ejecución responde 503 y la conversación sigue funcionando', async () => {
    const { organizationId, projectId } = await seedTwoOrganizations(app, pool);
    const { rest } = clientsFor(app);
    const base = `/api/v1/organizations/${organizationId}/projects/${projectId}`;
    const { body: workbook } = await rest()
      .post(`${base}/workbooks`)
      .send({ name: 'Libro' })
      .expect(201);
    const { body: conversation } = await rest()
      .post(`${base}/workbooks/${workbook.workbook.id}/conversations`)
      .send({ title: 'Ideas' })
      .expect(201);
    const { body: posted } = await rest()
      .post(`${base}/conversations/${conversation.conversation.id}/messages`)
      .send({ clientMessageId: randomUUID(), content: 'Hola' })
      .expect(201);

    const response = await rest()
      .post(`${base}/conversations/${conversation.conversation.id}/runs`)
      .send({ messageId: posted.message.id })
      .expect(503);

    expect(response.body.code).toBe('AGENT_UNAVAILABLE');
  });
});
