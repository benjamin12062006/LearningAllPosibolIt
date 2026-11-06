import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DescopeService } from '../../../src/auth/descope.service.js';
import { configureHttp } from '../../../src/configure-http.js';
import { POSTGRESQL_CONNECTION } from '../../../src/database/postgresql.connection.js';
import { HealthModule } from '../../../src/health/health.module.js';
import { HEALTH_OPTIONS } from '../../../src/health/health.types.js';
import { ProjectsModule } from '../../../src/projects/projects.module.js';
import { createTestDatabase } from '../support/test-database.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('Salud y requestId por HTTP (jobs&files E6, D12)', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;

  beforeAll(async () => {
    database = await createTestDatabase();
    const module = await Test.createTestingModule({
      imports: [HealthModule, ProjectsModule],
    })
      .overrideProvider(POSTGRESQL_CONNECTION)
      .useValue(database.connection)
      .overrideProvider(DescopeService)
      .useValue({
        validateSession: () => Promise.reject(new Error('sin sesión')),
      })
      .overrideProvider(HEALTH_OPTIONS)
      .useValue({ autoStart: false, intervalMs: 60_000, backlogMs: 600_000 })
      .compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
  });

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await database?.close();
    }
  });

  it('GET /api/v1/health responde 200 sin sesión y sin detalles', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);

    expect(response.body).toEqual({ status: 'ok' });
  });

  it('cada respuesta lleva un X-Request-Id nuevo si el cliente no envía uno', async () => {
    const first = await request(app.getHttpServer()).get('/api/v1/health');
    const second = await request(app.getHttpServer()).get('/api/v1/health');

    expect(first.headers['x-request-id']).toMatch(UUID_PATTERN);
    expect(second.headers['x-request-id']).toMatch(UUID_PATTERN);
    expect(first.headers['x-request-id']).not.toBe(
      second.headers['x-request-id'],
    );
  });

  it('conserva un X-Request-Id válido del cliente y descarta uno inválido', async () => {
    const kept = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('X-Request-Id', 'proxy-1234.abcd');
    const replaced = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('X-Request-Id', 'no válido <script>');

    expect(kept.headers['x-request-id']).toBe('proxy-1234.abcd');
    expect(replaced.headers['x-request-id']).toMatch(UUID_PATTERN);
  });

  it('un error devuelve en el cuerpo el mismo requestId que la cabecera', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/projects')
      .set('X-Request-Id', 'trace-abcdef12')
      .expect(401);

    expect(response.headers['x-request-id']).toBe('trace-abcdef12');
    expect(response.body.requestId).toBe('trace-abcdef12');
  });

  it('un cuerpo JSON mal formado también lleva su requestId', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Content-Type', 'application/json')
      .send('{ roto')
      .expect(400);

    expect(response.body.requestId).toBe(response.headers['x-request-id']);
  });
});
