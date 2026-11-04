/** `HH:MM` de 00:00 a 23:59, como lo guarda `refresh_time`. */
export const REFRESH_TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** Longitud máxima de la zona horaria, la misma que limita la base. */
export const TIME_ZONE_MAX_LENGTH = 64;

/** Cuándo se actualiza el feed cada día (D10). */
export type FeedSchedule = Readonly<{
  enabled: boolean;
  refreshTime: string;
  timeZone: string;
}>;

/** Fecha y hora locales de un instante en una zona horaria. */
type LocalDateTime = Readonly<{ date: string; time: string }>;

/**
 * Una zona que `Intl` reconoce: nombres IANA (`Europe/Madrid`, `UTC`) o
 * desplazamientos (`+01:00`). Una inválida hace lanzar `RangeError` al
 * construir el formateador (F36).
 */
export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone.length === 0 || timeZone.length > TIME_ZONE_MAX_LENGTH) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * La fecha local (`AAAA-MM-DD`) de la actualización que toca, o `null` si
 * todavía no es la hora. Se compara `HH:MM` local con la hora programada:
 *
 * - si la hora programada no existe ese día (se adelanta el reloj), la
 *   primera hora local posterior ya la supera y la actualización se dispara;
 * - si se repite (se atrasa el reloj), la clave por fecha local impide una
 *   segunda (`UNIQUE (feed_id, scheduled_for)`).
 */
export function dueLocalDate(
  now: Date,
  schedule: Pick<FeedSchedule, 'refreshTime' | 'timeZone'>,
): string | null {
  const local = localDateTime(now, schedule.timeZone);
  return local.time >= schedule.refreshTime ? local.date : null;
}

/** Siempre con la zona del feed, nunca con la del proceso (F36). */
function localDateTime(now: Date, timeZone: string): LocalDateTime {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';

  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  };
}
