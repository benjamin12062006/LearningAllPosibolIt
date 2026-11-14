# 01 — Plan: ejecución durable, outbox, recibos y archivos (E2 de la ampliación)

Fecha de creación: 2026-11-05  
Última actualización: 2026-11-05 (plan cerrado)  
Estado: E1–E4, E6 y E7 implementadas y verificadas en local ([bitácoras 01–06](../../../../bitacora-construccion/feature/jobs&files/)); E5 absorbida por la E4 de borradores. **Plan cerrado.** Commit `e6c6bff`; migraciones de E2–E4 aplicadas en Neon el 2026-11-05.  
Ámbito: `LearningAllPosibolIt`, solo backend y REST. E2 de [docs-diagrams/18](../../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md) («Ejecución y archivos»). No confundir con la E2 del plan de feeds.  
Relacionada con: fichas [01](../../../fonts/feature/jobs&files/01-estado-real-y-antecedentes.md), [02](../../../fonts/feature/jobs&files/02-fuentes-tecnicas-y-cursos.md) y [03](../../../fonts/feature/jobs&files/03-mapa-de-necesidades-para-el-plan.md); [plan de feeds](../feeds&publications/01-plan-feeds-y-publicaciones.md) (D2–D4: lease y reintentos); [docs-diagrams/17](../../../../../docs-diagrams/17-trabajos-integraciones-operacion-y-expansion.md) y [13](../../../../../docs-diagrams/13-revisiones-aprobaciones-y-conflictos.md).  
Revisión de referencia: `612b745` (`feature/feeds-publications`), con cambios sin commit de organizaciones y hojas de cálculo que este plan no toca.

## Objetivo

1. Un reinicio, un apagado o una segunda instancia **no pierden ni rompen** importaciones ni evaluaciones: se reanudan solas, y un proceso con el lease vencido no puede escribir (T30).
2. Un efecto que ocurre fuera de la base (hoy, borrar archivos) se registra **en la misma transacción** que lo provoca y se ejecuta después, aunque el proceso caiga entre medias, sin repetir el efecto (T31).
3. Un `POST` repetido con la misma `Idempotency-Key` devuelve el resultado de la primera vez sin repetir la operación. E4 podrá guardar su recibo dentro de su propia transacción.
4. Cada petición lleva su `requestId` de principio a fin, hay una ruta de salud y una cola atascada se avisa en el registro.

Estará completo cuando las siete etapas estén cerradas con sus pruebas (unitarias, PGlite y E2E con dos propietarios), los defectos a propósito se detecten y la batería completa siga en verde.

## Punto de partida

Ficha [01](../../../fonts/feature/jobs&files/01-estado-real-y-antecedentes.md):

- tres workers con el mismo bucle (E1);
- importación y evaluación con `interruptRunning`, que mata lo que esté `running` al arrancar (E2, E3);
- feeds ya resolvió el lease, el token, el reloj de la base y los reintentos en PostgreSQL (E4);
- no hay Redis (E5);
- los archivos se borran después del commit «a lo mejor» (E6) y la limpieza solo corre al arrancar (E7);
- no hay recibos (E9);
- el `requestId` solo existe en los errores (E10).

## Decisiones

