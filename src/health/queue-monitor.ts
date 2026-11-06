import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import {
  HEALTH_OPTIONS,
  type HealthOptions,
  type QueueBacklog,
  type QueueName,
} from './health.types.js';

type QueueAgeRow = { queue: QueueName; ready: number; oldestSeconds: number };

/**
 * Avisa en el registro cuando una cola tiene trabajo listo esperando demasiado
 * (plan jobs&files, D12): importaciones, evaluaciones, actualizaciones del feed
 * y outbox. Lee las cuatro tablas, así que vive aquí y no en ninguna de esas
 * features. Solo ids y cifras, nunca datos del catálogo.
 */
@Injectable()
export class QueueMonitor implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(QueueMonitor.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(HEALTH_OPTIONS) private readonly options: HealthOptions,
  ) {}

  onApplicationBootstrap() {
    if (this.options.autoStart) {
      this.timer = setInterval(
        () => void this.check(),
        this.options.intervalMs,
      );
      this.timer.unref();
    }
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** Registra un aviso por cada cola atascada y las devuelve. */
  async check(): Promise<QueueBacklog[]> {
    let backlogs: QueueBacklog[];
    try {
      backlogs = await this.findBacklogs();
    } catch {
      this.logger.error({ code: 'QUEUE_MONITOR_UNAVAILABLE' });
      return [];
    }
    for (const backlog of backlogs) {
      this.logger.warn({ code: 'QUEUE_BACKLOG', ...backlog });
    }
    return backlogs;
  }

  /**
   * Por cada cola, cuántos trabajos están listos y desde cuándo espera el más
   * antiguo: desde que se creó o, si es un reintento, desde que le tocó.
   */
  async findBacklogs(): Promise<QueueBacklog[]> {
    const rows = await this.prisma.$queryRaw<QueueAgeRow[]>`
      SELECT
        queue,
        count(*)::int AS ready,
        extract(epoch FROM now() - min(ready_since))::float AS "oldestSeconds"
      FROM (
        SELECT 'imports' AS queue,
          COALESCE(run_after, created_at::timestamptz) AS ready_since
        FROM estadistica_forms.catalog_import_jobs
        WHERE status = 'queued'
          AND (run_after IS NULL OR run_after <= now())
        UNION ALL
        SELECT 'evaluations',
          COALESCE(run_after, created_at::timestamptz)
        FROM estadistica_forms.evaluations
        WHERE status = 'queued'
          AND (run_after IS NULL OR run_after <= now())
        UNION ALL
        SELECT 'feed_refreshes', run_after
        FROM estadistica_forms.feed_refreshes
        WHERE status IN ('queued', 'retry_wait')
          AND run_after <= now()
        UNION ALL
        SELECT 'outbox',
          COALESCE(run_after, created_at::timestamptz)
        FROM estadistica_forms.outbox_events
        WHERE status = 'pending'
          AND (run_after IS NULL OR run_after <= now())
      ) ready_work
      GROUP BY queue
      ORDER BY queue`;
    const backlogSeconds = this.options.backlogMs / 1000;
    return rows.filter((row) => row.oldestSeconds >= backlogSeconds);
  }
}
