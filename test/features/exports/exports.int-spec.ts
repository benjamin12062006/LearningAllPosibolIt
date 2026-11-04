import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from '../../../src/artifacts/artifact.store.js';
import { ARTIFACT_STORE_OPTIONS } from '../../../src/artifacts/artifacts.types.js';
import { DescopeService } from '../../../src/auth/descope.service.js';
import { ORPHAN_MIN_AGE_MS } from '../../../src/artifacts/remove-orphans.js';
import { CatalogImportRepository } from '../../../src/catalog-import/catalog-import.repository.js';
import { POSTGRESQL_CONNECTION } from '../../../src/database/postgresql.connection.js';
import { PrismaService } from '../../../src/database/prisma.service.js';
import { EvaluationsRepository } from '../../../src/evaluations/evaluations.repository.js';
import { EvaluationWorker } from '../../../src/evaluations/evaluations.worker.js';
import { ExportCleanupService } from '../../../src/exports/export-cleanup.service.js';
import { ExportsModule } from '../../../src/exports/exports.module.js';
import { ExportsRepository } from '../../../src/exports/exports.repository.js';
import { ExportsService } from '../../../src/exports/exports.service.js';
import {
  EXPORT_OPTIONS,
  type NewExport,
} from '../../../src/exports/exports.types.js';
import { ProjectsService } from '../../../src/projects/projects.service.js';
import { RulesetsRepository } from '../../../src/rulesets/rulesets.repository.js';
import { UsersService } from '../../../src/users/users.service.js';
import {
  CATALOG_RULESET,
  insertReadySnapshot,
  mixedCatalog,
} from '../evaluations/support/snapshot-fixtures.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';

const apiFailure = (code: string, status: number) =>
  expect.objectContaining({
    status,
    response: expect.objectContaining({ code }),
  });

