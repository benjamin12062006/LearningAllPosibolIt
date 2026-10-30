import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../dist/app.module.js';
import { PrismaService } from '../../dist/database/prisma.service.js';
import { UsersService } from '../../dist/users/users.service.js';

try {
  loadEnvFile();
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

// Identidad ficticia exclusiva de esta comprobación de persistencia.
// No es una cuenta Descope y nunca se acepta por HTTP sin un JWT validado.
const identity = Object.freeze({
  issuer: 'urn:estadistica-forms:postgresql-smoke-test',
  subject: 'postgresql-smoke-user',
  email: 'postgresql-smoke@example.test',
});

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: false,
  abortOnError: false,
});
const prisma = app.get(PrismaService);
try {
  const users = app.get(UsersService);
  const first = await users.provision(identity);
  const repeated = await users.provision(identity);
  assert.deepEqual(repeated, first);

  const updated = await users.updateCurrent(identity, {
    displayName: 'Usuario de prueba PostgreSQL',
  });
  assert.equal(updated.id, first.id);
  assert.equal(updated.displayName, 'Usuario de prueba PostgreSQL');
  assert.deepEqual(await users.findCurrent(identity), updated);

  const [stored] = await prisma.$queryRaw`
    SELECT id, email, display_name AS "displayName",
      created_at AS "createdAt", updated_at AS "updatedAt"
    FROM estadistica_forms.app_users
    WHERE identity_issuer = ${identity.issuer}
      AND identity_subject = ${identity.subject}
  `;
  assert.deepEqual(stored, updated);
  const [count] = await prisma.$queryRaw`
    SELECT COUNT(*)::integer AS total
    FROM estadistica_forms.app_users
    WHERE identity_issuer = ${identity.issuer}
      AND identity_subject = ${identity.subject}
  `;
  assert.equal(count.total, 1);

  console.log(
    JSON.stringify({
      checks: [
        'conexión',
        'aprovisionamiento',
        'idempotencia',
        'edición',
        'lectura SQL',
      ],
      scope: 'Persistencia PostgreSQL; no login Descope.',
      user: stored,
      matchingRows: count.total,
    }),
  );
} finally {
  await app.close();
}
