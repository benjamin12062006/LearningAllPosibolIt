import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { execFile, spawnSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Pool } from 'pg';
import {
  catalogValues,
  insertReadySnapshot,
} from '../evaluations/support/snapshot-fixtures.js';
import {
  clientsFor,
  seedTwoOrganizations,
  startGraphqlApp,
} from './support/graphql-test-app.js';

const execFileAsync = promisify(execFile);

/** Sin Python 3 en la máquina no se puede probar el cliente: se salta, no falla. */
const pythonAvailable = spawnSync('python3', ['--version']).status === 0;
const describeWithPython = pythonAvailable ? describe : describe.skip;

type ContractReport = {
  ok: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
};

/**
 * C7.5: el cliente Python mínimo (solo biblioteca estándar) llama a Nest
 * arrancado por HTTP con las operaciones predefinidas del agente, con dos
 * organizaciones, una credencial inválida y sin credencial.
 */
describeWithPython('cliente Python contra Nest arrancado', () => {
  let app: INestApplication;
  let pool: Pool;
  let close: () => Promise<void>;
  let baseUrl: string;

  beforeAll(async () => {
    ({ app, pool, close } = await startGraphqlApp());
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });
  afterAll(async () => {
    await close?.();
  });

  it('las comprobaciones del contrato pasan desde Python', async () => {
    const { projectId, bobProjectId, organizationId } =
      await seedTwoOrganizations(app, pool);
    const snapshotId = await insertReadySnapshot(pool, projectId, [
      catalogValues('SKU-1'),
      catalogValues('SKU-2', { Marca: '' }),
    ]);
    const { rest } = clientsFor(app);
    const base = `/api/v1/organizations/${organizationId}/projects/${projectId}`;
    const { body: workbook } = await rest()
      .post(`${base}/workbooks`)
      .send({ name: 'Libro' })
      .expect(201);
    const { body: sheet } = await rest()
      .post(`${base}/workbooks/${workbook.workbook.id}/worksheets`)
      .send({ name: 'Hoja', columns: [{ name: 'SKU', type: 'text' }] })
      .expect(201);

    const { stdout } = await execFileAsync('python3', ['check_contract.py'], {
      cwd: resolve('contracts/python'),
      env: {
        PATH: process.env.PATH,
        NEST_URL: baseUrl,
        ALICE_TOKEN: 'alice-session',
        BOB_TOKEN: 'bob-session',
        ORGANIZATION_ID: organizationId,
        PROJECT_ID: projectId,
        BOB_PROJECT_ID: bobProjectId,
        SNAPSHOT_ID: snapshotId,
        WORKSHEET_ID: sheet.worksheet.id,
        SKU_COLUMN_ID: sheet.worksheet.columns[0].id,
      },
      timeout: 60_000,
    }).catch((error: { stdout?: string; stderr?: string }) => {
      // Código 1: alguna comprobación falló; el informe sigue en stdout.
      if (error.stdout) return { stdout: error.stdout };
      throw new Error(`Python no terminó: ${error.stderr ?? String(error)}`);
    });

    const report = JSON.parse(stdout) as ContractReport;
    expect(report.checks.filter((check) => !check.ok)).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual([
      'me con la sesión de Alice',
      'resumen del proyecto en una llamada',
      'createRuleset con @oneOf',
      'rulesPreview sin guardar',
      'requestEvaluation en cola',
      'proponer un cambio en una hoja',
      'suggest_view como vista personal',
      'errores de validación como en REST',
      'aislamiento entre dos organizaciones',
      'credencial inválida y sin credencial',
      'límite de coste',
    ]);
    expect(report.ok).toBe(true);
  });
});