// PGlite es una base de una sola conexión y ejecuta las transacciones una tras
// otra: estas pruebas no demuestran el bloqueo FOR SHARE de la exportación frente
// al FOR UPDATE de los borrados. Lo garantizan la FK compuesta, la cascada y el
// índice único, que sí se prueban aquí (trampa 4 del traspaso).
describe('Exportaciones con Prisma, almacén y PostgreSQL temporal', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let module: TestingModule;
  let root: string;
  let prisma: PrismaService;
  let service: ExportsService;
  let repository: ExportsRepository;
  let evaluations: EvaluationsRepository;
  let worker: EvaluationWorker;
  let ownerId: string;
  let projectId: string;
  let otherProjectId: string;
  let snapshotId: string;

  const pool = () => database.connection.pool;
  const exportFiles = () => readdir(join(root, 'exports'));

  /** Evalúa el snapshot y devuelve la evaluación terminada. */
  async function evaluate() {
    const evaluationId = randomUUID();
    await evaluations.accept({
      evaluationId,
      ownerId,
      projectId,
      snapshotId,
      rulesetRevision: 1,
    });
    await worker.runUntilIdle();
    const evaluation = await evaluations.findByOwner(
      ownerId,
      projectId,
      evaluationId,
    );
    return evaluation!;
  }

  function approvalOf(evaluation: Awaited<ReturnType<typeof evaluate>>) {
    return {
      evaluationId: evaluation.id,
      resultChecksum: evaluation.resultChecksum!,
      acceptedInvalidCount: evaluation.counts!.invalid,
      acceptedExcludedCount: evaluation.counts!.excluded,
    };
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    root = await mkdtemp(join(tmpdir(), 'exports-integration-'));
    module = await Test.createTestingModule({ imports: [ExportsModule] })
      .overrideProvider(POSTGRESQL_CONNECTION)
      .useValue(database.connection)
      .overrideProvider(ARTIFACT_STORE_OPTIONS)
      .useValue({ root })
      // Estas pruebas llaman al servicio sin HTTP: la sesión no se valida.
      .overrideProvider(DescopeService)
      .useValue({})
      // La limpieza se prueba llamándola; al arrancar no debe tocar nada.
      .overrideProvider(EXPORT_OPTIONS)
      .useValue({ autoStart: false })
      .compile();
    await module.init();
    prisma = module.get(PrismaService);
    service = module.get(ExportsService);
    repository = module.get(ExportsRepository);
    evaluations = new EvaluationsRepository(prisma);
    worker = new EvaluationWorker(evaluations, {
      autoStart: false,
      pollMs: 1000,
      shutdownMs: 1000,
    });
  });
  beforeEach(async () => {
    await pool().query('TRUNCATE estadistica_forms.app_users CASCADE');
    await rm(join(root, 'exports'), { recursive: true, force: true });
    await module.get(ArtifactStore).onModuleInit();
    const users = module.get(UsersService);
    ownerId = (await users.provision(alice)).id;
    await users.provision(bob);
    const projects = module.get(ProjectsService);
    projectId = (await projects.create(alice, projectInput)).id;
    otherProjectId = (await projects.create(bob, projectInput)).id;
    await new RulesetsRepository(prisma).create(
      ownerId,
      projectId,
      CATALOG_RULESET,
    );
    snapshotId = await insertReadySnapshot(pool(), projectId, mixedCatalog(6));
  });
  afterAll(async () => {
    try {
      await module?.close();
    } finally {
      await database?.close();
      if (root) await rm(root, { recursive: true, force: true });
    }
  });

  describe('lectura de la evaluación', () => {
    it('devuelve versiones, conteos y suma, sin evaluaciones posteriores', async () => {
      const evaluation = await evaluate();

      await expect(
        repository.findEvaluationToExport(ownerId, projectId, evaluation.id),
      ).resolves.toEqual({
        status: 'succeeded',
        engineVersion: evaluation.engineVersion,
        profileVersion: evaluation.profileVersion,
        counts: { valid: 2, invalid: 2, excluded: 2 },
        resultChecksum: evaluation.resultChecksum,
        hasNewerEvaluation: false,
      });
    });

    it('no la encuentra desde otro proyecto ni para otro propietario', async () => {
      const evaluation = await evaluate();
      const bobId = (await module.get(UsersService).findCurrent(bob)).id;

      await expect(
        repository.findEvaluationToExport(
          ownerId,
          otherProjectId,
          evaluation.id,
        ),
      ).resolves.toBeNull();
      await expect(
        repository.findEvaluationToExport(bobId, projectId, evaluation.id),
      ).resolves.toBeNull();
    });

    it('una evaluación posterior en cola o terminada la reemplaza; una fallida no', async () => {
      const first = await evaluate();
      const second = randomUUID();
      await evaluations.accept({
        evaluationId: second,
        ownerId,
        projectId,
        snapshotId,
        rulesetRevision: 1,
      });

      expect(
        (await repository.findEvaluationToExport(ownerId, projectId, first.id))
          ?.hasNewerEvaluation,
      ).toBe(true);

      await pool().query(
        `UPDATE estadistica_forms.evaluations
         SET status = 'failed', finished_at = $2,
             error = '{"code":"EVALUATION_PROCESSING_FAILED"}'::jsonb
         WHERE id = $1`,
        [second, '2026-11-01T10:00:00.000Z'],
      );
      expect(
        (await repository.findEvaluationToExport(ownerId, projectId, first.id))
          ?.hasNewerEvaluation,
      ).toBe(false);
    });

    it('lee solo las filas válidas, en orden de source_row', async () => {
      const evaluation = await evaluate();

      const rows = await repository.findValidRows(evaluation.id);

      expect(rows.map((row) => row.externalId)).toEqual(['SKU-1', 'SKU-4']);
      expect(rows[0].values).toMatchObject({ price: '149.90 USD' });
    });
  });

  describe('exportar', () => {
    it('escribe el TSV, guarda la fila y la suma corresponde a los bytes', async () => {
      const evaluation = await evaluate();

      const result = await service.create(
        alice,
        projectId,
        approvalOf(evaluation),
      );

      expect(result).toMatchObject({
        created: true,
        export: {
          evaluationId: evaluation.id,
          acceptedInvalidCount: 2,
          acceptedExcludedCount: 2,
          rowCount: 2,
        },
        downloadUrl: `/api/v1/projects/${projectId}/exports/${result.export.id}/productos.tsv`,
      });
      const files = await exportFiles();
      expect(files).toHaveLength(1);
      const content = await readFile(join(root, 'exports', files[0]));
      expect(result.export.byteSize).toBe(content.length);
      expect(result.export.tsvChecksum).toBe(
        createHash('sha256').update(content).digest('hex'),
      );
      const lines = content.toString('utf8').trimEnd().split('\n');
      expect(lines.map((line) => line.split('\t')[0])).toEqual([
        'id',
        'SKU-1',
        'SKU-4',
      ]);
    });

    it('la segunda petición devuelve la misma exportación sin escribir otro archivo', async () => {
      const evaluation = await evaluate();
      const first = await service.create(
        alice,
        projectId,
        approvalOf(evaluation),
      );

      const writeExport = jest.spyOn(module.get(ArtifactStore), 'writeExport');

      const second = await service.create(
        alice,
        projectId,
        approvalOf(evaluation),
      );

      expect(second).toEqual({ ...first, created: false });
      expect(writeExport).not.toHaveBeenCalled();
      expect(await exportFiles()).toHaveLength(1);
    });

    it('si la fila no se guarda, borra el archivo', async () => {
      const evaluation = await evaluate();
      jest
        .spyOn(repository, 'insert')
        .mockRejectedValueOnce(new Error('Fallo al guardar'));

      await expect(
        service.create(alice, projectId, approvalOf(evaluation)),
      ).rejects.toThrow('Fallo al guardar');
      expect(await exportFiles()).toEqual([]);
    });

    it('si otra petición guardó antes, borra su archivo y devuelve la existente', async () => {
      const evaluation = await evaluate();
      const winner = await service.create(
        alice,
        projectId,
        approvalOf(evaluation),
      );
      // Simula la carrera: esta petición no ve la exportación al empezar.
      jest.spyOn(repository, 'findByEvaluation').mockResolvedValueOnce(null);

      const loser = await service.create(
        alice,
        projectId,
        approvalOf(evaluation),
      );

      expect(loser).toEqual({ ...winner, created: false });
      expect(await exportFiles()).toHaveLength(1);
    });

    it('repite la comprobación dentro de la transacción', async () => {
      const evaluation = await evaluate();
      const file = await module
        .get(ArtifactStore)
        .writeExport(Buffer.from('id\n'));
      const record: NewExport = {
        id: randomUUID(),
        ownerId,
        projectId,
        evaluationId: evaluation.id,
        approval: {
          ...approvalOf(evaluation),
          resultChecksum: 'b'.repeat(64),
        },
        rowCount: 2,
        file,
        createdAt: new Date().toISOString(),
      };

      await expect(repository.insert(record)).rejects.toEqual(
        apiFailure('EXPORT_APPROVAL_MISMATCH', 409),
      );
    });
  });

  describe('restricciones de la base', () => {
    async function insertExport(overrides: Record<string, unknown>) {
      const evaluation = await evaluate();
      const row = {
        id: randomUUID(),
        project_id: projectId,
        evaluation_id: evaluation.id,
        approved_result_checksum: 'a'.repeat(64),
        accepted_invalid_count: 2,
        accepted_excluded_count: 2,
        row_count: 2,
        artifact_key: `${randomUUID()}.tsv`,
        byte_size: 10,
        tsv_checksum: 'c'.repeat(64),
        created_at: '2026-11-01T00:00:00.000Z',
        ...overrides,
      };
      const columns = Object.keys(row);
      return pool().query(
        `INSERT INTO estadistica_forms.exports (${columns.join(', ')})
         VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')})`,
        Object.values(row),
      );
    }

    it('la FK compuesta impide apuntar a la evaluación desde otro proyecto', async () => {
      await expect(
        insertExport({ project_id: otherProjectId }),
      ).rejects.toMatchObject({ code: '23503' });
    });

    it.each([
      ['artifact_key', 'x.csv'],
      ['approved_result_checksum', 'A'.repeat(64)],
      ['tsv_checksum', 'corta'],
      ['row_count', 0],
      ['accepted_invalid_count', -1],
      ['byte_size', 0],
      ['accepted_excluded_count', 5000],
    ])('el CHECK rechaza %s = %j', async (column, value) => {
      await expect(insertExport({ [column]: value })).rejects.toMatchObject({
        code: '23514',
      });
    });

    it('una sola exportación por evaluación', async () => {
      const evaluation = await evaluate();
      const record = (): NewExport => ({
        id: randomUUID(),
        ownerId,
        projectId,
        evaluationId: evaluation.id,
        approval: {
          resultChecksum: evaluation.resultChecksum!,
          acceptedInvalidCount: 2,
          acceptedExcludedCount: 2,
        },
        rowCount: 2,
        file: {
          key: `${randomUUID()}.tsv`,
          byteSize: 10,
          checksum: 'c'.repeat(64),
        },
        createdAt: new Date().toISOString(),
      });

      await expect(repository.insert(record())).resolves.toMatchObject({
        evaluationId: evaluation.id,
      });
      await expect(repository.insert(record())).resolves.toBeNull();
    });

    it('borrar el snapshot borra en cascada la evaluación y su exportación', async () => {
      const evaluation = await evaluate();
      await service.create(alice, projectId, approvalOf(evaluation));

      await pool().query(
        'DELETE FROM estadistica_forms.catalog_snapshots WHERE id = $1',
        [snapshotId],
      );

      const { rows } = await pool().query(
        'SELECT count(*)::int AS count FROM estadistica_forms.exports',
      );
      expect(rows[0].count).toBe(0);
    });
  });

  describe('borrados de catalog-import', () => {
    it('borrar la importación devuelve la clave del TSV de su exportación', async () => {
      const evaluation = await evaluate();
      await service.create(alice, projectId, approvalOf(evaluation));
      const [file] = await exportFiles();

      const deleted = await new CatalogImportRepository(prisma).deleteSnapshot(
        ownerId,
        projectId,
        snapshotId,
      );

      expect(deleted.exportArtifactKeys).toEqual([file]);
    });

    it('borrar el proyecto devuelve las claves agrupadas por importación', async () => {
      const first = await evaluate();
      await service.create(alice, projectId, approvalOf(first));
      const otherSnapshot = await insertReadySnapshot(
        pool(),
        projectId,
        mixedCatalog(3),
      );
      snapshotId = otherSnapshot;
      const second = await evaluate();
      const exported = await service.create(
        alice,
        projectId,
        approvalOf(second),
      );

      const { imports: deleted } = await new CatalogImportRepository(
        prisma,
      ).deleteProject(ownerId, projectId);

      const keysOf = (id: string) =>
        deleted.find((item) => item.snapshotId === id)?.exportArtifactKeys;
      expect(deleted).toHaveLength(2);
      expect(keysOf(otherSnapshot)).toHaveLength(1);
      expect(deleted.flatMap((item) => item.exportArtifactKeys).sort()).toEqual(
        (await exportFiles()).sort(),
      );
      expect(exported.created).toBe(true);
    });
  });

  describe('limpieza de huérfanos de exports', () => {
    async function writeOldFile(key: string) {
      const old = (Date.now() - ORPHAN_MIN_AGE_MS - 1000) / 1000;
      await writeFile(join(root, 'exports', key), 'id\n');
      await utimes(join(root, 'exports', key), old, old);
    }

    it('borra solo los TSV antiguos que ninguna exportación referencia', async () => {
      const evaluation = await evaluate();
      await service.create(alice, projectId, approvalOf(evaluation));
      const [referenced] = await exportFiles();
      const old = (Date.now() - ORPHAN_MIN_AGE_MS - 1000) / 1000;
      await utimes(join(root, 'exports', referenced), old, old);
      const orphan = `${randomUUID()}.tsv`;
      await writeOldFile(orphan);
      const recent = `${randomUUID()}.tsv`;
      await writeFile(join(root, 'exports', recent), 'id\n');

      await expect(
        module.get(ExportCleanupService).removeOrphanExports(),
      ).resolves.toBe(1);
      expect((await exportFiles()).sort()).toEqual([referenced, recent].sort());
    });

    it('con autoStart desactivado no limpia al arrancar', async () => {
      const orphan = `${randomUUID()}.tsv`;
      await writeOldFile(orphan);

      await module.get(ExportCleanupService).onApplicationBootstrap();

      expect(await exportFiles()).toEqual([orphan]);
    });

    it('un fallo de la limpieza se registra y no impide arrancar', async () => {
      const failing = new ExportCleanupService(
        module.get(ArtifactStore),
        {
          findReferencedArtifactKeys: async () => {
            throw new Error('sin base');
          },
        } as unknown as ExportsRepository,
        { autoStart: true },
      );
      await writeOldFile(`${randomUUID()}.tsv`);
      const logError = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await expect(failing.onApplicationBootstrap()).resolves.toBeUndefined();
      expect(logError).toHaveBeenCalledWith({
        code: 'EXPORT_ORPHAN_CLEANUP_FAILED',
      });
      logError.mockRestore();
    });
  });
});
