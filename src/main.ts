import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureHttp } from './configure-http.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureHttp(app);

  app.enableShutdownHooks();

  // En local solo escucha en loopback. En el contenedor, `HOST=0.0.0.0`: Cloud
  // Run entrega las peticiones por la red del contenedor (deploys, plan 06, D8).
  const host = process.env.HOST?.trim() || '127.0.0.1';
  await app.listen(process.env.PORT ?? 8080, host);
}
await bootstrap();