| Id | Necesidad | Decisión | Respaldo |
| --- | --- | --- | --- |
| D1 | N1 transporte | **La cola sigue en PostgreSQL; no se añade BullMQ ni Redis.** 17 permite reutilizar una ejecución durable que ya pase las pruebas, y la de feeds lo hace. Redis añadiría infraestructura, coste y el fallo «Redis caído», sin un problema presente que lo pida: 5.000 filas por trabajo y una o pocas instancias. Lo que queda preparado: cada trabajo es una fila con lease y token, y el bucle común (D2) es el único sitio que habría que cambiar para leer de otra cola. Se revisará si una medición muestra que la cola en la base limita (17, SLO). | H2, H8, E4, E5, F1, F6 |
| D2 | N2 bucle | `WorkerLoop` en `src/jobs/worker-loop.ts`: temporizador, `wake`, `runUntilIdle`, apagado con espera y aborto, y la señal del trabajo activo. Cada worker **lo compone** (no hereda) y aporta su «pasada». Sin cambio de comportamiento: las pruebas de los tres workers no cambian. | E1; regla 5 de la skill de legibilidad («un objeto pequeño… mejor que varias funciones sueltas») |
| D3 | N3, N4 | SQL de lease común en `src/jobs/lease-sql.ts`: `nowPlus(ms)` con el reloj de la base, el token (32 bytes `base64url`) y la condición «reclamo vigente» (token + `running` + `lease_until > now()`), parametrizada por tabla. Feeds pasa a usarla. | E4, F3 |
| D4 | N3 importación | `catalog_import_jobs` gana `attempts`, `run_after`, `lease_until` y `execution_token`. **Reclamar**: `queued`, `run_after <= now()`, `SKIP LOCKED`, token y lease nuevos. **Cada lote** comprueba el reclamo y renueva el lease (D5). **Reintentar** = volver a `queued` con `run_after` futuro, `attempts + 1`, filas parciales borradas, `processed_rows = 0` y el snapshot otra vez `pending`: empieza de cero y no hay un estado nuevo, así que el contrato público no cambia. **Temporal**: error inesperado (base de datos, disco), interrupción o lease vencido. **Definitivo**: cualquier `ImportFailure` de datos (`CSV_*`, límites, integridad). Al agotar los intentos (3), `failed` con el código de siempre (`IMPORT_INTERRUPTED` o `IMPORT_PROCESSING_FAILED`). | E2, E3, C6 |
| D5 | N5 renovación | Lease de 2 min **renovado en cada escritura del worker** (lote o cierre): una importación viva nunca lo deja vencer y una caída lo libera en 2 min. | F3, E4 |
| D6 | N3, N4 arranque y apagado | **Se retira `interruptRunning`.** Al arrancar no se toca nada; en cada pasada, `recoverExpiredLeases` (como feeds) devuelve a la cola o falla lo vencido. Al apagar, el trabajo se aborta y **se suelta** el reclamo sin gastar intento. **Transición**: la migración pone `lease_until = now()` a las filas `running` que existan, para que la primera pasada las recupere como vencidas. | H4, F7 |
| D7 | N4 evaluación | Lo mismo para `evaluations`. El reintento borra `evaluation_rows` parciales. Las actualizaciones del feed que esperan una evaluación o importación siguen esperando mientras esté `queued` o `running` (E11): no cambian. | E2, E11 |
| D8 | N6 outbox | Tabla `outbox_events`: `type`, `payload` mínimo (claves, nunca datos del catálogo), `status` (`pending`, `running`, `done`, `failed`), `attempts`, `run_after`, `lease_until`, `execution_token`, `error` y fechas. El evento se inserta **en la transacción** que provoca el efecto. Relay = `WorkerLoop` que reclama con lease (D3) y llama al manejador de su tipo. Entrega «al menos una vez»: **cada manejador es idempotente**, y el estado `done` del evento es su recibo, porque hay un manejador por tipo. Si algún día hay varios consumidores de un mismo evento, se añadirá una tabla de entregas. | C2–C4, F2, F3 |
| D9 | N6, N7 primer consumidor | **`artifacts.delete`**: borrar archivos tras confirmar el borrado de su dueño. Al borrar una importación o un proyecto, o al retirar versiones antiguas del feed, la transacción inserta el evento con la carpeta y las claves, y el relay borra; `ENOENT` cuenta como hecho. Se retiran los borrados «a lo mejor» de después del commit. | E6, F2 |
| D10 | N7 registro de archivos | **Sin tabla central.** Las filas de dominio ya son el registro (clave, tamaño, checksum y dueño por carpeta); la escritura ya va a `tmp/`, se verifica y se enlaza. La limpieza de huérfanos se queda como red de seguridad. | E7, E8; regla 10 de la skill de legibilidad |
| D11 | N8 recibos | Tabla `operation_receipts`: `actor` (el `subject` de la identidad), `scope` (operación y recurso), `idempotency_key` (1–255 caracteres visibles), `request_hash` (SHA-256 del método, la ruta y el cuerpo canónico), `status` (`in_progress`, `completed`), código y cuerpo de la respuesta, `locked_until` y `expires_at` (24 h). `UNIQUE (actor, scope, idempotency_key)`. Cabecera **opcional**; si viene: misma clave y misma huella completada → misma respuesta con `Idempotent-Replayed: true`; otra huella → **422**; en curso → **409**; mal formada → **400**. Solo se guardan las respuestas correctas: un error libera la clave, para poder reintentar (F5 explica que no guarda las validaciones fallidas). **Rutas**: `POST` crear proyecto, evaluación y exportación, por medio de un interceptor. Para E4, el mismo servicio admitirá guardar el recibo **dentro de la transacción** de la operación (13). | C5, C7, F4, F5, H6 |
| D12 | N9 observabilidad | Un *middleware* de `requestId` (acepta `X-Request-Id` válido o genera un UUID, lo devuelve en la respuesta y lo usa el filtro de errores). `GET /api/v1/health` pública: `200` si la base responde a `SELECT 1`, `503` si no, **sin detalles**. Registros estructurados al reclamar, reintentar y fallar (id, intento y duración; nunca datos). Aviso `QUEUE_BACKLOG` cuando el trabajo listo más antiguo de una cola (importación, evaluación, feed u outbox) tiene más de 10 min. **Sin Prometheus** hasta que haya dónde verlo. | H5, E10 |
| D13 | N10 pruebas | PGlite en secuencia: token viejo sin efectos; lease vencido recuperado; apagado que suelta el reclamo; filas `running` de antes de la migración; caída entre el commit y el borrado (el relay borra después); evento entregado dos veces con un solo efecto; recibo repetido, con otra huella y en curso. **No verificado:** procesos reales en paralelo. | H7, F2, F3 |

