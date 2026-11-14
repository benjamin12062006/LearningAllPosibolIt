import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { AuthenticatedIdentity } from '../../../src/auth/authenticated-request.js';
import { DescopeService } from '../../../src/auth/descope.service.js';
import { publicError } from '../../../src/common/http/public-error.js';
import { configureHttp } from '../../../src/configure-http.js';
import { ConversationsModule } from '../../../src/conversations/conversations.module.js';
import { POSTGRESQL_CONNECTION } from '../../../src/database/postgresql.connection.js';
import type { OrganizationRole } from '../../../src/organizations/organization-roles.js';
import { OrganizationsModule } from '../../../src/organizations/organizations.module.js';
import { WorksheetsModule } from '../../../src/worksheets/worksheets.module.js';
import { UsersService } from '../../../src/users/users.service.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';

const carol: AuthenticatedIdentity = {
  ...alice,
  subject: 'carol',
  email: 'carol@example.test',
};
type Session = 'alice-session' | 'bob-session' | 'carol-session';
const SESSIONS = new Map<string, AuthenticatedIdentity>([
  ['alice-session', alice],
  ['bob-session', bob],
  ['carol-session', carol],
]);
type Scope = {
  organizationId: string;
  projectId: string;
  workbookId: string;
  worksheetId: string;
};
type Conversation = { id: string; createdBy: string; createdAt: string };
type Message = {
  id: string;
  sequence: number;
  content: string;
  createdAt: string;
};
const CREATED_AT = '2026-11-14T14:00:00.000Z';

