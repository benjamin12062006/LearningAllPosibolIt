import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveDatabaseConnection } from '../dist/database/database-connection.js';

const neonUrl =
  'postgresql://user:pass@ep-test-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require';

function config(values) {
  return { get: (name) => values[name] };
}

test('Neon usa DATABASE_URL y exige TLS fuera de localhost', () => {
  assert.equal(
    resolveDatabaseConnection(config({ DATABASE_URL: `  ${neonUrl}  ` })).url,
    neonUrl,
  );
  assert.equal(
    resolveDatabaseConnection(
      config({ DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db' }),
    ).url,
    'postgresql://u:p@127.0.0.1:5432/db',
  );
  for (const DATABASE_URL of [
    undefined,
    '',
    'no es una url',
    'mysql://u:p@host/db',
    'postgresql://u:p@ep-test.neon.tech/neondb',
    'postgresql://u:p@ep-test.neon.tech/neondb?sslmode=disable',
  ]) {
    assert.throws(() => resolveDatabaseConnection(config({ DATABASE_URL })));
  }
});

test('los mensajes de error no revelan la URL ni la contraseña', () => {
  assert.throws(
    () =>
      resolveDatabaseConnection(
        config({ DATABASE_URL: 'postgresql://u:secreto@host.neon.tech/db' }),
      ),
    (error) => !/secreto/.test(error.message),
  );
});
