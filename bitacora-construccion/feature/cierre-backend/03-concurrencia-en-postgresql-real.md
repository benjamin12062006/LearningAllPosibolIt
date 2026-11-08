# 03 — C3: concurrencia probada en PostgreSQL real

Fecha de creación: 2026-11-08  
Última actualización: 2026-11-08  
Estado: Implementado y verificado.  
Relacionada con: [plan 01 de cierre](../../../docs/plans/feature/cierre-backend/01-plan-cierre-de-pendientes.md) (P4, P8), [fuentes 01](../../../docs/fonts/feature/cierre-backend/01-estado-de-los-pendientes.md) (E3), [bitácora C2](02-crear-proyecto-una-sola-vez.md), [bitácora 01 de changesets](../changesets/01-nucleo-de-borradores-y-pruebas.md) («Concurrencia real pendiente»).  
Revisión de partida: `main` `c280506` más C1 y C2 sin commit.

## Necesidad

PGlite ejecuta una transacción cada vez: dos peticiones simultáneas nunca compiten y los bloqueos (`FOR UPDATE`) no se ponen a prueba. [18] pide PostgreSQL real con varias conexiones para T03, T07 y T09 (T24 es de E8), y C2 dejó sin probar el bloqueo del doble clic.

## Decisiones concretas (sobre P4 y P8)

- **Contenedor local** `postgres:15.2` (la imagen ya está descargada: no se baja nada), con `--cpus 2 --memory 1g`, escuchando solo en `127.0.0.1:55432`. Lo arranca y lo para un script (`pnpm test:features:postgres`); si el script falla a medias, el contenedor se para igual (`--rm` y `docker stop` en `finally`).
- **Una base nueva por suite** dentro del contenedor (`CREATE DATABASE` con nombre aleatorio y `prisma migrate deploy`), que se borra al terminar.
- **Las pruebas solo se ejecutan con `TEST_POSTGRES_URL`**, que tiene que apuntar a `127.0.0.1`. En la batería normal se saltan: siguen corriendo en PGlite y no necesitan Docker.
- **Qué compite:**
  - T07: dos guardados con la misma `draftVersion`, uno gana y el otro recibe `CHANGESET_VERSION_MISMATCH`;
  - T09: dos `apply` de borradores distintos sobre la misma base, uno aplica y el otro no, sin perder su diff;
  - el mismo `apply` dos veces a la vez con la misma clave: una revisión y el mismo resultado;
  - T03: quitar el permiso a quien aplica mientras aplica, donde manda la transacción que gana;
  - el doble clic de C2: un proyecto y dos 201.

## Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| E3 de la ficha; [18], línea 100: «PGlite no demuestra locks, pools o varias réplicas» | Contenedor local solo para estas pruebas, con límites (P8) | [`scripts/testing/postgres-features.mjs`](../../../scripts/testing/postgres-features.mjs) y `pnpm test:features:postgres` |
| `createTestDatabase` usa PGlite y aplica las migraciones con `prisma migrate deploy` | Mismo procedimiento sobre una base nueva del contenedor | [`postgres-database.ts`](../../../test/features/support/postgres-database.ts): `postgresTestUrl`, `createPostgresDatabase` |
| T03, T07 y T09 de [18]; C2 sin probar el bloqueo | Diez rondas por carrera, con dos transacciones a la vez | [`postgres-concurrency.int-spec.ts`](../../../test/features/concurrency/postgres-concurrency.int-spec.ts) |

## Ajustes al escribir el código

- **Esperar al contenedor por TCP desde fuera.** La imagen inicializa la base con un servidor que solo escucha en su socket interno y después se reinicia: preguntar desde dentro del contenedor daría «listo» demasiado pronto.
- **El pool se cierra una sola vez**, igual que en el ayudante de PGlite: Prisma y `close` cierran el mismo pool y `pg` falla si se cierra dos veces.
- **T03 solo comprueba que cada ronda acabe en uno de los dos órdenes válidos:** si `apply` gana, la revisión existe; si gana el cambio de rol, `apply` da `FORBIDDEN`, no escribe nada y el borrador sigue aprobado. No distingue «aplicó antes de perder el permiso» de «aplicó con un permiso ya caducado», porque el cambio de rol no deja marca de tiempo; el orden lo garantiza que las dos transacciones bloquean primero la organización.
- **Quien aprueba en T03 es Alice cuando todavía es la única de la empresa**; Bob entra como manager después, para no cruzarse con las reglas de autoaprobación.

## Implementación

- `scripts/testing/postgres-features.mjs` (nuevo):
  - arranca `postgres:15.2` con `--cpus 2 --memory 1g`, `--rm` y solo en `127.0.0.1:55432`;
  - espera a que responda;
  - compila y ejecuta Jest en serie con `TEST_POSTGRES_URL` (por defecto, solo `postgres-concurrency`; se pueden pasar otros patrones);
  - para el contenedor en `finally`.
- `package.json`: script `test:features:postgres`.
- `test/features/support/postgres-database.ts` (nuevo): solo acepta `127.0.0.1`; una base `estadistica_test_<uuid>` por suite, con migraciones, que se borra al cerrar.
- `test/features/concurrency/postgres-concurrency.int-spec.ts` (nuevo): 5 pruebas; sin `TEST_POSTGRES_URL` se saltan (`describe.skip`).
- Sin cambios en `src/`: los bloqueos que se prueban ya existían.

## Comprobaciones realmente ejecutadas

2026-11-08, OrbStack 29.8.2, `postgres:15.2`.

- `pnpm test:features:postgres`: **5 de 5** en 17,6 s, incluidos arrancar y parar el contenedor. Después, `docker ps` sin contenedores.
  - T07: dos guardados con la misma versión;
  - T09: dos `apply` de borradores distintos;
  - el mismo `apply` dos veces con la misma clave;
  - T03: revocación frente a `apply`;
  - el doble clic de C2.
- **Batería normal** (`pnpm test:features`, PGlite): 86 suites pasan y 1 se salta; 1.449 pruebas pasan y 5 se saltan, como estaba previsto.
- `tsc` (código y pruebas), `pnpm lint` y `prettier --check src test/features scripts/testing`: limpios.
- **Defectos a propósito**, cada uno en una copia limpia y con su propio contenedor, uno detrás de otro:

  | Defecto | Lo detecta |
  | --- | --- |
  | C3a crear proyecto sin bloquear la organización (el defecto que C2 no detectaba) | Doble clic |
  | C3b sin `FOR UPDATE` en la organización ni en el borrador | T07 y otras dos |
  | C3c sin `FOR UPDATE` en la organización ni en la cabecera de la hoja | T09 y otras dos |
  | C3d sin comprobar la versión del borrador | T07 |
  | C3e `apply` sin mirar el recibo | Mismo `apply` con la misma clave |

  Los cinco detectados; restaurado, 5 de 5.

## Consecuencias

- La concurrencia de E4 (bitácora 01 de changesets) y el bloqueo de C2 ya están probados con conexiones reales.
- El contenedor y las pruebas sirven para C4 (medir la importación en PostgreSQL) y para C6.
- Requiere tener OrbStack en marcha; sin él, `pnpm test:features:postgres` falla al arrancar el contenedor, y la batería normal no se ve afectada.
