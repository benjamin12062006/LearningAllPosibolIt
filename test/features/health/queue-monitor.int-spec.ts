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
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../src/database/prisma.service.js';
import { QueueMonitor } from '../../../src/health/queue-monitor.js';
import { createTestDatabase } from '../support/test-database.js';

const TEN_MINUTES_MS = 10 * 60_000;

describe('QueueMonitor: colas atascadas (jobs&files E6, D12)', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let prisma: PrismaService;
  let monitor: QueueMonitor;

  const pool = () => database.connection.pool;
  const minutesAgo = (minutes: number) =>
    new Date(Date.now() - minutes * 60_000).toISOString();

  /** Un evento del outbox creado hace `minutes`, listo o con reintento pendiente. */
  async function outboxEvent(minutes: number, runAfter: string | null = null) {
    await pool().query(
      `INSERT INTO estadistica_forms.outbox_events (id, type, payload, created_at, run_after)
       VALUES ($1, 'artifacts.delete', '{"folder":"feeds","keys":[]}', $2, $3::timestamptz)`,
      [randomUUID(), minutesAgo(minutes), runAfter],
    );
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    prisma = new PrismaService(database.connection);
    await prisma.onModuleInit();
    monitor = new QueueMonitor(prisma, {
      autoStart: false,
      intervalMs: 60_000,
      backlogMs: TEN_MINUTES_MS,
    });
  });

  beforeEach(async () => {
    await pool().query('TRUNCATE estadistica_forms.outbox_events');
  });

  afterAll(async () => {
    try {
      await prisma?.onModuleDestroy();
    } finally {
      await database?.close();
    }
  });

  it('sin trabajo esperando no avisa', async () => {
    await outboxEvent(1);

    expect(await monitor.findBacklogs()).toEqual([]);
  });

  it('avisa de la cola cuyo trabajo listo más antiguo pasa del umbral, con cuántos hay', async () => {
    await outboxEvent(30);
    await outboxEvent(2);

    expect(await monitor.findBacklogs()).toEqual([
      {
        queue: 'outbox',
        ready: 2,
        oldestSeconds: expect.any(Number),
      },
    ]);
    const [backlog] = await monitor.findBacklogs();
    expect(backlog.oldestSeconds).toBeGreaterThanOrEqual(29 * 60);
  });

  it('un reintento que todavía no toca no cuenta como atascado ni como listo', async () => {
    const inAnHour = new Date(Date.now() + 60 * 60_000).toISOString();
    await outboxEvent(30, inAnHour);
    expect(await monitor.findBacklogs()).toEqual([]);

    await outboxEvent(20);
    expect(await monitor.findBacklogs()).toEqual([
      expect.objectContaining({ queue: 'outbox', ready: 1 }),
    ]);
  });

  it('un reintento cuenta desde que le tocó, no desde que se creó', async () => {
    await outboxEvent(120, minutesAgo(1));

    expect(await monitor.findBacklogs()).toEqual([]);
  });

  it('check registra QUEUE_BACKLOG con la cola y las cifras', async () => {
    await outboxEvent(30);
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await monitor.check();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'QUEUE_BACKLOG',
        queue: 'outbox',
        ready: 1,
      }),
    );
    warn.mockRestore();
  });

  it('recorre también importaciones, evaluaciones y actualizaciones sin fallar', async () => {
    await expect(monitor.findBacklogs()).resolves.toEqual([]);
  });
});
