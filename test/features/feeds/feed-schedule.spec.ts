import { describe, expect, it } from '@jest/globals';
import {
  dueLocalDate,
  isValidTimeZone,
} from '../../../src/feeds/feed-schedule.js';

const madrid = (refreshTime: string) => ({
  refreshTime,
  timeZone: 'Europe/Madrid',
});

describe('Programación diaria: zona horaria y hora local (D10, F36)', () => {
  it('reconoce zonas IANA y desplazamientos; rechaza el resto', () => {
    for (const zone of [
      'Europe/Madrid',
      'UTC',
      'America/Mexico_City',
      '+01:00',
    ]) {
      expect(isValidTimeZone(zone)).toBe(true);
    }
    for (const zone of ['Mars/Phobos', '', 'Madrid', 'a'.repeat(65)]) {
      expect(isValidTimeZone(zone)).toBe(false);
    }
  });

  it('antes de la hora local no toca; a la hora y después, sí', () => {
    // Noviembre: Madrid está en UTC+1.
    expect(
      dueLocalDate(new Date('2026-11-03T04:59:00Z'), madrid('06:00')),
    ).toBeNull();
    expect(
      dueLocalDate(new Date('2026-11-03T05:00:00Z'), madrid('06:00')),
    ).toBe('2026-11-03');
    expect(
      dueLocalDate(new Date('2026-11-03T22:59:00Z'), madrid('06:00')),
    ).toBe('2026-11-03');
  });

  it('la fecha es la local, no la de UTC', () => {
    // 03:00 UTC del 4 son las 21:00 del 3 en Ciudad de México (UTC−6).
    expect(
      dueLocalDate(new Date('2026-11-04T03:00:00Z'), {
        refreshTime: '20:00',
        timeZone: 'America/Mexico_City',
      }),
    ).toBe('2026-11-03');
    // Pasada la medianoche local, empieza otro día y aún no es la hora.
    expect(
      dueLocalDate(new Date('2026-11-03T23:30:00Z'), madrid('06:00')),
    ).toBeNull();
  });

  it('si la hora no existe ese día (se adelanta el reloj), se dispara a la siguiente', () => {
    // 29-03-2026 en Madrid: de 01:59 se pasa a 03:00; las 02:30 no existen.
    expect(
      dueLocalDate(new Date('2026-03-29T00:59:00Z'), madrid('02:30')),
    ).toBeNull();
    expect(
      dueLocalDate(new Date('2026-03-29T01:00:00Z'), madrid('02:30')),
    ).toBe('2026-03-29');
  });

  it('si la hora se repite (se atrasa el reloj), las dos caen en la misma fecha', () => {
    // 25-10-2026 en Madrid: las 02:30 pasan dos veces (CEST y CET). La clave
    // por fecha local hace que solo se encole una actualización.
    const first = dueLocalDate(
      new Date('2026-10-25T00:30:00Z'),
      madrid('02:30'),
    );
    const second = dueLocalDate(
      new Date('2026-10-25T01:30:00Z'),
      madrid('02:30'),
    );
    expect(first).toBe('2026-10-25');
    expect(second).toBe('2026-10-25');
  });

  it('una zona inválida lanza RangeError al calcular', () => {
    expect(() =>
      dueLocalDate(new Date(), {
        refreshTime: '06:00',
        timeZone: 'Mars/Phobos',
      }),
    ).toThrow(RangeError);
  });
});