## Etapas

1. ✅ **E1 — Bucle común y SQL de lease** (D2, D3). *Ajustado en E1: el token sigue siendo un UUID, como en feeds.* Los tres workers y el repositorio de feeds lo usan; sin cambio de comportamiento ni migración.
2. ✅ **E2 — Importación con lease y reintentos** (D4–D6). *Ajustado en E2: `run_after` admite nulos (nulo = listo ya), para que Prisma no lo calcule en el cliente; cada pasada atiende un trabajo como mucho una vez.* Migración, reclamo, renovación, reintento desde cero, recuperación y apagado; retirar `interruptRunning`.
3. ✅ **E3 — Evaluación con lease y reintentos** (D5–D7). *Ajustado en E3: `appendRows` recibe la evaluación reclamada.* Igual para las evaluaciones.
4. ✅ **E4 — Outbox y borrado de archivos** (D8–D10). *Ajustado en E4: `deliverNow` (pasada que empieza después de la llamada); el borrado en curso termina al apagar.* Tabla, relay y manejador `artifacts.delete`; sustituir los borrados de después del commit.
5. ⏭️ **E5 — Recibos de operación** (D11). *Absorbida el 2026-11-05: la E4 de borradores, que lleva otra sesión ([plan changesets 01](../changesets/01-plan-e4-borradores-y-revisiones.md), D8), creó `operation_receipts` y guarda el recibo **dentro de la transacción** de `apply`, que era la parte que E4 necesitaba. De las rutas existentes, evaluación, exportación, publicación, actualización y subida ya son idempotentes por su dominio (409 o devuelven lo existente). Solo «crear proyecto» repetiría la operación con un doble clic, y una segunda infraestructura de recibos para una sola ruta sería estructura de más. Queda como pendiente pequeño.* Tabla, servicio, interceptor y las tres rutas; purga de caducados.
6. ✅ **E6 — Observabilidad** (D12). *Ajustado en E6: se reutiliza `SERVICE_UNAVAILABLE`; un reintento cuenta desde que le tocó.* `requestId`, salud, registros de los trabajos y aviso de cola atascada.
7. ✅ **E7 — Pruebas de fallos y cierre** (D13). Escenarios T30 y T31 completos, docs-diagrams 06–09/17 y cierre del plan.

## Comprobación prevista

En cada etapa:

- pruebas nuevas unitarias, de integración (PGlite) y E2E con dos propietarios;
- defectos a propósito con su restauración comprobada;
- `tsc`, `lint` y `prettier`;
- esquema frente a migraciones;
- batería completa y arranque real.

## Límites y continuidad

- **Migraciones:** se crean y se prueban con PGlite. En Neon se aplican con `pnpm db:status` y `pnpm db:migrate` cuando el usuario lo pida.
- **Fuera del plan:**
  - BullMQ/Redis (D1);
  - `inbox_events` (llegan con los webhooks de E9);
  - estado `unknown_outcome` y conciliación con proveedores (E9);
  - métricas Prometheus;
  - un almacén compatible con S3 (cuando la API y el worker no compartan disco);
  - concurrencia limitada por organización (con E1.2 retirada, no hay organización en los trabajos).
- **Recibos de subidas:** la subida de una importación (multipart) no usa recibo en esta etapa. Ya la protege «un trabajo activo por proyecto», y calcular la huella exigiría leer el archivo antes de aceptarlo.
