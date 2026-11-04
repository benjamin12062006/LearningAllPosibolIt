# 06 — Programación diaria (E6)

Fecha de creación: 2026-11-03  
Última actualización: 2026-11-03 (etapa cerrada)  
Estado: Implementado y verificado en local. Migración `20261103000400_add_feed_schedule` **aplicada en Neon** el 2026-11-03 a petición del usuario («aplica las dos»). `db:migrate` aplicó también, en la misma ejecución, `20261103090000_add_organization_archived_at` y `20261103100000_create_worksheets`, de otras sesiones. La segunda apareció entre la pregunta y la respuesta del usuario. Las tres son aditivas (sin `INSERT`, `UPDATE` ni `DELETE`), y Neon estaba vacía. Después, `pnpm db:status` → «Database schema is up to date!», 19 migraciones.  
Ámbito: etapa E6 del [plan 01](../../../docs/plans/feature/feeds&publications/01-plan-feeds-y-publicaciones.md): columnas y `PUT …/feeds/:feedId/schedule`, cálculo de la hora local con reloj inyectado y encolado diario idempotente en el worker (D10).  
Relacionada con: [plan 01](../../../docs/plans/feature/feeds&publications/01-plan-feeds-y-publicaciones.md), [bitácora 05](05-politica-y-publicacion-automatica.md), [fuentes de E6](../../../docs/fonts/feature/feeds&publications/08-hora-local-y-zona-horaria.md), [fuentes técnicas](../../../docs/fonts/feature/feeds&publications/02-fuentes-tecnicas.md) (F15), [cursos y reconstrucciones](../../../docs/fonts/feature/feeds&publications/03-cursos-y-reconstrucciones.md) (RC2, RC3).  
Revisión de partida: `f6b4bf9` con los cambios sin commit de E1–E5. Línea base: 51 suites y 932 pruebas en verde.

## Necesidad y punto de partida

El usuario pidió aplicar la migración de E5 en Neon (hecho; ver la [bitácora 05](05-politica-y-publicacion-automatica.md)) y seguir con E6. Investigación de la etapa: [ficha 08](../../../docs/fonts/feature/feeds&publications/08-hora-local-y-zona-horaria.md) (`Intl.DateTimeFormat`, zona y `hourCycle`).

## Evidencia y decisiones

| Decisión | Evidencia | Aplicación |
| --- | --- | --- |
| Sin `@nestjs/schedule` (D10) | F15 (el programador dispara en cada proceso), RC2 | El worker existente, al empezar cada pasada, llama a `FeedRefreshScheduler.enqueueDue(clock())`. Un solo sitio conoce el horario. |
| Una actualización por feed y fecha local | F15, D10 | `UNIQUE (feed_id, scheduled_for)` e `INSERT … ON CONFLICT DO NOTHING`. Varias instancias o varios ticks lo intentan y solo una inserción gana. El mismo `ON CONFLICT` respeta el índice de «una activa por feed»: si hay una manual en curso, la programada se encola en un tick posterior del mismo día. |
| Hora local en la zona del feed | F36 | `dueLocalDate(now, schedule)` con `Intl.DateTimeFormat` (`hourCycle: 'h23'`, `formatToParts`), nunca con la zona del proceso. |
| Cambios de hora | F36, D10 | Probado en `Europe/Madrid`. El 29-03-2026 las 02:30 no existen y se dispara a las 03:00. El 25-10-2026 las 02:30 pasan dos veces y caen en la misma fecha local, que la clave única no deja duplicar. |
| Reloj inyectado | RC3 (el curso esperaba 2 s reales) | `FeedRefreshOptions.clock`. Las pruebas usan instantes fijos, sin esperar. |
| Solo feeds completos | D10, D11 | Se programan los feeds con `refresh_enabled`, fuente y política. |
| Validación de la zona | F36 | `isValidTimeZone` intenta construir un formateador (`RangeError` = inválida) y la usa también el DTO. Si una zona guardada deja de ser válida, se registra `FEED_SCHEDULE_INVALID` y se salta ese feed sin tumbar los demás. |

### Ajustes al escribir el código (marcados «en E6» en el plan)

