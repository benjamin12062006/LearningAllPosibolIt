export const HEALTH_OPTIONS = Symbol('HEALTH_OPTIONS');

export type HealthOptions = {
  /** Si el monitor de colas revisa solo; las pruebas lo llaman a mano. */
  autoStart: boolean;
  intervalMs: number;
  /** Antigüedad a partir de la cual un trabajo listo se considera atascado. */
  backlogMs: number;
};

/**
 * Cada minuto basta para ver una cola parada; diez minutos de espera ya no son
 * un pico normal: los trabajos tardan segundos (plan jobs&files, D12).
 */
export const HEALTH_DEFAULTS: HealthOptions = Object.freeze({
  autoStart: true,
  intervalMs: 60_000,
  backlogMs: 10 * 60_000,
});

/** Las colas que vigila el monitor. */
export type QueueName = 'imports' | 'evaluations' | 'feed_refreshes' | 'outbox';

/** La cola con trabajo listo esperando más de lo normal. */
export type QueueBacklog = Readonly<{
  queue: QueueName;
  ready: number;
  oldestSeconds: number;
}>;
