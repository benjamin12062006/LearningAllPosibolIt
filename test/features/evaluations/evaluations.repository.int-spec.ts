import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { CatalogImportRepository } from '../../../src/catalog-import/catalog-import.repository.js';
import { PrismaService } from '../../../src/database/prisma.service.js';
import { evaluateRow } from '../../../src/evaluations/engine/evaluate-row.js';
import { EvaluationSummary } from '../../../src/evaluations/engine/evaluation-summary.js';
import { buildErrorsCsv } from '../../../src/evaluations/errors-csv.js';
import { EvaluationsRepository } from '../../../src/evaluations/evaluations.repository.js';
import type { EvaluationRequest } from '../../../src/evaluations/evaluations.types.js';
import { EvaluationWorker } from '../../../src/evaluations/evaluations.worker.js';
import type { Project } from '../../../src/projects/projects.types.js';
import { ProjectsRepository } from '../../../src/projects/projects.repository.js';
import { RulesetsRepository } from '../../../src/rulesets/rulesets.repository.js';
import {
  UsersRepository,
  type LocalUser,
} from '../../../src/users/users.repository.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';
import {
  CATALOG_RULESET,
  catalogValues,
  insertReadySnapshot,
  mixedCatalog,
} from './support/snapshot-fixtures.js';

const apiFailure = (code: string, status: number) =>
  expect.objectContaining({
    status,
    response: expect.objectContaining({ code }),
  });

