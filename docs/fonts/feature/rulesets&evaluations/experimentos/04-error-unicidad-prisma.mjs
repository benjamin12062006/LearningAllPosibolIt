// Experimento E2: ¿qué error lanza Prisma 7 + @prisma/adapter-pg ante una
// violación de UNIQUE? Usa la base PGlite de las pruebas y la restricción
// (identity_issuer, identity_subject) de app_users. Ejecutar desde la raíz de
// la API después de `pnpm test:features:compile`.
import { createTestDatabase } from '../../../../../.test-build/test/features/support/test-database.js';
import { PrismaService } from '../../../../../.test-build/src/database/prisma.service.js';

const database = await createTestDatabase();
const prisma = new PrismaService(database.connection);
await prisma.onModuleInit();

const user = (id) => ({
  id,
  identityIssuer: 'https://identity.example.test',
  identitySubject: 'repetido',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
});
const describe = (error) => ({
  name: error?.constructor?.name,
  code: error?.code,
  meta: error?.meta,
  message: String(error?.message).split('\n').slice(-3).join(' | '),
});

try {
  await prisma.appUser.create({ data: user('a') });
  try {
    await prisma.appUser.create({ data: user('b') });
  } catch (error) {
    console.log('modelo.create  →', JSON.stringify(describe(error)));
  }
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO estadistica_forms.app_users
          (id, identity_issuer, identity_subject, created_at, updated_at)
        VALUES ('c', 'https://identity.example.test', 'repetido', 'x', 'x')`;
    });
  } catch (error) {
    console.log('$executeRaw tx →', JSON.stringify(describe(error)));
  }
} finally {
  await prisma.onModuleDestroy();
  await database.close();
}
