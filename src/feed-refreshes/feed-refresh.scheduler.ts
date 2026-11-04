import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { dueLocalDate } from '../feeds/feed-schedule.js';
import {
  FeedRefreshesRepository,
  type ScheduledFeed,
} from './feed-refreshes.repository.js';

/**
 * Encola las actualizaciones diarias que ya tocan (D10). No dispara nada por su
 * cuenta: lo llama el worker en cada pasada, con el mismo intervalo de siempre,
 * y la base decide qué inserción gana. Así no hace falta `@nestjs/schedule` y
 * varias instancias no duplican nada.
 */
@Injectable()
export class FeedRefreshScheduler {
  private readonly logger = new Logger(FeedRefreshScheduler.name);

  constructor(private readonly repository: FeedRefreshesRepository) {}

  /** Devuelve cuántas actualizaciones encoló esta llamada. */
  async enqueueDue(now: Date): Promise<number> {
    const feeds = await this.repository.findScheduledFeeds();
    let enqueued = 0;
    for (const feed of feeds) {
      if (await this.enqueueIfDue(feed, now)) {
        enqueued += 1;
      }
    }
    return enqueued;
  }

  /**
   * Una zona que dejó de ser válida (cambio de la base de datos de zonas de
   * `Intl`) no puede tumbar las demás: se registra y se salta.
   */
  private async enqueueIfDue(feed: ScheduledFeed, now: Date) {
    let scheduledFor: string | null;
    try {
      scheduledFor = dueLocalDate(now, feed);
    } catch {
      this.logger.error({ code: 'FEED_SCHEDULE_INVALID', feedId: feed.feedId });
      return false;
    }
    if (!scheduledFor) {
      return false;
    }
    return this.repository.enqueueScheduled({
      id: randomUUID(),
      feedId: feed.feedId,
      scheduledFor,
      createdAt: now.toISOString(),
    });
  }
}
