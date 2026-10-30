import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureHttp } from './configure-http.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureHttp(app);

  app.enableShutdownHooks();

  await app.listen(process.env.PORT ?? 8080, '127.0.0.1');
}
await bootstrap();
