import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import {
  clientsFor,
  seedTwoOrganizations,
  setRole,
  startGraphqlApp,
} from './support/graphql-test-app.js';

const CREATE = `
  mutation ($org: ID!, $project: ID!, $sheet: ID!, $title: String!) {
    createWorksheetConversation(organizationId: $org, projectId: $project,
      worksheetId: $sheet, input: {title: $title}) {
      id title worksheetId updatedAt
    }
  }`;
const MESSAGE = `
  mutation ($org: ID!, $project: ID!, $conversation: ID!, $client: ID!, $content: String!) {
    appendConversationMessage(organizationId: $org, projectId: $project,
      conversationId: $conversation, input: {clientMessageId: $client, content: $content}) {
      id sequence content clientMessageId
    }
  }`;
const DETAILS = `
  query ($org: ID!, $project: ID!, $conversation: ID!) {
    conversation(organizationId: $org, projectId: $project, id: $conversation) {
      id visibility messages(limit: 4) { items { id content sequence } nextCursor }
    }
    project(id: $project) {
      conversations(limit: 4) { items { id title } nextCursor }
    }
  }`;

describe('Conversaciones GraphQL', () => {
  let setup: Awaited<ReturnType<typeof startGraphqlApp>>;

  beforeAll(async () => {
    setup = await startGraphqlApp();
  });

  afterAll(async () => {
    await setup?.close();
  });

  it('usa la misma conversación privada y el mismo mensaje idempotente por GraphQL y REST', async () => {
    const { app, pool } = setup;
    const {
      organizationId: org,
      projectId: project,
      bobId,
    } = await seedTwoOrganizations(app, pool);
    const { gql, ok, rest } = clientsFor(app);
    const base = `/api/v1/organizations/${org}/projects/${project}`;
    const { body: book } = await rest()
      .post(`${base}/workbooks`)
      .send({ name: 'Libro de conversación' })
      .expect(201);
    const { body: sheet } = await rest()
      .post(`${base}/workbooks/${book.workbook.id}/worksheets`)
      .send({ name: 'Hoja de conversación', columns: [] })
      .expect(201);
    const { createWorksheetConversation: created } = await ok(CREATE, {
      org,
      project,
      sheet: sheet.worksheet.id,
      title: '  Estado del inventario  ',
    });
    expect(created.title).toBe('Estado del inventario');
    const conversation = created.id as string;
    const path = `${base}/conversations/${conversation}`;
    await rest()
      .get(path)
      .expect(200)
      .expect(({ body }) => {
        expect(body.conversation).toMatchObject(created);
      });

    const client = randomUUID();
    const messageVars = {
      org,
      project,
      conversation,
      client,
      content: 'Hola\r\nInventario',
    };
    const { appendConversationMessage: message } = await ok(
      MESSAGE,
      messageVars,
    );
    expect(message).toMatchObject({ sequence: 1, content: 'Hola\nInventario' });
    await rest()
      .post(`${path}/messages`)
      .send({ clientMessageId: client, content: 'Hola\nInventario' })
      .expect(201)
      .expect(({ body }) => expect(body.message).toMatchObject(message));
    const detail = await ok(DETAILS, { org, project, conversation });
    expect(detail.conversation.messages).toEqual({
      items: [{ id: message.id, sequence: 1, content: 'Hola\nInventario' }],
      nextCursor: null,
    });
    expect(detail.project.conversations.items).toEqual([
      { id: conversation, title: 'Estado del inventario' },
    ]);

    await setRole(pool, org, bobId, 'manager');
    await rest('bob-session').get(path).expect(404);
    const denied = await gql(
      DETAILS,
      { org, project, conversation },
      'bob-session',
    );
    expect(denied.body.errors?.[0]?.extensions).toMatchObject({
      code: 'CONVERSATION_NOT_FOUND',
    });
    const anonymous = await gql(DETAILS, { org, project, conversation }, '');
    expect(anonymous.body.errors).toBeDefined();
  });
});