describe('Conversaciones privadas y mensajes por HTTP (E6.2)', () => {
  let app: INestApplication;
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let aliceId: string;
  let bobId: string;
  let carolId: string;
  let scope: Scope;
  let foreignScope: Scope;
  const validateSession = jest.fn<DescopeService['validateSession']>();
  const pool = () => database.connection.pool;

  beforeAll(async () => {
    database = await createTestDatabase();
    const module = await Test.createTestingModule({
      imports: [ConversationsModule, OrganizationsModule, WorksheetsModule],
    })
      .overrideProvider(POSTGRESQL_CONNECTION)
      .useValue(database.connection)
      .overrideProvider(DescopeService)
      .useValue({ validateSession })
      .compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
  });

  beforeEach(async () => {
    validateSession.mockReset().mockImplementation(async (token) => {
      const identity = SESSIONS.get(token);
      if (!identity) throw new Error('Sesión de prueba inválida.');
      return {
        jwt: token,
        token: {
          sub: identity.subject,
          iss: identity.issuer,
          email: identity.email,
        },
      };
    });
    await pool().query('TRUNCATE estadistica_forms.app_users CASCADE');
    const users = app.get(UsersService);
    aliceId = (await users.provision(alice)).id;
    bobId = (await users.provision(bob)).id;
    carolId = (await users.provision(carol)).id;
    scope = await createScope('alice-session', aliceId);
    foreignScope = await createScope('carol-session', carolId);
    await setBobRole('editor');
  });

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await database?.close();
    }
  });

  it('crea conversaciones privadas desde libro y hoja, con el ámbito resuelto por Nest', async () => {
    const book = await createConversation(
      '  Diseño del catálogo  ',
      'alice-session',
      'workbook',
    );
    const sheet = await createConversation('Revisar precios', 'bob-session');

    expect(book).toMatchObject({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      workbookId: scope.workbookId,
      worksheetId: null,
      createdBy: aliceId,
      title: 'Diseño del catálogo',
      visibility: 'private',
      status: 'active',
    });
    expect(sheet).toMatchObject({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      workbookId: scope.workbookId,
      worksheetId: scope.worksheetId,
      createdBy: bobId,
      title: 'Revisar precios',
      visibility: 'private',
      status: 'active',
    });
    await send('get', conversationPath(book.id)).expect(200, {
      conversation: book,
    });
    await send('get', conversationPath(sheet.id), 'bob-session').expect(200, {
      conversation: sheet,
    });
    await send('get', conversationsPath(), 'bob-session').expect(200, {
      items: [sheet],
      nextCursor: null,
    });
  });

  it('una conversación privada devuelve 404 incluso a otro autor del mismo equipo con más permisos', async () => {
    const mine = await createConversation(
      'Datos privados de Bob',
      'bob-session',
    );
    await append(mine.id, 'Contenido privado de Bob', 'bob-session').expect(
      201,
    );
    const foreign = await createConversation(
      'Datos de Carol',
      'carol-session',
      'worksheet',
      foreignScope,
    );

    for (const [id, project, session] of [
      [mine.id, scope, 'alice-session'],
      [mine.id, scope, 'carol-session'],
      [foreign.id, scope, 'alice-session'],
      [foreign.id, foreignScope, 'bob-session'],
    ] as const) {
      await send('get', conversationPath(id, project), session)
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('CONVERSATION_NOT_FOUND')),
        );
      await send('get', messagesPath(id, project), session)
        .query({ cursor: 'malformed' })
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('CONVERSATION_NOT_FOUND')),
        );
      await append(id, 'Una escritura ajena', session, undefined, project)
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('CONVERSATION_NOT_FOUND')),
        );
    }
    await send('get', conversationsPath()).expect(200, {
      items: [],
      nextCursor: null,
    });
    await send('get', conversationsPath(foreignScope)).expect(404);
    await send(
      'post',
      `${base()}/worksheets/${foreignScope.worksheetId}/conversations`,
    )
      .send({ title: 'Ajena' })
      .expect(404);
    await send(
      'post',
      `${base()}/workbooks/${foreignScope.workbookId}/conversations`,
    )
      .send({ title: 'Ajeno' })
      .expect(404);
    await send('get', messagesPath(mine.id), 'bob-session')
      .expect(200)
      .expect(({ body }) =>
        expect(body.items.map(({ content }: Message) => content)).toEqual([
          'Contenido privado de Bob',
        ]),
      );
  });

  it('consulta el rol en cada petición y revoca incluso un reintento conocido', async () => {
    const mine = await createConversation(
      'Conversación propia de Bob',
      'bob-session',
    );
    const key = randomUUID();
    await append(
      mine.id,
      'Mensaje escrito como editor',
      'bob-session',
      key,
    ).expect(201);
    await setBobRole('viewer');

    await send('get', conversationPath(mine.id), 'bob-session').expect(200);
    await send('get', messagesPath(mine.id), 'bob-session').expect(200);
    await send('get', conversationsPath(), 'bob-session')
      .expect(200)
      .expect(({ body }) => {
        expect(body.items.map(({ id }: Conversation) => id)).toEqual([mine.id]);
        expect(body.nextCursor).toBeNull();
      });
    await send(
      'post',
      `${base()}/worksheets/${foreignScope.worksheetId}/conversations`,
      'bob-session',
    )
      .send({ title: 'Hoja de otro ámbito' })
      .expect(404)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('WORKSHEET_NOT_FOUND')),
      );
    await send(
      'post',
      `${base()}/workbooks/${scope.workbookId}/conversations`,
      'bob-session',
    )
      .send({ title: 'Un intento de Viewer' })
      .expect(403)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('FORBIDDEN')),
      );
    await append(mine.id, 'Mensaje escrito como editor', 'bob-session', key)
      .expect(403)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('FORBIDDEN')),
      );

    await setBobRole('manager');
    await createConversation(
      'Un Manager inicia otra conversación',
      'bob-session',
    );
    await append(mine.id, 'Mensaje escrito como manager', 'bob-session')
      .expect(201)
      .expect(({ body }) => expect(body.message.sequence).toBe(2));
    await pool().query(
      'DELETE FROM estadistica_forms.organization_members WHERE organization_id = $1 AND user_id = $2',
      [scope.organizationId, bobId],
    );
    await send('get', conversationPath(mine.id), 'bob-session').expect(404);
    await send('get', messagesPath(mine.id), 'bob-session').expect(404);
    await append(
      mine.id,
      'Mensaje escrito como editor',
      'bob-session',
      key,
    ).expect(404);
  });

  it('conserva la lectura cuando se archivan hoja, libro u organización y bloquea nuevas escrituras', async () => {
    const sheet = await createConversation('Una conversación de hoja');
    const book = await createConversation(
      'Una conversación de libro',
      'alice-session',
      'workbook',
    );
    const key = randomUUID();
    await append(
      sheet.id,
      'Mensaje anterior al archivo',
      'alice-session',
      key,
    ).expect(201);

    await send(
      'post',
      `${base()}/worksheets/${scope.worksheetId}/archive`,
    ).expect(200);
    await assertArchived(sheet.id, 'WORKSHEET_ARCHIVED', key);
    await send(
      'post',
      `${base()}/worksheets/${scope.worksheetId}/conversations`,
    )
      .send({ title: 'Hoja archivada' })
      .expect(409);
    await append(book.id, 'El libro todavía está activo').expect(201);
    await send(
      'post',
      `${base()}/worksheets/${scope.worksheetId}/restore`,
    ).expect(200);

    await send(
      'post',
      `${base()}/workbooks/${scope.workbookId}/archive`,
    ).expect(200);
    await assertArchived(book.id, 'WORKBOOK_ARCHIVED');
    await send('get', messagesPath(sheet.id)).expect(200);
    await append(sheet.id, 'El libro archivado bloquea la hoja').expect(409);
    await send(
      'post',
      `${base()}/workbooks/${scope.workbookId}/restore`,
    ).expect(200);

    await send(
      'post',
      `/api/v1/organizations/${scope.organizationId}/archive`,
    ).expect(200);
    await assertArchived(sheet.id, 'ORGANIZATION_ARCHIVED', key);
    await send('get', conversationPath(sheet.id), 'bob-session').expect(404);
    await append(
      sheet.id,
      'No filtra el motivo de archivo',
      'bob-session',
    ).expect(404);
    await send(
      'post',
      `/api/v1/organizations/${scope.organizationId}/restore`,
    ).expect(200);
    await append(sheet.id, 'Edición restaurada').expect(201);
  });

  it('dos envíos concurrentes normalizados con la misma clave conservan todo el mensaje original', async () => {
    const mine = await createConversation('Reintentos');
    const clientMessageId = randomUUID();
    const [first, repeated] = await Promise.all([
      append(
        mine.id,
        '  primera línea\r\nsegunda\t<strong>texto</strong>  ',
        'alice-session',
        clientMessageId,
      ).expect(201),
      append(
        mine.id,
        'primera línea\nsegunda\t<strong>texto</strong>',
        'alice-session',
        clientMessageId,
      ).expect(201),
    ]);
    expect(first.body.message).toEqual(repeated.body.message);
    expect(first.body.message).toMatchObject({
      conversationId: mine.id,
      clientMessageId,
      authorId: aliceId,
      role: 'user',
      sequence: 1,
      content: 'primera línea\nsegunda\t<strong>texto</strong>',
      createdAt: expect.any(String),
    });
    await append(
      mine.id,
      'Contenido distinto',
      'alice-session',
      clientMessageId,
    )
      .expect(422)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('IDEMPOTENCY_KEY_REUSED')),
      );

    const [next, last] = await Promise.all([
      append(mine.id, 'Segundo ID').expect(201),
      append(mine.id, 'Tercer ID').expect(201),
    ]);
    expect(
      [next.body.message.sequence, last.body.message.sequence].sort(),
    ).toEqual([2, 3]);
    await send('get', messagesPath(mine.id))
      .expect(200)
      .expect(({ body }) => {
        expect(body.items.map(({ sequence }: Message) => sequence)).toEqual([
          1, 2, 3,
        ]);
        expect(body.items[0]).toEqual(first.body.message);
      });
    const otherConversation = await createConversation('Otra conversación');
    await append(
      otherConversation.id,
      'La misma clave tiene otro ámbito',
      'alice-session',
      clientMessageId,
    )
      .expect(201)
      .expect(({ body }) => expect(body.message.sequence).toBe(1));
  });

  it('usa el cursor de conversaciones para ordenar empates y lo liga al autor, al filtro y al proyecto', async () => {
    const first = await createConversation('Primera');
    const second = await createConversation('Segunda');
    const book = await createConversation(
      'De libro',
      'alice-session',
      'workbook',
    );
    await pool().query(
      'UPDATE estadistica_forms.ai_conversations SET created_at = $1 WHERE project_id = $2',
      [CREATED_AT, scope.projectId],
    );
    const ordered = [first.id, second.id].sort().reverse();
    const { body: page } = await send('get', conversationsPath())
      .query({ worksheetId: scope.worksheetId, limit: 1 })
      .expect(200);
    expect(page.items.map(({ id }: Conversation) => id)).toEqual(
      ordered.slice(0, 1),
    );
    expect(page.nextCursor).toEqual(expect.any(String));
    await send('get', conversationsPath())
      .query({
        worksheetId: scope.worksheetId,
        limit: 1,
        cursor: page.nextCursor,
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.items.map(({ id }: Conversation) => id)).toEqual(
          ordered.slice(1),
        );
        expect(body.nextCursor).toBeNull();
      });
    await send('get', conversationsPath())
      .query({ workbookId: scope.workbookId })
      .expect(200)
      .expect(({ body }) =>
        expect(body.items.map(({ id }: Conversation) => id).sort()).toEqual(
          [book.id, ...ordered].sort(),
        ),
      );
    await send('get', conversationsPath())
      .query({ workbookId: scope.workbookId, cursor: page.nextCursor })
      .expect(400)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('CONVERSATION_CURSOR_INVALID')),
      );
    await send('get', conversationsPath(), 'bob-session')
      .query({ worksheetId: scope.worksheetId, cursor: page.nextCursor })
      .expect(400)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('CONVERSATION_CURSOR_INVALID')),
      );
    const otherProject = await insertProject(scope.organizationId, aliceId);
    await send('get', conversationsPath({ ...scope, projectId: otherProject }))
      .query({ cursor: page.nextCursor })
      .expect(400);
  });

  it('pagina los mensajes de atrás hacia delante con orden cronológico dentro de cada página', async () => {
    const mine = await createConversation('Historial');
    const other = await createConversation('Historial distinto');
    for (const text of ['uno', 'dos', 'tres', 'cuatro', 'cinco'])
      await append(mine.id, text).expect(201);
    const { body: page } = await send('get', messagesPath(mine.id))
      .query({ limit: 2 })
      .expect(200);
    expect(page.items.map(({ sequence }: Message) => sequence)).toEqual([4, 5]);
    expect(page.nextCursor).toEqual(expect.any(String));
    await append(mine.id, 'seis, después del cursor').expect(201);
    const { body: older } = await send('get', messagesPath(mine.id))
      .query({ limit: 2, cursor: page.nextCursor })
      .expect(200);
    expect(older.items.map(({ sequence }: Message) => sequence)).toEqual([
      2, 3,
    ]);
    const { body: oldest } = await send('get', messagesPath(mine.id))
      .query({ limit: 2, cursor: older.nextCursor })
      .expect(200);
    expect(oldest.items.map(({ sequence }: Message) => sequence)).toEqual([1]);
    expect(oldest.nextCursor).toBeNull();
    await send('get', messagesPath(other.id))
      .query({ cursor: page.nextCursor })
      .expect(400)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('CONVERSATION_CURSOR_INVALID')),
      );
    await send('get', messagesPath(mine.id))
      .query({ cursor: 'malformed' })
      .expect(400)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('CONVERSATION_CURSOR_INVALID')),
      );
  });

  it('rechaza UUID, sesiones y campos que intentarían fijar autor, rol o visibilidad', async () => {
    const mine = await createConversation('Validación de contrato');
    const paths = [
      conversationsPath(),
      conversationPath(mine.id),
      messagesPath(mine.id),
    ];
    for (const path of paths)
      await request(app.getHttpServer()).get(path).expect(401);
    await request(app.getHttpServer())
      .post(messagesPath(mine.id))
      .send({ content: 'Sin sesión' })
      .expect(401);
    await request(app.getHttpServer())
      .post(`${base()}/worksheets/${scope.worksheetId}/conversations`)
      .send({ title: 'Sin sesión' })
      .expect(401);
    await send('get', conversationPath('invalid')).expect(400);
    await send('get', conversationsPath()).query({ limit: 101 }).expect(400);
    await send('get', messagesPath(mine.id)).query({ limit: 0 }).expect(400);
    for (const fields of [
      { title: ' ' },
      { title: 'x'.repeat(201) },
      { title: 'Con\ncontrol' },
      { title: 'Privada', visibility: 'team' },
    ]) {
      await send(
        'post',
        `${base()}/workbooks/${scope.workbookId}/conversations`,
      )
        .send(fields)
        .expect(400);
    }
    for (const fields of [
      { clientMessageId: 'invalid', content: 'Texto válido' },
      { content: '  ' },
      { content: 'x'.repeat(16_001) },
      { content: 'control\u0001' },
      { content: 'Rol ajeno', role: 'assistant' },
      { content: 'Autor ajeno', authorId: bobId },
      { content: 'Otra secuencia', sequence: 15 },
    ]) {
      await send('post', messagesPath(mine.id))
        .send({ clientMessageId: randomUUID(), ...fields })
        .expect(400);
    }
    await send('get', messagesPath(mine.id)).expect(200, {
      items: [],
      nextCursor: null,
    });
  });

  it('aplica límites y pertenencia a libro y hoja también en SQL', async () => {
    const mine = await createConversation('Restricciones de almacenamiento');
    await expect(
      insertConversation(
        { ...scope, workbookId: foreignScope.workbookId },
        mine.createdBy,
      ),
    ).rejects.toMatchObject({ code: '23503' });
    const sameProjectWorkbook = await createWorkbook(scope, 'alice-session');
    await expect(
      insertConversation(
        { ...scope, workbookId: sameProjectWorkbook },
        mine.createdBy,
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      insertConversation(
        { ...scope, worksheetId: foreignScope.worksheetId },
        mine.createdBy,
      ),
    ).rejects.toMatchObject({ code: '23503' });
    const clientMessageId = randomUUID();
    await expect(
      insertMessage(mine.id, aliceId, clientMessageId, 0),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      insertMessage(mine.id, null, clientMessageId, 1),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      insertMessage(mine.id, aliceId, null, 1),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      insertMessage(mine.id, aliceId, clientMessageId, 1, 'assistant'),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      insertMessage(randomUUID(), aliceId, clientMessageId, 1),
    ).rejects.toMatchObject({ code: '23503' });
    await insertMessage(mine.id, aliceId, clientMessageId, 1);
    await expect(
      insertMessage(mine.id, aliceId, randomUUID(), 1),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      insertMessage(mine.id, aliceId, clientMessageId, 2),
    ).rejects.toMatchObject({ code: '23505' });
    const { rows } = await pool().query<{ sequence: number }>(
      'SELECT sequence FROM estadistica_forms.ai_messages WHERE conversation_id = $1',
      [mine.id],
    );
    expect(rows).toEqual([{ sequence: 1 }]);
  });

  function base(project: Pick<Scope, 'organizationId' | 'projectId'> = scope) {
    return `/api/v1/organizations/${project.organizationId}/projects/${project.projectId}`;
  }

  function conversationsPath(project = scope) {
    return `${base(project)}/conversations`;
  }
  function conversationPath(id: string, project = scope) {
    return `${conversationsPath(project)}/${id}`;
  }
  function messagesPath(id: string, project = scope) {
    return `${conversationPath(id, project)}/messages`;
  }

  function send(
    method: 'get' | 'post',
    path: string,
    session: Session = 'alice-session',
  ) {
    return request(app.getHttpServer())
      [method](path)
      .auth(session, { type: 'bearer' });
  }

  async function createConversation(
    title: string,
    session: Session = 'alice-session',
    target: 'worksheet' | 'workbook' = 'worksheet',
    project = scope,
  ) {
    const segment =
      target === 'worksheet'
        ? `worksheets/${project.worksheetId}`
        : `workbooks/${project.workbookId}`;
    const { body } = await send(
      'post',
      `${base(project)}/${segment}/conversations`,
      session,
    )
      .send({ title })
      .expect(201);
    return body.conversation as Conversation;
  }

  function append(
    id: string,
    content: string,
    session: Session = 'alice-session',
    clientMessageId: string = randomUUID(),
    project = scope,
  ) {
    return send('post', messagesPath(id, project), session).send({
      content,
      clientMessageId,
    });
  }

  async function assertArchived(
    id: string,
    code: 'ORGANIZATION_ARCHIVED' | 'WORKBOOK_ARCHIVED' | 'WORKSHEET_ARCHIVED',
    key?: string,
  ) {
    await send('get', conversationPath(id)).expect(200);
    await send('get', messagesPath(id)).expect(200);
    await append(id, 'Mensaje anterior al archivo', 'alice-session', key)
      .expect(409)
      .expect(({ body }) => expect(body).toMatchObject(publicError(code)));
  }

  async function createScope(
    session: Session,
    ownerId: string,
  ): Promise<Scope> {
    const { body } = await send('post', '/api/v1/organizations', session)
      .send({ name: `Equipo ${session}` })
      .expect(201);
    const organizationId = body.organization.id as string;
    const projectId = await insertProject(organizationId, ownerId);
    const project = { organizationId, projectId };
    const workbookId = await createWorkbook(project, session);
    const { body: sheet } = await send(
      'post',
      `${base(project)}/workbooks/${workbookId}/worksheets`,
      session,
    )
      .send({ name: 'Productos', columns: [{ name: 'SKU', type: 'text' }] })
      .expect(201);
    return { ...project, workbookId, worksheetId: sheet.worksheet.id };
  }

  async function createWorkbook(
    project: Pick<Scope, 'organizationId' | 'projectId'>,
    session: Session,
  ) {
    const { body } = await send('post', `${base(project)}/workbooks`, session)
      .send({ name: `Libro ${randomUUID()}` })
      .expect(201);
    return body.workbook.id as string;
  }

  async function insertProject(organizationId: string, ownerId: string) {
    const projectId = randomUUID();
    await pool().query(
      `INSERT INTO estadistica_forms.projects
         (id, organization_id, owner_id, name, created_at, country, currency, channel_profile)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        projectId,
        organizationId,
        ownerId,
        projectInput.name,
        CREATED_AT,
        projectInput.country,
        projectInput.currency,
        projectInput.channelProfile,
      ],
    );
    return projectId;
  }

  async function setBobRole(role: OrganizationRole) {
    await pool().query(
      `INSERT INTO estadistica_forms.organization_members (organization_id, user_id, role, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [scope.organizationId, bobId, role, CREATED_AT],
    );
  }

  function insertConversation(project: Scope, createdBy: string) {
    return pool().query(
      `INSERT INTO estadistica_forms.ai_conversations
         (id, organization_id, project_id, workbook_id, worksheet_id, created_by, title, visibility, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'Prueba de restricciones', 'private', 'active', $7, $7)`,
      [
        randomUUID(),
        project.organizationId,
        project.projectId,
        project.workbookId,
        project.worksheetId,
        createdBy,
        CREATED_AT,
      ],
    );
  }

  function insertMessage(
    conversationId: string,
    authorId: string | null,
    clientMessageId: string | null,
    sequence: number,
    role = 'user',
  ) {
    return pool().query(
      `INSERT INTO estadistica_forms.ai_messages
         (id, conversation_id, author_id, client_message_id, role, sequence, content, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'Prueba de restricciones', $7)`,
      [
        randomUUID(),
        conversationId,
        authorId,
        clientMessageId,
        role,
        sequence,
        CREATED_AT,
      ],
    );
  }
});