describe('Evaluaciones con Prisma, worker y PostgreSQL temporal', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let prisma: PrismaService;
  let repository: EvaluationsRepository;
  let worker: EvaluationWorker;
  let owner: LocalUser;
  let other: LocalUser;
  let project: Project;
  let snapshotId: string;

  const pool = () => database.connection.pool;

  const request = (overrides: Partial<EvaluationRequest> = {}) => ({
    evaluationId: randomUUID(),
    ownerId: owner.id,
    projectId: project.id,
    snapshotId,
    rulesetRevision: 1,
    ...overrides,
  });

  /** Acepta y procesa una evaluación; devuelve su vista final. */
  async function evaluate(overrides: Partial<EvaluationRequest> = {}) {
    const accepted = request(overrides);
    await repository.accept(accepted);
    await worker.runUntilIdle();
    return repository.findByOwner(
      owner.id,
      accepted.projectId,
      accepted.evaluationId,
    );
  }

  async function countRows(evaluationId: string) {
    const { rows } = await pool().query(
      `SELECT count(*)::int AS count FROM estadistica_forms.evaluation_rows
       WHERE evaluation_id = $1`,
      [evaluationId],
    );
    return rows[0].count;
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    prisma = new PrismaService(database.connection);
    await prisma.onModuleInit();
    repository = new EvaluationsRepository(prisma);
    worker = new EvaluationWorker(repository, {
      autoStart: false,
      pollMs: 1000,
      shutdownMs: 1000,
    });
  });
  beforeEach(async () => {
    await pool().query('TRUNCATE estadistica_forms.app_users CASCADE');
    const users = new UsersRepository(prisma);
    owner = await users.provision(alice);
    other = await users.provision(bob);
    project = await new ProjectsRepository(prisma).create(
      owner.id,
      'Tienda',
      projectInput,
    );
    await new RulesetsRepository(prisma).create(
      owner.id,
      project.id,
      CATALOG_RULESET,
    );
    snapshotId = await insertReadySnapshot(pool(), project.id, mixedCatalog(9));
  });
  afterAll(async () => {
    try {
      await prisma?.onModuleDestroy();
    } finally {
      await database?.close();
    }
  });

  describe('aceptación', () => {
    it('deja la evaluación en cola con las versiones del motor y del perfil', async () => {
      const accepted = request();
      await repository.accept(accepted);

      expect(
        await repository.findByOwner(
          owner.id,
          project.id,
          accepted.evaluationId,
        ),
      ).toMatchObject({
        id: accepted.evaluationId,
        snapshotId,
        rulesetRevision: 1,
        engineVersion: '1',
        profileVersion: 'google_merchant@2026-10-31',
        status: 'queued',
        counts: null,
        resultChecksum: null,
        error: null,
      });
      expect(
        await repository.findByOwner(
          other.id,
          project.id,
          accepted.evaluationId,
        ),
      ).toBeNull();
    });

    it('responde 404 con un proyecto, snapshot o revisión que no son del propietario', async () => {
      const otherProject = await new ProjectsRepository(prisma).create(
        owner.id,
        'Otra',
        projectInput,
      );
      const foreignSnapshot = await insertReadySnapshot(
        pool(),
        otherProject.id,
        mixedCatalog(1),
      );

      await expect(
        repository.accept(request({ ownerId: other.id })),
      ).rejects.toEqual(apiFailure('PROJECT_NOT_FOUND', 404));
      await expect(
        repository.accept(request({ snapshotId: foreignSnapshot })),
      ).rejects.toEqual(apiFailure('IMPORT_NOT_FOUND', 404));
      await expect(
        repository.accept(request({ rulesetRevision: 2 })),
      ).rejects.toEqual(apiFailure('RULESET_NOT_FOUND', 404));
    });

    it('responde 409 si el snapshot no está listo', async () => {
      await pool().query(
        `UPDATE estadistica_forms.catalog_snapshots
         SET status = 'failed', row_count = NULL, error = '{"code":"CSV_INVALID"}'
         WHERE id = $1`,
        [snapshotId],
      );
      await expect(repository.accept(request())).rejects.toEqual(
        apiFailure('EVALUATION_SNAPSHOT_NOT_READY', 409),
      );
    });

    it('responde 409 con un issue por cada atributo cuya columna no existe', async () => {
      const withoutColumns = await insertReadySnapshot(
        pool(),
        project.id,
        [catalogValues('SKU-1')],
        { headers: ['SKU', 'Nombre', 'Descripción', 'URL', 'Imagen', 'Stock'] },
      );

      await expect(
        repository.accept(request({ snapshotId: withoutColumns })),
      ).rejects.toEqual(
        expect.objectContaining({
          status: 409,
          response: expect.objectContaining({
            code: 'EVALUATION_COLUMN_MISSING',
            issues: [
              expect.objectContaining({ field: 'mapping.price' }),
              expect.objectContaining({ field: 'mapping.brand' }),
            ],
          }),
        }),
      );
    });

    it('admite una sola evaluación activa por proyecto, también en la base', async () => {
      await repository.accept(request());
      await expect(repository.accept(request())).rejects.toEqual(
        apiFailure('EVALUATION_ALREADY_ACTIVE', 409),
      );

      // El índice único parcial rechaza la segunda aunque se salte la aplicación.
      const { rows } = await pool().query(
        `SELECT ruleset_version_id AS id FROM estadistica_forms.evaluations`,
      );
      await expect(
        pool().query(
          `INSERT INTO estadistica_forms.evaluations
             (id, project_id, snapshot_id, ruleset_version_id, engine_version,
              profile_version, status, created_at)
           VALUES ($1, $2, $3, $4, '1', 'p', 'queued', 'x')`,
          [randomUUID(), project.id, snapshotId, rows[0].id],
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });

  describe('worker', () => {
    it('evalúa todas las filas, guarda una por fila y confirma conteos y suma', async () => {
      const evaluation = await evaluate();

      expect(evaluation).toMatchObject({
        status: 'succeeded',
        counts: { total: 9, valid: 3, invalid: 3, excluded: 3 },
        error: null,
      });
      expect(evaluation?.startedAt).not.toBeNull();
      expect(evaluation?.finishedAt).not.toBeNull();
      expect(await countRows(evaluation!.id)).toBe(9);

      // La suma es la del motor sobre las mismas filas: nada se pierde al guardar.
      const summary = new EvaluationSummary();
      for (const [index, values] of mixedCatalog(9).entries()) {
        summary.add(
          evaluateRow(
            {
              sourceRow: index + 1,
              externalId: values.SKU,
              originalValues: values,
            },
            CATALOG_RULESET,
            { currency: 'USD' },
          ),
        );
      }
      expect(evaluation?.resultChecksum).toBe(summary.finish().checksum);
    });

    it('guarda valores, problemas y regla de exclusión de cada fila', async () => {
      const evaluation = await evaluate();
      const { rows } = await pool().query(
        `SELECT source_row, outcome, product_values, problems, excluded_by_rule
         FROM estadistica_forms.evaluation_rows
         WHERE evaluation_id = $1 AND source_row <= 3
         ORDER BY source_row`,
        [evaluation!.id],
      );

      expect(rows).toEqual([
        expect.objectContaining({
          outcome: 'valid',
          product_values: expect.objectContaining({
            title: 'Acme Mesa SKU-1',
            price: '149.90 USD',
          }),
          problems: [],
          excluded_by_rule: null,
        }),
        expect.objectContaining({
          outcome: 'invalid',
          product_values: expect.objectContaining({ price: '1,50' }),
          problems: [{ attribute: 'price', code: 'PRICE_FORMAT_INVALID' }],
        }),
        expect.objectContaining({
          outcome: 'excluded',
          product_values: null,
          problems: [],
          excluded_by_rule: 3,
        }),
      ]);
    });

    it('repite el mismo resultado con las mismas entradas (RNF02)', async () => {
      const first = await evaluate();
      const second = await evaluate();

      expect(second?.id).not.toBe(first?.id);
      expect(second?.counts).toEqual(first?.counts);
      expect(second?.resultChecksum).toBe(first?.resultChecksum);
    });

    it('procesa por lotes un snapshot mayor que un lote', async () => {
      snapshotId = await insertReadySnapshot(
        pool(),
        project.id,
        mixedCatalog(600),
      );
      const evaluation = await evaluate();

      expect(evaluation?.counts).toEqual({
        total: 600,
        valid: 200,
        invalid: 200,
        excluded: 200,
      });
      expect(await countRows(evaluation!.id)).toBe(600);
    });

    it('falla por integridad si el total no coincide con el snapshot y no deja filas', async () => {
      await pool().query(
        `UPDATE estadistica_forms.catalog_snapshots SET row_count = 10 WHERE id = $1`,
        [snapshotId],
      );
      const evaluation = await evaluate();

      expect(evaluation).toMatchObject({
        status: 'failed',
        counts: null,
        error: expect.objectContaining({ code: 'EVALUATION_INTEGRITY_FAILED' }),
      });
      expect(await countRows(evaluation!.id)).toBe(0);
    });

    it('falla sin evaluar si la versión guardada tiene una forma inválida', async () => {
      const accepted = request();
      await repository.accept(accepted);
      await pool().query(
        `UPDATE estadistica_forms.ruleset_versions SET rules = '[{"type":"x"}]'`,
      );
      await worker.runUntilIdle();

      expect(
        await repository.findByOwner(
          owner.id,
          project.id,
          accepted.evaluationId,
        ),
      ).toMatchObject({
        status: 'failed',
        error: expect.objectContaining({
          code: 'EVALUATION_PROCESSING_FAILED',
        }),
      });
    });

    it('interrumpe las evaluaciones running, borra sus filas y no deja seguir guardando', async () => {
      const accepted = request();
      await repository.accept(accepted);
      const claimed = await repository.claim();
      const outcome = evaluateRow(
        {
          sourceRow: 1,
          externalId: 'SKU-1',
          originalValues: catalogValues('SKU-1'),
        },
        CATALOG_RULESET,
        { currency: 'USD' },
      );
      await repository.appendRows(claimed!.id, [outcome]);

      expect(await repository.interruptRunning()).toBe(1);
      expect(await countRows(accepted.evaluationId)).toBe(0);
      expect(
        await repository.findByOwner(
          owner.id,
          project.id,
          accepted.evaluationId,
        ),
      ).toMatchObject({
        status: 'failed',
        error: expect.objectContaining({ code: 'EVALUATION_INTERRUPTED' }),
      });
      await expect(
        repository.appendRows(claimed!.id, [outcome]),
      ).rejects.toMatchObject({
        detail: expect.objectContaining({ code: 'EVALUATION_INTERRUPTED' }),
      });
    });
  });

  describe('restricciones y borrado', () => {
    it('rechaza en la base conteos que no suman el total y filas incoherentes', async () => {
      const evaluation = await evaluate();
      await expect(
        pool().query(
          `UPDATE estadistica_forms.evaluations SET valid_count = 4 WHERE id = $1`,
          [evaluation!.id],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        pool().query(
          `UPDATE estadistica_forms.evaluation_rows
           SET problems = '[]' WHERE outcome = 'invalid'`,
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('no admite una evaluación con un snapshot de otro proyecto', async () => {
      const otherProject = await new ProjectsRepository(prisma).create(
        owner.id,
        'Otra',
        projectInput,
      );
      const { rows } = await pool().query(
        `SELECT id FROM estadistica_forms.ruleset_versions WHERE project_id = $1`,
        [project.id],
      );
      await expect(
        pool().query(
          `INSERT INTO estadistica_forms.evaluations
             (id, project_id, snapshot_id, ruleset_version_id, engine_version,
              profile_version, status, created_at)
           VALUES ($1, $2, $3, $4, '1', 'p', 'queued', 'x')`,
          [randomUUID(), otherProject.id, snapshotId, rows[0].id],
        ),
      ).rejects.toMatchObject({ code: '23503' });
    });

    it('bloquea borrar la importación o el proyecto con una evaluación activa', async () => {
      const imports = new CatalogImportRepository(prisma);
      await repository.accept(request());

      await expect(
        imports.deleteSnapshot(owner.id, project.id, snapshotId),
      ).rejects.toEqual(apiFailure('EVALUATION_IN_PROGRESS', 409));
      await expect(imports.deleteProject(owner.id, project.id)).rejects.toEqual(
        apiFailure('EVALUATION_IN_PROGRESS', 409),
      );
    });

    it('al terminar, borrar la importación borra sus evaluaciones y filas', async () => {
      const evaluation = await evaluate();
      await new CatalogImportRepository(prisma).deleteSnapshot(
        owner.id,
        project.id,
        snapshotId,
      );

      expect(
        await repository.findByOwner(owner.id, project.id, evaluation!.id),
      ).toBeNull();
      expect(await countRows(evaluation!.id)).toBe(0);
    });

    it('no deja borrar sola una versión de reglas usada por una evaluación', async () => {
      await evaluate();
      // ON DELETE RESTRICT responde `restrict_violation` (23001), no 23503.
      await expect(
        pool().query('DELETE FROM estadistica_forms.ruleset_versions'),
      ).rejects.toMatchObject({ code: '23001' });
    });
  });
  describe('informe (E4)', () => {
    it('lee las filas en orden, por páginas y filtradas por resultado', async () => {
      const evaluation = await evaluate();
      const rowsOf = async (
        page: { limit: number; offset: number },
        outcome?: 'valid' | 'invalid' | 'excluded',
      ) =>
        (await repository.findRows(evaluation!.id, page, outcome)).map(
          (row) => row.sourceRow,
        );

      expect(await rowsOf({ limit: 4, offset: 0 })).toEqual([1, 2, 3, 4]);
      expect(await rowsOf({ limit: 10, offset: 0 }, 'invalid')).toEqual([
        2, 5, 8,
      ]);
      expect(await rowsOf({ limit: 1, offset: 1 }, 'excluded')).toEqual([6]);
    });

    it('describe cada problema y deja las filas inválidas listas para el CSV', async () => {
      const evaluation = await evaluate();
      const [invalid] = await repository.findRows(
        evaluation!.id,
        { limit: 1, offset: 0 },
        'invalid',
      );

      expect(invalid.problems).toEqual([
        expect.objectContaining({
          attribute: 'price',
          code: 'PRICE_FORMAT_INVALID',
          suggestion: expect.objectContaining({
            es: expect.stringContaining('1234.50'),
          }),
        }),
      ]);
      expect(await repository.findInvalidRows(evaluation!.id)).toEqual([
        {
          sourceRow: 2,
          externalId: 'SKU-2',
          problems: [{ attribute: 'price', code: 'PRICE_FORMAT_INVALID' }],
        },
        expect.objectContaining({ sourceRow: 5 }),
        expect.objectContaining({ sourceRow: 8 }),
      ]);
    });

    it('no entrega filas guardadas con problemas de forma inválida', async () => {
      const evaluation = await evaluate();
      await pool().query(
        `UPDATE estadistica_forms.evaluation_rows
         SET problems = '[{"attribute":"price","code":"INVENTADO"}]'
         WHERE evaluation_id = $1 AND outcome = 'invalid'`,
        [evaluation!.id],
      );
      await expect(repository.findInvalidRows(evaluation!.id)).rejects.toThrow(
        'forma inválida',
      );
    });
  });

  describe('medición (E4)', () => {
    // Registra duración y memoria sin umbral inventado (ficha 08, F38); en
    // PGlite dentro de Jest los números orientan, pero no predicen Neon.
    it('evalúa 5.000 filas con 20 reglas y genera su errores.csv', async () => {
      snapshotId = await insertReadySnapshot(
        pool(),
        project.id,
        mixedCatalog(5000),
      );
      // Revisión 2: las 3 reglas de siempre más 17 que recorren cada fila sin
      // cambiar el resultado, para medir con el máximo de reglas (plan D3).
      const noOpRules = Array.from({ length: 17 }, (_, index) =>
        index % 2 === 0
          ? ({ type: 'clean_text', attributes: ['description'] } as const)
          : ({
              type: 'exclude_when',
              attribute: 'id',
              operator: 'equals',
              value: `NO-EXISTE-${index}`,
            } as const),
      );
      await new RulesetsRepository(prisma).create(owner.id, project.id, {
        mapping: CATALOG_RULESET.mapping,
        rules: [...CATALOG_RULESET.rules, ...noOpRules],
      });

      const rssBefore = process.memoryUsage().rss;
      const started = performance.now();
      const evaluation = await evaluate({ rulesetRevision: 2 });
      const durationMs = Math.round(performance.now() - started);
      const rssAfterEvaluation = process.memoryUsage().rss;

      expect(evaluation).toMatchObject({
        status: 'succeeded',
        counts: { total: 5000, valid: 1667, invalid: 1667, excluded: 1666 },
      });

      const csvStarted = performance.now();
      const csv = buildErrorsCsv(
        await repository.findInvalidRows(evaluation!.id),
        'es',
      );
      const csvMs = Math.round(performance.now() - csvStarted);
      expect(csv.split('\r\n')).toHaveLength(1667 + 2);

      process.stdout.write(
        `${JSON.stringify({
          benchmark: 'evaluation-5000-rows-20-rules',
          durationMs,
          rssBefore,
          rssAfterEvaluation,
          csvMs,
          csvBytes: Buffer.byteLength(csv),
        })}\n`,
      );
    });
  });
});
