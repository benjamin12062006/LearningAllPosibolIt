import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveDatabaseConnection } from '../dist/database/database-connection.js';

const environment = {
  INSTANCE_CONNECTION_NAME: 'test-project:test-region:test-instance',
  DB_NAME: 'test-db',
  DB_USER: 'test-user',
  DB_PASSWORD: '  literal$password  ',
};

function config(values) {
  return { get: (name) => values[name] };
}

test('Cloud SQL conserva la contraseña literal y valida su configuración', () => {
  const resolved = resolveDatabaseConnection(config(environment));
  assert.equal(resolved.password, environment.DB_PASSWORD);
  for (const name of Object.keys(environment)) {
    assert.throws(
      () => resolveDatabaseConnection(config({ ...environment, [name]: '' })),
      new RegExp(name),
    );
  }
  assert.throws(() =>
    resolveDatabaseConnection(
      config({ ...environment, INSTANCE_CONNECTION_NAME: 'invalid' }),
    ),
  );
  assert.throws(() =>
    resolveDatabaseConnection(
      config({ DATABASE_URL: 'postgresql://unused.invalid/db' }),
    ),
  );
});
