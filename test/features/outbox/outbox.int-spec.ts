import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ArtifactStore,
  type FinalFolder,
} from '../../../src/artifacts/artifact.store.js';
import { PrismaService } from '../../../src/database/prisma.service.js';
import { enqueueArtifactsDelete } from '../../../src/outbox/outbox-events.js';
import { OutboxRelay } from '../../../src/outbox/outbox.relay.js';
import { OutboxRepository } from '../../../src/outbox/outbox.repository.js';
import {
  OUTBOX_DEFAULTS,
  type OutboxOptions,
} from '../../../src/outbox/outbox.types.js';
import { createTestDatabase } from '../support/test-database.js';

/** Esperas de 1 ms y tres intentos: un reintento está listo casi al instante. */
const OPTIONS: OutboxOptions = {
  ...OUTBOX_DEFAULTS,
  autoStart: false,
  shutdownMs: 1,
  retry: { baseDelayMs: 1, maxDelayMs: 1, maxAttempts: 3 },
};

const EXTENSION: Record<FinalFolder, string> = {
  artifacts: 'csv',
  exports: 'tsv',
  feeds: 'tsv',
};

describe('Outbox: eventos en la transacción y relay idempotente (jobs&files E4)', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let prisma: PrismaService;
  let repository: OutboxRepository;
  let store: ArtifactStore;
  let root: string;

  const pool = () => database.connection.pool;

  /** Un archivo guardado en una carpeta final; devuelve su clave. */
  async function storedFile(folder: FinalFolder) {
    const key = `${randomUUID()}.${EXTENSION[folder]}`;
    await writeFile(join(root, folder, key), 'contenido');
    return key;
  }

  async function exists(folder: FinalFolder, key: string) {
    try {
      await access(join(root, folder, key));
      return true;
    } catch {
      return false;
    }
  }

  /** Inserta el evento en una transacción confirmada, como haría una feature. */
  async function enqueueCommitted(folder: FinalFolder, keys: string[]) {
    await prisma.$transaction((tx) => enqueueArtifactsDelete(tx, folder, keys));
  }

  async function events() {
    const { rows } = await pool().query<{
      id: string;
      type: string;
      status: string;
      attempts: number;
      payload: unknown;
      error: { code: string } | null;
    }>(
      `SELECT id, type, status, attempts, payload, error
       FROM estadistica_forms.outbox_events
       ORDER BY created_at, id`,
    );
    return rows;
  }

  async function expireLeases() {
    await pool().query(
      `UPDATE estadistica_forms.outbox_events
       SET lease_until = now() - interval '1 second'
       WHERE status = 'running'`,
    );
  }

  async function makeReady() {
    await pool().query(
      `UPDATE estadistica_forms.outbox_events SET run_after = NULL WHERE status = 'pending'`,
    );
  }

  function relayWith(source: ArtifactStore = store) {
    return new OutboxRelay(repository, source, OPTIONS);
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    prisma = new PrismaService(database.connection);
    await prisma.onModuleInit();
    repository = new OutboxRepository(prisma);
    root = await mkdtemp(join(tmpdir(), 'outbox-'));
    store = new ArtifactStore({ root });
    await store.onModuleInit();
  });

  beforeEach(async () => {
    await pool().query('TRUNCATE estadistica_forms.outbox_events');
  });

  afterAll(async () => {
    try {
      await prisma?.onModuleDestroy();
    } finally {
      await database?.close();
      if (root) await rm(root, { recursive: true, force: true });
    }
  });

  describe('en la transacción del llamante', () => {
    it('si la transacción se deshace, el evento tampoco existe', async () => {
      const key = await storedFile('exports');

      await expect(
        prisma.$transaction(async (tx) => {
          await enqueueArtifactsDelete(tx, 'exports', [key]);
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');

      expect(await events()).toEqual([]);
    });

    it('si confirma, queda pendiente con la carpeta y las claves', async () => {
      const key = await storedFile('feeds');
      await enqueueCommitted('feeds', [key]);

      expect(await events()).toEqual([
        expect.objectContaining({
          type: 'artifacts.delete',
          status: 'pending',
          attempts: 0,
          payload: { folder: 'feeds', keys: [key] },
        }),
      ]);
    });

    it('sin claves no guarda nada', async () => {
      await enqueueCommitted('artifacts', []);

      expect(await events()).toEqual([]);
    });
  });

  describe('relay', () => {
    it('borra los archivos de cada carpeta y marca los eventos como hechos', async () => {
      const csv = await storedFile('artifacts');
      const tsv = await storedFile('exports');
      const version = await storedFile('feeds');
      await enqueueCommitted('artifacts', [csv]);
      await enqueueCommitted('exports', [tsv]);
      await enqueueCommitted('feeds', [version]);

      await relayWith().deliverNow();

      expect(await exists('artifacts', csv)).toBe(false);
      expect(await exists('exports', tsv)).toBe(false);
      expect(await exists('feeds', version)).toBe(false);
      expect((await events()).map((event) => event.status)).toEqual([
        'done',
        'done',
        'done',
      ]);
    });

    it('entregar dos veces (cae tras el efecto y antes de marcarlo) deja un solo efecto y termina', async () => {
      const key = await storedFile('exports');
      await enqueueCommitted('exports', [key]);
      const first = await repository.claim(OPTIONS.leaseMs);
      if (!first) throw new Error('Falta el evento');
      await store.removeStored('exports', key);
      await expireLeases();

      await relayWith().runUntilIdle();
      await makeReady();
      await relayWith().runUntilIdle();

      expect(await exists('exports', key)).toBe(false);
      expect(await events()).toEqual([
        expect.objectContaining({ status: 'done', attempts: 1 }),
      ]);
      expect(await repository.complete(first)).toBe(false);
    });

    it('un archivo que ya no existe cuenta como borrado', async () => {
      await enqueueCommitted('feeds', [`${randomUUID()}.tsv`]);

      await relayWith().deliverNow();

      expect(await events()).toEqual([
        expect.objectContaining({ status: 'done' }),
      ]);
    });

    it('si el disco falla, reintenta con espera y al agotar los intentos queda failed', async () => {
      const key = await storedFile('artifacts');
      await enqueueCommitted('artifacts', [key]);
      const broken = Object.create(store) as ArtifactStore;
      broken.removeStored = () =>
        Promise.reject(Object.assign(new Error('EIO'), { code: 'EIO' }));

      await relayWith(broken).runUntilIdle();
      expect(await events()).toEqual([
        expect.objectContaining({ status: 'pending', attempts: 1 }),
      ]);

      for (
        let attempt = 2;
        attempt <= OPTIONS.retry.maxAttempts;
        attempt += 1
      ) {
        await makeReady();
        await relayWith(broken).runUntilIdle();
      }

      expect(await events()).toEqual([
        expect.objectContaining({
          status: 'failed',
          attempts: OPTIONS.retry.maxAttempts,
          error: { code: 'ARTIFACT_DELETE_FAILED' },
        }),
      ]);
      expect(await exists('artifacts', key)).toBe(true);
    });

    it('un evento mal formado termina sin reintentos', async () => {
      await pool().query(
        `INSERT INTO estadistica_forms.outbox_events (id, type, payload, created_at)
         VALUES ($1, 'artifacts.delete', '{"folder":"../etc","keys":["x"]}', $2)`,
        [randomUUID(), new Date().toISOString()],
      );

      await relayWith().runUntilIdle();

      expect(await events()).toEqual([
        expect.objectContaining({
          status: 'failed',
          attempts: 1,
          error: { code: 'OUTBOX_PAYLOAD_INVALID' },
        }),
      ]);
    });

    it('un lease vencido se recupera como fallo temporal y el token viejo no termina', async () => {
      const key = await storedFile('exports');
      await enqueueCommitted('exports', [key]);
      const stale = await repository.claim(OPTIONS.leaseMs);
      if (!stale) throw new Error('Falta el evento');
      await expireLeases();

      expect(await repository.recoverExpiredLeases(OPTIONS.retry)).toBe(1);
      expect(await events()).toEqual([
        expect.objectContaining({ status: 'pending', attempts: 1 }),
      ]);
      expect(await repository.complete(stale)).toBe(false);
      expect(await repository.fail(stale, 1, 'X')).toBe(false);
    });

    it('al apagar termina el borrado en curso y no reclama el siguiente', async () => {
      await enqueueCommitted('feeds', [await storedFile('feeds')]);
      await enqueueCommitted('feeds', [await storedFile('feeds')]);
      let entered!: () => void;
      const deleting = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const slow = Object.create(store) as ArtifactStore;
      slow.removeStored = (folder, key) => {
        entered();
        return new Promise((resolve) => setTimeout(resolve, 50)).then(() =>
          store.removeStored(folder, key),
        );
      };
      const relay = relayWith(slow);

      const pass = relay.runUntilIdle();
      await deleting;
      await relay.onModuleDestroy();
      await pass;

      expect((await events()).map((event) => event.status)).toEqual([
        'done',
        'pending',
      ]);
    });
  });

  describe('restricciones de la base', () => {
    it('solo admite los tipos conocidos y un payload objeto', async () => {
      await expect(
        pool().query(
          `INSERT INTO estadistica_forms.outbox_events (id, type, payload, created_at)
           VALUES ($1, 'email.send', '{}', $2)`,
          [randomUUID(), new Date().toISOString()],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        pool().query(
          `INSERT INTO estadistica_forms.outbox_events (id, type, payload, created_at)
           VALUES ($1, 'artifacts.delete', '[]', $2)`,
          [randomUUID(), new Date().toISOString()],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('failed exige error y fecha de proceso', async () => {
      await enqueueCommitted('feeds', [`${randomUUID()}.tsv`]);
      await expect(
        pool().query(
          `UPDATE estadistica_forms.outbox_events SET status = 'failed'`,
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });
});
