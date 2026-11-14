import { afterEach, describe, expect, it } from '@jest/globals';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { allowedOrigins, configureHttp } from '../../../src/configure-http.js';

@Controller('cors-probe')
class CorsProbeController {
  @Get() probe() {
    return { ok: true };
  }
}

const WEB_ORIGIN = 'https://ktsu-web-example.a.run.app';

/** La aplicación con `CORS_ALLOWED_ORIGINS` tal como estaría en Cloud Run. */
async function appWithAllowedOrigins(configured: string | undefined) {
  // Asignar `undefined` a `process.env` guardaría el texto "undefined".
  if (configured === undefined) {
    delete process.env.CORS_ALLOWED_ORIGINS;
  } else {
    process.env.CORS_ALLOWED_ORIGINS = configured;
  }
  const module = await Test.createTestingModule({
    controllers: [CorsProbeController],
  }).compile();
  const app = module.createNestApplication();
  configureHttp(app);
  await app.init();
  return app;
}

function preflight(app: INestApplication, origin: string) {
  return request(app.getHttpServer())
    .options('/api/v1/cors-probe')
    .set('Origin', origin)
    .set('Access-Control-Request-Method', 'PATCH');
}

describe('CORS por entorno (deploys, plan 06, D8)', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    delete process.env.CORS_ALLOWED_ORIGINS;
    await app?.close();
    app = undefined;
  });

  it('admite la URL de la web configurada y conserva los orígenes locales', async () => {
    app = await appWithAllowedOrigins(` ${WEB_ORIGIN} `);

    await preflight(app, WEB_ORIGIN)
      .expect(204)
      .expect('Access-Control-Allow-Origin', WEB_ORIGIN);
    await preflight(app, 'http://localhost:3000')
      .expect(204)
      .expect('Access-Control-Allow-Origin', 'http://localhost:3000');
  });

  it('no autoriza otro origen ni la web si no está configurada', async () => {
    app = await appWithAllowedOrigins(undefined);

    const web = await preflight(app, WEB_ORIGIN);
    const other = await preflight(app, 'https://otra.example');

    expect(web.headers).not.toHaveProperty('access-control-allow-origin');
    expect(other.headers).not.toHaveProperty('access-control-allow-origin');
  });

  it('solo acepta orígenes https:// exactos en la configuración', () => {
    expect(allowedOrigins(`${WEB_ORIGIN}, https://b.example`)).toEqual([
      'http://localhost:4321',
      'http://127.0.0.1:4321',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      WEB_ORIGIN,
      'https://b.example',
    ]);
    for (const invalid of [
      '*',
      'http://web.example',
      `${WEB_ORIGIN}/`,
      `${WEB_ORIGIN}/app`,
      'web.example',
    ]) {
      expect(() => allowedOrigins(invalid)).toThrow('CORS_ALLOWED_ORIGINS');
    }
  });
});
