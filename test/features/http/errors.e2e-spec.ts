import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Post,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { apiError } from '../../../src/common/http/api-error.js';
import { publicError } from '../../../src/common/http/public-error.js';
import { uuidParamPipe } from '../../../src/common/http/validation-errors.js';
import { configureHttp } from '../../../src/configure-http.js';
import { CreateProjectDto } from '../../../src/projects/projects.dto.js';

@Controller('contract')
class ContractController {
  @Get('business') business() {
    throw apiError('PROJECT_CONFIGURATION_REQUIRED');
  }
  @Get('unexpected') unexpected() {
    throw new Error('SQL secreto token=privado');
  }
  @Get('standard') standard() {
    throw new HttpException('diagnóstico privado', 418);
  }
  @Get(':id') uuid(@Param('id', uuidParamPipe('id')) id: string) {
    return { id };
  }
  @Post() create(@Body() project: CreateProjectDto) {
    return { project };
  }
}

describe('Contrato HTTP global de errores', () => {
  let app: INestApplication;
  const api = '/api/v1/contract';
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ContractController],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });

  it.each([
    ['business', 409, 'PROJECT_CONFIGURATION_REQUIRED'],
    ['unexpected', 500, 'INTERNAL_ERROR'],
    ['standard', 418, 'HTTP_ERROR'],
  ] as const)(
    '%s conserva el estado y oculta el diagnóstico',
    async (route, status, code) => {
      const { body } = await request(app.getHttpServer())
        .get(`${api}/${route}`)
        .set('Accept-Language', 'en')
        .expect(status);
      expect(body).toEqual({
        statusCode: status,
        ...publicError(code),
        requestId: expect.any(String),
      });
      expect(JSON.stringify(body)).not.toMatch(/SQL|privado|token=/);
    },
  );

  it('una ruta ausente devuelve 404 sin repetir la ruta solicitada', async () => {
    const { body } = await request(app.getHttpServer())
      .get('/api/v1/ruta-secreta')
      .expect(404);
    expect(body).toMatchObject({
      statusCode: 404,
      ...publicError('ROUTE_NOT_FOUND'),
    });
    expect(JSON.stringify(body)).not.toContain('ruta-secreta');
  });

  it.each([
    ['JSON incompleto', '{', 'application/json', 400, 'INVALID_JSON'],
    [
      'cuerpo excesivo',
      JSON.stringify({ name: 'x'.repeat(110_000) }),
      'application/json',
      413,
      'PAYLOAD_TOO_LARGE',
    ],
    [
      'charset no admitido',
      '{}',
      'application/json; charset=unknown',
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    ],
  ] as const)(
    '%s se normaliza antes del controller',
    async (_label, input, contentType, status, code) => {
      const { body } = await request(app.getHttpServer())
        .post(api)
        .set('Content-Type', contentType)
        .send(input)
        .expect(status);
      expect(body).toEqual({
        statusCode: status,
        ...publicError(code),
        requestId: expect.any(String),
      });
    },
  );

  it.each([
    undefined,
    {},
    {
      name: null,
      country: 'ZZ',
      currency: 'ZZZ',
      channelProfile: 'other',
      secret: 'valor-privado',
    },
  ])(
    'los DTOs inválidos producen incidencias bilingües sin valores: %j',
    async (input) => {
      const { body } = await request(app.getHttpServer())
        .post(api)
        .send(input)
        .expect(400);
      expect(body).toMatchObject({
        statusCode: 400,
        ...publicError('VALIDATION_FAILED'),
        issues: expect.any(Array),
      });
      expect(body.issues.length).toBeGreaterThan(0);
      for (const issue of body.issues)
        expect(issue).toEqual({
          field: expect.any(String),
          ...publicError(issue.code),
        });
      expect(JSON.stringify(body)).not.toContain('valor-privado');
      const repeated = await request(app.getHttpServer())
        .post(api)
        .send(input)
        .expect(400);
      expect(repeated.body.issues).toEqual(body.issues);
    },
  );

  it('UUID inválido identifica el parámetro y las dos traducciones', async () => {
    const { body } = await request(app.getHttpServer())
      .get(`${api}/invalid`)
      .expect(400);
    expect(body).toMatchObject({
      ...publicError('INVALID_UUID'),
      issues: [{ field: 'id', ...publicError('INVALID_UUID') }],
    });
  });

  it('un campo que el DTO no declara se rechaza con su nombre, no se ignora', async () => {
    const { body } = await request(app.getHttpServer())
      .post(api)
      .send({
        name: 'Tienda',
        country: 'US',
        currency: 'USD',
        channelProfile: 'google_merchant',
        ownerId: 'otro',
      })
      .expect(400);
    expect(body).toMatchObject({
      ...publicError('VALIDATION_FAILED'),
      issues: [{ field: 'ownerId', ...publicError('FIELD_NOT_ALLOWED') }],
    });
  });

  it('el éxito mantiene el contrato de datos sin añadir mensajes', async () => {
    const project = {
      name: 'Tienda',
      country: 'US',
      currency: 'USD',
      channelProfile: 'google_merchant',
    };
    await request(app.getHttpServer())
      .post(api)
      .send(project)
      .expect(201, { project });
  });
});