- **Las funciones de hora viven en `src/feeds/feed-schedule.ts`** y no en `feed-refreshes`: el DTO del feed las necesita y la dependencia va de `feed-refreshes` hacia `feeds`, nunca al revés.
- **Los tres campos del `PUT` son obligatorios**, también para desactivar: así la hora y la zona se conservan para volver a activarla.
- **La vista de una actualización gana `scheduledFor`**, nula si se disparó a mano.
- **El constructor del worker recibe el programador**, y las opciones, el reloj. Las pruebas de E4–E5 se adaptaron a ambas cosas.

## Implementación y funcionamiento

- [migration.sql](../../../prisma/migrations/20261103000400_add_feed_schedule/migration.sql):
  - en `feeds`: `refresh_enabled`, `refresh_time` (`HH:MM`) y `time_zone` (1–64), con el `CHECK` de «hora y zona juntas; activar exige hora»;
  - en `feed_refreshes`: `scheduled_for` (`AAAA-MM-DD`) y el índice único `(feed_id, scheduled_for)`.
- [src/feeds/](../../../src/feeds/):
  - `feed-schedule.ts` (`isValidTimeZone`, `dueLocalDate`);
  - `UpdateFeedScheduleDto` y `PUT …/schedule`;
  - `FeedsService.setSchedule` y `FeedsRepository.setSchedule`;
  - `schedule` en la vista del feed.
- [src/feed-refreshes/](../../../src/feed-refreshes/):
  - `feed-refresh.scheduler.ts`;
  - `findScheduledFeeds` y `enqueueScheduled` en el repositorio;
  - la llamada al principio de cada pasada del worker;
  - `clock` en las opciones.

## Comprobación

| Comprobación | Resultado |
| --- | --- |
| Pruebas nuevas de E6 | 18: 6 unitarias de la hora local y la zona, 8 de integración (encolado una vez por fecha, día siguiente, generación guardada, desactivada o sin política, actualización manual activa, zona inválida, pasada del worker con reloj y restricciones en la base) y 4 E2E de `PUT …/schedule`. |
| Suite completa | 54 suites y 966 pruebas en verde. Incluye las pruebas nuevas de la sesión de organizaciones, que siguió trabajando en la carpeta. |
| `tsc --noEmit`, `pnpm lint`, `prettier --check` | Sin errores. |
| Esquema frente a migraciones; `pnpm db:verify` | «This is an empty migration»; 3/3. |
| Arranque real con el worker encendido | `PUT …/schedule` responde `401` sin sesión; el worker encola y reclama sin errores registrados. |
| Defectos a propósito | 10 de 10 detectados, con restauración comprobada. |

Los defectos fueron:

- S1, la hora exacta no cuenta;
- S2, hora calculada en UTC;
- S3, sin `ON CONFLICT`;
- S4, feeds sin política;
- S5, feeds desactivados;
- S6, sin índice único;
- S7, el worker no encola;
- S8, una zona inválida tumba el encolado;
- S9, el DTO no valida la zona;
- S10, activar sin hora.

**Lo que pasó durante los defectos.** En la primera ronda, S4–S10 dieron «no compila». No era por los defectos: la sesión de organizaciones estaba editando la carpeta a la vez (migración `20261103090000_add_organization_archived_at`, `schema.prisma`, `error-codes.ts`, `messages.ts` y `src/organizations/`). Las sumas lo mostraron, porque las diferencias eran solo de esos archivos. Se repitieron con el árbol estable. La primera versión de S8 tampoco probaba nada: un `return` en `finally` anulaba el error. Se reescribió quitando el `try/catch`.

## Consecuencias y continuidad

- **Neon:** aplicada. Si las sesiones de organizaciones o de hojas de cálculo cambian ahora sus migraciones ya aplicadas, Prisma detectará la diferencia: tendrán que crear migraciones nuevas en lugar de editar las aplicadas.
- **Una sola instancia** para importación y evaluación (R1 del plan). La programación ya admite varias.
- **Siguiente:** E7 (estado y cierre documental: `lastRefresh` en el feed y actualización de docs-diagrams).
