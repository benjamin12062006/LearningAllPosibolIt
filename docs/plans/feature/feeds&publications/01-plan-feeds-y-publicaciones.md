# 01 — Feed con URL estable, publicaciones y actualización diaria recuperable

Fecha de creación: 2026-11-02  
Última actualización: 2026-11-02 (E1 implementada con ajustes marcados «en E1»); 2026-11-02 (E2 implementada con ajustes marcados «en E2»); 2026-11-02 (contrato de la descarga fijado para conectarla en E4; la reserva de E4 para otra sesión se anuló el mismo día); 2026-11-02 (E3 implementada con ajustes marcados «en E3»); 2026-11-03 (E4 implementada con ajustes marcados «en E4»; migraciones aplicadas en Neon); 2026-11-03 (E5 implementada con ajustes marcados «en E5»); 2026-11-03 (E6 implementada con ajustes marcados «en E6»); 2026-11-04 (E7: estado del feed, historial y docs-diagrams; plan cerrado)  
Estado: E1–E7 implementadas y verificadas en local ([bitácoras 01–07](../../../../bitacora-construccion/feature/feeds&publications/)). Migraciones aplicadas en Neon. **Plan cerrado.** Pendiente del usuario: comprobar en el piloto que Merchant Center descarga la URL pública.  
Ámbito: incremento 5 de `docs-diagrams` (fase B sin organizaciones): RF06/UC06–08, RNF03 y RNF05. Solo backend y solo REST.  
Relacionada con: [estado real](../../../fonts/feature/feeds&publications/01-estado-real-y-antecedentes.md), [fuentes técnicas](../../../fonts/feature/feeds&publications/02-fuentes-tecnicas.md), [cursos y reconstrucciones](../../../fonts/feature/feeds&publications/03-cursos-y-reconstrucciones.md), [mapa de necesidades](../../../fonts/feature/feeds&publications/04-mapa-de-necesidades-para-el-plan.md), [plan reviews&exports](../reviews&exports/01-plan-reviews-y-exports.md) (D6, D7, D11), [GraphQL aplazado](../graphql&rulesets-evaluations-exports/01-plan-aplazado-sincronizacion-graphql.md), [publicación consistente y ciclo de vida del trabajo](../../../../../docs-diagrams/08-secuencias-y-estados.md).  
Revisión de referencia: `f6b4bf9` en `feature/reviews-exports`, con cambios sin commit (revisión de legibilidad, investigación de GraphQL y esta investigación).

## Objetivo

Un operador crea el feed de su proyecto, publica una exportación y entrega a Merchant Center una URL estable. Después configura una fuente CSV por URL, aprueba una política y el sistema actualiza el feed cada día sin estropear la publicación vigente. El incremento está completo cuando se cumplen estas condiciones:

1. `GET /feeds/{token}.tsv` devuelve siempre el TSV completo de la versión publicada, sin sesión. Un token revocado o inexistente da el mismo `404`. [F2, F4]
2. Publicar cambia el puntero solo si la generación que vio el operador sigue vigente; si no, `409` y la versión vigente no cambia. [F5, F18, RC1]
3. Un fallo en cualquier punto de la actualización (descarga, importación, evaluación, política, reinicio del proceso) deja la publicación anterior intacta. [F6, RNF03]
4. Un trabajo cuyo lease venció no puede publicar ni cambiar el estado de su trabajo, aunque siga ejecutándose. [F6, hallazgo 2]
5. La descarga remota solo llega a destinos públicos por HTTPS, sin redirecciones, con tiempo y tamaño limitados. [F21, F22]
6. Una actualización programada se ejecuta una vez por día y feed aunque haya varias instancias. [F15, F5]
7. El operador ve la versión publicada, la fecha y el resultado del último intento con su error público. [F2]
8. Un propietario no ve ni toca el feed de otro: `404`.

Queda fuera: organizaciones, credenciales de la fuente remota, avisos activos (correo, webhook), GraphQL y el frontend. Detalle en «Límites y continuidad».

## Punto de partida

Disponible ([ficha 01](../../../fonts/feature/feeds&publications/01-estado-real-y-antecedentes.md)):

- Exportación de una evaluación aprobada: TSV verificado en `exports/<uuid>.tsv`, SHA-256 y aprobación (F11).
- `ArtifactStore` con escritura atómica (`tmp/`, `sync`, `link`), apertura antes de responder y limpieza de huérfanos reutilizable (F11).
- Importación asíncrona desde un archivo ya guardado (`CatalogImportService.accept`) y evaluación asíncrona, cada una con su worker (F8, F12).
- Reclamo con `FOR UPDATE … SKIP LOCKED` (F9).

Restricciones encontradas al planificar:

- **R1 — Workers de un solo proceso.** Importación y evaluación marcan como fallidos todos sus trabajos `running` al arrancar (F8). Este plan **no** los migra a leases (D2): una actualización que pierde su importación o evaluación por un reinicio la reintenta. Con varias instancias, ese arranque seguiría matando trabajos vivos de otra instancia; por eso la API se despliega con **una sola instancia** hasta un plan posterior (ver «Revisar este plan si»).
- **R2 — Una importación y una evaluación activas por proyecto.** `IMPORT_ALREADY_ACTIVE` y `EVALUATION_ALREADY_ACTIVE` ya existen. Una actualización que coincide con trabajo manual del operador tiene que esperar, no fallar.
- **R3 — Sin URL pública en local.** La descarga real de Merchant Center solo se puede comprobar en el piloto (D15).
- **R4 — PGlite es de una sola conexión.** Demuestra las reglas en secuencia (token, generación, idempotencia), no la concurrencia real (F6).

## Decisiones

Cada `D` resuelve la `N` del mismo número de la [ficha 04](../../../fonts/feature/feeds&publications/04-mapa-de-necesidades-para-el-plan.md).

### D1 — Una feature en siete etapas, de lo manual a lo automático

Primero lo que el operador hace a mano (feed, publicación, URL) y después lo automático (descarga, trabajo, política, programación). Así cada etapa deja algo usable y verificable, y la URL se puede probar en Merchant Center antes de automatizar nada. Etapas en la sección «Etapas».

### D2 — Un trabajo propio con lease para la actualización; importación y evaluación no cambian

- **Tabla nueva `feed_refreshes`**, no una tabla `jobs` genérica: hoy hay un solo tipo de trabajo nuevo. La lógica reutilizable (espera creciente, clasificación de errores, reglas del lease) va en funciones puras de `src/jobs/`, para que un plan posterior (docs-diagrams/17, E2) la pueda reutilizar o justificar su sustitución. [F7]
- **Importación y evaluación siguen como están** (R1). Migrarlas cambiaría código ya probado y no es necesario para la aceptación del incremento: la actualización las usa como pasos y trata su interrupción como error temporal (D4).
- **Columnas de lease:** `status`, `stage`, `attempts`, `run_after`, `lease_until`, `execution_token`, `error`, fechas.
- **Reloj de la base de datos** (`now()`) para `lease_until` y `run_after`: todas las instancias comparan con el mismo reloj.
- **Sin renovación del lease.** Cada paso tiene una duración acotada por sus propios límites (descarga ≤ 30 s, el resto lee o escribe poco). El lease (5 minutos, configurable) es mayor que el paso más largo. Si una medición lo contradice, se añade la renovación. Docs-diagrams/07 la menciona; se omite por la regla «sin estructura que no resuelva un problema presente».

Estados (docs-diagrams/08): `queued → running → succeeded | retry_wait | failed`. «Esperar a que termine la importación» no es un estado nuevo: es `queued` con `run_after` en el futuro y el mismo `stage`.

### D3 — Todo lo que escribe el trabajo comprueba el token

- **Reclamar** (una transacción): elegir con `FOR UPDATE SKIP LOCKED` una fila lista (`status IN ('queued', 'retry_wait') AND run_after <= now()`) o con lease vencido (`status = 'running' AND lease_until < now()`); poner `status = 'running'`, `lease_until = now() + lease` y un `execution_token` nuevo. Si venía de un lease vencido, cuenta como intento fallido; al superar el máximo pasa a `failed` con `REFRESH_LEASE_EXPIRED`. [F17]
- **Cada escritura posterior** (avanzar de paso, programar espera, reintentar, terminar, **publicar**) incluye `WHERE id = $id AND execution_token = $token AND status = 'running'` y comprueba que afectó a una fila. Cero filas = el trabajo ya no es suyo: el worker abandona sin efectos. Es la concurrencia optimista de RC1 con el token como versión; F18 explica por qué funciona en `READ COMMITTED`.
- **Publicar en automático** comparte transacción con la comprobación del token (D6): si el token no es vigente, no hay versión nueva.
- Prueba secuencial en PGlite: reclamar → vencer el lease con SQL → recuperar → el worker antiguo intenta avanzar y publicar → nada cambia (R4).
- Ajustado en E4:
  - una pasada del worker atiende cada actualización como mucho una vez (si no, una espera corta la volvía a reclamar sin fin);
  - `run_after` lo pone siempre la base: Prisma enviaba su `now()` sin zona horaria y la fila quedaba horas en el futuro con una sesión que no está en UTC;
  - provisional hasta E5: la evaluación usa la última revisión de reglas y el resultado es `evaluated`.

### D4 — Reintentos con espera creciente; errores de datos sin reintento

- **Temporales** (se reintentan): fallo de red o DNS, tiempo agotado, HTTP 5xx o 429, importación o evaluación interrumpidas, `IMPORT_ALREADY_ACTIVE` o `EVALUATION_ALREADY_ACTIVE` del propio proyecto y errores internos inesperados.
- **Definitivos** (`failed` directo): destino no permitido, HTTP 4xx (salvo 429), archivo demasiado grande, CSV inválido y evaluación fallida por datos.
- **Espera:** `min(base × 2^(intento − 1), tope)`, con base 60 s y tope 15 min; máximo 3 intentos. Todo configurable en `FEED_REFRESH_OPTIONS`. [RC4]
- El paso a `failed` se registra una sola vez, con el error público. [C6]
- La espera es una columna (`run_after`), no un temporizador en memoria: sobrevive a un reinicio (diferencia con RC4, ficha 03).
- Función pura `nextRetryDelay(attempt, options)` y `classifyRefreshError(error)` en `src/jobs/`, con pruebas unitarias.

### D5 — `feeds` y `feed_versions`; la versión tiene su propio archivo

- **Un feed por proyecto** (`UNIQUE (project_id)`): un único canal, Google, en la fase B. [F3]
- **`feeds`:** `id`, `project_id` (FK → `projects` `ON DELETE CASCADE`), `generation` (`INTEGER NOT NULL DEFAULT 0`), `published_version_id` (anulable), `delivery_token_hash` (anulable y `UNIQUE`; nulo = entrega desactivada), columnas de fuente (D9), de política (D11) y de programación (D10), `created_at`, `updated_at`.
- **`feed_versions`:** `id`, `feed_id` (FK con cascada), `evaluation_id` y `export_id` (anulables, solo para trazabilidad: `ON DELETE SET NULL`), `artifact_key` (anulable cuando se retira el archivo, D14), `tsv_checksum`, `byte_size`, `row_count`, `published_by` (`'operator'` o `'refresh'`), `created_at`.
- **El archivo es de la versión, no de la exportación.** Al publicar, el TSV de la exportación se enlaza (`link`, mismo sistema de archivos, sin copiar) como `feeds/<versionId>.tsv` y se relee su SHA-256. Así, borrar la importación de la que salió (que borra en cascada evaluación y exportación) **no** rompe el feed publicado (RNF03). [F11]
- FK de `published_version_id` → `feed_versions` añadida tras crear ambas tablas, `DEFERRABLE INITIALLY DEFERRED` si hace falta para insertar versión y puntero en la misma transacción (a comprobar en E1).

### D6 — Publicar con generación esperada

- `POST /api/v1/projects/:projectId/feeds/:feedId/publications` con `{ exportId, expectedGeneration }`.
- **Cualquier exportación del proyecto** se puede publicar, también una antigua (vuelta atrás). La aprobación ya se hizo al exportar (plan reviews&exports, D2).
- Flujo:
  1. Leer feed y exportación propios. Si el checksum coincide con la versión vigente, responder `200` con el feed sin crear versión.
  2. Enlazar el archivo y verificarlo (fuera de la transacción). [F27, invariante 5]
  3. Transacción: insertar la versión y `UPDATE feeds SET generation = generation + 1, published_version_id = $v WHERE id = $f AND generation = $esperada RETURNING generation`. Cero filas → deshacer, borrar el enlace y `409 FEED_GENERATION_CONFLICT`. [RC1, F18]
- `201` con el feed (generación nueva y versión publicada).
- Ajustado en E1:
  - la generación se comprueba antes que «ya publicado»: una generación antigua da `409` aunque el TSV sea el vigente;
  - la transacción bloquea el feed (`FOR UPDATE`) y la exportación (`FOR SHARE`) antes de insertar; la condición del `UPDATE` sigue siendo el control de concurrencia;
  - `GET …/feeds` lista el feed del proyecto (como mucho uno), para encontrar su id;
  - sin `DEFERRABLE` en la FK del puntero (ficha 05, F29).

### D7 — URL pública con token guardado como hash

- **Token:** 32 bytes de `randomBytes` en `base64url` (43 caracteres). Se guarda solo su SHA-256; se busca por el hash, así la comparación la hace el índice `UNIQUE`. [F25, C8]
- **Se muestra una vez:** al crear el feed y al rotar el token, en `deliveryUrl`. Nunca se devuelve después.
- **Rutas del operador:** `POST …/feeds/:feedId/delivery-token` (rotar: el anterior deja de valer) y `DELETE …/feeds/:feedId/delivery-token` (desactivar).
- **Ruta pública:** controlador propio con `@Controller({ path: 'feeds', version: VERSION_NEUTRAL })` y `exclude` del prefijo `api`, para servir `/feeds/<token>.tsv`. La combinación de `exclude`, `VERSION_NEUTRAL` y el versionado URI se comprueba con una prueba E2E (F24). Sin `DescopeSessionGuard`.
- **Respuestas:** formato de token inválido, token inexistente, entrega desactivada o feed sin versión publicada → el mismo `404 FEED_NOT_FOUND`. Archivo ausente → `503 FEED_FILE_UNAVAILABLE`, registrado con el id del feed, nunca con el token.
- Ajustado en E2:
  - entrega en un servicio y un controlador propios (`FeedDeliveryService`, `FeedDeliveryController`), sin guard;
  - rotar responde `200` y desactivar `204`;
  - una versión publicada sin `artifact_key` se trata como archivo ausente (`503`).
- **Sin limitación de peticiones** en este plan: 256 bits de token no se pueden adivinar, y el abuso de volumen se limita mejor en la infraestructura. Se anota como límite.

### D8 — `ETag` y `Cache-Control: no-cache`

- `ETag: "<tsv_checksum>"` de la versión publicada; `If-None-Match` que coincide → `304` sin cuerpo. [F23]
- `Cache-Control: no-cache`: una caché puede guardar el archivo pero debe revalidarlo antes de cada uso, así nunca sirve una versión antigua durante un `max-age` (contraste de C7).
- `Content-Type: text/tab-separated-values; charset=utf-8` y `Content-Length`. Se abre el archivo antes de responder, como en la exportación.
- No consta que Merchant Center use `ETag` (ficha 02): no se depende de ello.

### D9 — Fuente remota segura, idempotente y con el mismo flujo que la subida

- **Configuración** `PUT …/feeds/:feedId/source` con `{ url, idColumn, delimiter }`. Validación sintáctica (400): `https:` solamente, sin usuario ni contraseña en la URL, como mucho 2.048 caracteres.
- **Descarga** en un módulo `src/remote-source/`:
  1. resolver el nombre con todas sus direcciones y rechazar cualquiera no pública con `net.BlockList` (rangos de F21: loopback, RFC 1918, link-local, ULA, multicast, metadatos, `0.0.0.0/8`);
  2. conectar a la IP validada manteniendo el nombre para `Host` y SNI;
  3. no seguir redirecciones: un 3xx es error definitivo `SOURCE_REDIRECT_NOT_ALLOWED`;
  4. `AbortSignal.any([AbortSignal.timeout(30 s), señal de apagado])` [F22, C5];
  5. escribir en `tmp/` contando bytes y calculando SHA-256; al pasar de 10 MiB (`IMPORT_LIMITS.fileBytes`) abortar con `SOURCE_TOO_LARGE`.
- **Cómo fijar la IP** con el cliente HTTP de Node (opción `lookup` de `https.request` o un `Agent` de `undici`) se decide en E3, tras leer su documentación oficial (vacío de la ficha 02). En las pruebas, una opción `allowPrivateNetworks` permite un servidor local; en producción no se puede activar.
- **Mismo flujo que la subida:** el archivo descargado entra por `CatalogImportService.accept` como un `StoredUpload`.
- **Idempotencia del paso.** El trabajo guarda primero, con su token, los ids previstos de snapshot y de trabajo de importación. Después llama a `accept` con esos ids (cambio pequeño en `buildAcceptance`). Si el proceso cae entre medias, el siguiente intento ve que el snapshot ya existe y pasa al paso siguiente en lugar de duplicar la importación.
- Credenciales de la fuente (usuario y contraseña): fuera de este plan, porque exigen guardar secretos cifrados.
- Ajustado en E3:
  - la IP se valida en el `lookup` de `https.request`, sin dependencias nuevas (ficha 07);
  - una lista de bloqueo por familia: con una sola, `net.BlockList` bloqueaba todas las IPv4;
  - la base no exige `https:` en `source_url` (solo longitudes): lo comprueban la API y la descarga;
  - `RemoteSourceModule` se importará en E4, cuando el worker lo use.

### D10 — Programación con el worker existente, sin `@nestjs/schedule`

- **Columnas en `feeds`:** `refresh_enabled`, `refresh_time` (`HH:MM`) y `time_zone` (IANA, validada con `Intl.supportedValuesOf('timeZone')`). Ruta `PUT …/feeds/:feedId/schedule`.
- **El worker de actualizaciones**, en cada tick (el mismo patrón de `setInterval` y `pollMs` de los workers actuales), llama primero a `enqueueDueRefreshes()`. Para cada feed activo calcula con `Intl.DateTimeFormat` la fecha y la hora locales. Si ya pasó `refresh_time`, inserta una actualización con `scheduled_for = <fecha local>` y `ON CONFLICT DO NOTHING` sobre `UNIQUE (feed_id, scheduled_for)`.
- Así varias instancias pueden disparar a la vez y solo una inserción gana (F15: el programador dispara en todas; la deduplicación está en la base de datos). Si la API estuvo parada a la hora prevista, la actualización se hace al arrancar ese mismo día.
- **No se instala `@nestjs/schedule`.** Solo aportaría el disparo, que el worker ya tiene, y obligaría igualmente a deduplicar en la base de datos. El cálculo de «¿toca hoy?» queda en una función pura (`isRefreshDue(now, schedule)`) y el reloj se inyecta para las pruebas, lo que sustituye la espera real de RC3. Un único sitio conoce el horario, como el adaptador de RC2.
- **Una actualización activa por feed:** índice único parcial `(feed_id) WHERE status IN ('queued', 'running', 'retry_wait')`. Si ya hay una, la programada del día no se inserta y lo intenta en el siguiente tick.
- **Disparo manual:** `POST …/feeds/:feedId/refreshes` → `202` con el trabajo (`scheduled_for` nulo), como «actualizar ahora». Consulta: `GET …/feeds/:feedId/refreshes/:refreshId`.
- Ajustado en E6:
  - las funciones de hora están en `src/feeds/feed-schedule.ts`, porque las usa también el DTO;
  - los tres campos del `PUT` son obligatorios, también para desactivar;
  - solo se programan feeds con fuente y política;
  - una zona que deja de ser válida se registra y se salta.

### D11 — Política aprobada por el operador, sin cifras ocultas

- `PUT …/feeds/:feedId/policy` con `{ rulesetRevision, maxInvalid, maxExcluded, maxDropPercent }`. El servidor guarda además `engine_version` y `profile_version` vigentes en ese momento y la fecha de aprobación.
- Al terminar la evaluación de una actualización, la publicación automática exige:
  - evaluación `succeeded` con al menos un producto válido;
  - motor y perfil iguales a los aprobados (si cambian, hay que reaprobar);
  - inválidas ≤ `maxInvalid` y excluidas ≤ `maxExcluded`;
  - si hay versión publicada: válidos ≥ `row_count` publicado × (1 − `maxDropPercent` / 100).
- Si no se cumple: la actualización termina `succeeded` con resultado `needs_review` y el código de la regla incumplida; la publicación no cambia. [F5]
- Si se cumple, la política sustituye a la aprobación manual: el trabajo crea la exportación con la suma y los conteos de la propia evaluación (reutilizando `ExportsService`) y publica (D6) con la generación que leyó **al empezar** la actualización. Si el operador publicó a mano entretanto → resultado `conflict`, sin publicar ni reintentar.
- Si el TSV es idéntico al publicado → resultado `unchanged`, sin versión nueva.
- La función `checkRefreshPolicy(policy, evaluation, published)` es pura y devuelve el primer incumplimiento o `null` (mismo patrón que `findExportBlocker`).
- Sin política aprobada o sin fuente configurada no se puede disparar: `409`.
- Ajustado en E5:
  - la generación se guarda en la misma sentencia que crea la actualización (`expected_generation`); sin ella, el resultado es `conflict`;
  - el motivo de `needs_review` o `conflict` queda en `error`;
  - `EXPORT_EVALUATION_SUPERSEDED`, `EXPORT_EVALUATION_OUTDATED` y `EXPORT_NO_VALID_PRODUCTS` no se reintentan;
  - desaparecen `evaluated` y `REFRESH_RULESET_MISSING`, provisionales de E4.

### D12 — Alertas como estado consultable

- `GET …/feeds/:feedId` devuelve:
  - `generation`;
  - la versión publicada (`id`, `publishedAt`, `rowCount`, `tsvChecksum`, `publishedBy`);
  - si la entrega está activa;
  - fuente, programación y política (sin token);
  - **la última actualización**: `status`, `outcome` (`published | unchanged | needs_review | conflict`), fechas y `error` público;
  - `lastPublishedAt`.
- Es lo que exige docs-diagrams/05 («mostrar fecha, fallos y versión publicada»). Los avisos activos (correo, webhook) quedan fuera («Límites y continuidad»).
- Cada fallo definitivo deja un registro `warn` con el código, el id del feed y el de la actualización, sin URL completa ni datos del catálogo (RNF05).
- `GET …/feeds/:feedId/versions?limit&offset`: historial paginado (20 por defecto, 100 como máximo).

### D13 — Errores públicos

Nuevos en [error-codes.ts](../../../../src/common/http/error-codes.ts) y [messages.ts](../../../../src/common/http/messages.ts), con texto es/en:

| Código | HTTP o lugar |
| --- | --- |
| `FEED_NOT_FOUND` | 404 (también en la URL pública) |
| `FEED_ALREADY_EXISTS` | 409 |
| `FEED_GENERATION_CONFLICT` | 409 |
| `FEED_FILE_UNAVAILABLE` | 503 |
| `FEED_SOURCE_NOT_CONFIGURED`, `FEED_POLICY_NOT_APPROVED`, `FEED_REFRESH_ALREADY_ACTIVE` | 409 |
| `FEED_REFRESH_NOT_FOUND` | 404 |
| `SOURCE_URL_NOT_ALLOWED`, `SOURCE_REDIRECT_NOT_ALLOWED`, `SOURCE_UNREACHABLE`, `SOURCE_TIMEOUT`, `SOURCE_HTTP_ERROR`, `SOURCE_TOO_LARGE` | `error` de la actualización |
| `REFRESH_IMPORT_FAILED`, `REFRESH_EVALUATION_FAILED`, `REFRESH_LEASE_EXPIRED` | `error` de la actualización |
| `REFRESH_POLICY_*` (una por regla de D11) | código del resultado `needs_review` |

La URL inválida al configurar la fuente sale como issue de validación (400), con `CODES_WITH_ISSUES` si hace falta. La lista definitiva se fija en cada etapa.

### D14 — Retención y borrados

- **Se conservan los archivos de la versión publicada y de las dos anteriores** (configurable). Al publicar, después del commit, se retiran los más antiguos: `artifact_key = NULL` en la fila (el historial se queda) y se borra el archivo. Si el borrado falla, lo retira la limpieza.
- **Limpieza al arrancar:** `removeOrphans` sobre `feeds/` con las claves referenciadas por `feed_versions`, como en exportaciones.
- **Borrar el proyecto** borra feeds, versiones y actualizaciones en cascada; `deleteProject` devuelve también las claves de `feeds/` para retirarlas (mismo patrón que `exportArtifactKeys`).
- **Borrar una importación** no toca el feed (D5); la referencia de la actualización al snapshot es `ON DELETE SET NULL`.
- Ajustado en E2: `deleteProject` devuelve `{ imports, feedArtifactKeys }` (antes, la lista de importaciones), porque las claves del feed se leen con los feeds bloqueados en la misma transacción; tres pruebas existentes se adaptaron a la forma.

### D15 — Pruebas y comprobación manual

- **Unitarias sin Nest:** espera creciente y clasificación de errores; `isRefreshDue` con zonas horarias y cambio de hora; `checkRefreshPolicy`; clasificación de direcciones (IPv4, IPv6 y IPv4 mapeada en IPv6); validación de la URL; hash del token.
- **Integración con PGlite:** restricciones de las tablas; publicación condicional; reclamo, vencimiento, recuperación y token antiguo sin efectos; inserción programada idempotente; una actualización activa por feed; cascadas; retención.
- **E2E con Supertest y dos propietarios:**
  - recorrido manual: crear feed, publicar, descargar por la URL pública, `304` con `ETag`, rotar y revocar → `404`;
  - recorrido automático contra un servidor HTTP local (con `allowPrivateNetworks` solo en pruebas): configurar fuente y política, disparar, publicar;
  - fallos que conservan la publicación: 500 del origen, CSV inválido, política incumplida, reinicio simulado a mitad;
  - Bob recibe `404` en todo lo de Alice.
- **Defectos a propósito** en cada etapa, restaurados y comprobados con `diff`.
- **Comprobación manual en el piloto:** registrar en la bitácora si Merchant Center descarga la URL programada, con qué frecuencia y qué errores muestra. Es la única prueba del criterio 1 con el consumidor real.

## Etapas

| Etapa | Cambios | Evidencia de cierre |
| --- | --- | --- |
| E1 — Feed y publicación manual | Migración `feeds` + `feed_versions` (sin fuente, política ni programación); `FeedsModule`; `ArtifactStore.linkFeedVersion`; crear feed (con token), `GET` del feed, publicar con generación esperada (D5, D6); códigos de D13 que use. | Hecho en E1: 45 pruebas nuevas (633 en total); 12 de 13 defectos detectados (el `FOR UPDATE` del feed no se puede demostrar con PGlite); esquema = migraciones; `db:verify` 3/3; arranque real con `401`. Migración `20261102000100_create_feeds` pendiente en Neon. |
| E2 — URL pública, caché y retención | Controlador público fuera del prefijo, rotar y revocar token, `ETag`/`304`, apertura previa, retención y limpieza de `feeds/`, claves en `deleteProject` (D7, D8, D14). | Hecho en E2: 32 pruebas nuevas (665 en total), ruta exacta sin `/api` ni `/v1`, `HEAD`, `304`, `404` iguales y `503`; 14 de 15 defectos detectados (el bloqueo de feeds en `deleteProject` no se puede demostrar con PGlite); arranque real. Sin migración. Comprobación en Merchant Center pendiente del piloto. |
| E3 — Fuente remota segura | Leer la documentación oficial de `https.request`/`undici` y decidir cómo fijar la IP; `src/remote-source/` con las comprobaciones de D9; `PUT …/source` y columnas de fuente (migración). | Hecho en E3: 73 pruebas nuevas; 12 de 14 defectos detectados (sobreviven un nombre con direcciones mixtas y `agent: false`, no reproducibles en local); esquema = migraciones; `db:verify` 3/3; arranque real. Migración `20261102000200_add_feed_source` pendiente en Neon. |
| E4 — Trabajo de actualización con lease | Migración `feed_refreshes`; `src/jobs/` (espera y clasificación); reclamo, recuperación y escrituras con token (D2–D4); pasos `fetch → import → evaluate` con la idempotencia de D9; disparo manual y consulta (D10); worker con apagado como los actuales. | Hecho en E4: 36 pruebas nuevas (899 en total); token viejo y lease vencido sin efectos; 13 de 14 defectos detectados (`SKIP LOCKED` no se puede demostrar con PGlite); arranque real. Migraciones de E1, E3 y E4 aplicadas en Neon el 2026-11-03. |
| E5 — Política y publicación automática | Columnas y `PUT …/policy`; `checkRefreshPolicy`; paso `publish` que crea la exportación y publica con la generación inicial dentro de la transacción con token (D11, D3). | Hecho en E5: 33 pruebas nuevas (932 en total); `published`, `unchanged`, `needs_review`, `conflict` y token antiguo sin efectos dentro de la transacción; 9 de 10 defectos detectados (R5 tiene una segunda capa); arranque real. Migración aplicada en Neon el 2026-11-03. |
| E6 — Programación diaria | Columnas y `PUT …/schedule`; `isRefreshDue` con reloj inyectado; `enqueueDueRefreshes` idempotente (D10). | Hecho en E6: 18 pruebas nuevas (966 en total con las de organizaciones); una actualización por fecha local, cambios de hora en Madrid y reloj inyectado; 10 de 10 defectos detectados; arranque real. Migración aplicada en Neon el 2026-11-03. |
| E7 — Estado y cierre documental | `lastRefresh` y versiones en el `GET` del feed (D12) si no quedaron completos antes; actualizar docs-diagrams 06 (tablas reales), 07 (rutas y puertos), 08 (sin renovación del lease, `outcome`) y 09 (estado del incremento 5); bitácoras y este plan. | Hecho en E7: `lastRefresh`, `GET …/versions` y registro de fallos definitivos; 7 pruebas nuevas; 6 de 6 defectos detectados; docs-diagrams 06–09 actualizados con enlaces comprobados (los Mermaid sin renderizar). No verificado: concurrencia real entre procesos y descarga de Merchant Center. |

E1–E2 no dependen del trabajo y permiten probar la URL en el piloto pronto. E3 va antes de E4 porque el primer paso del trabajo es la descarga. E5 necesita E4, y E6 solo inserta trabajos que E4 y E5 ya saben ejecutar. Cada etapa abre su entrada en [la bitácora de la feature](../../../../bitacora-construccion/feature/feeds&publications/).

## Contrato de la descarga para E4

El 2026-11-02 el usuario planteó llevar E4 en otra sesión y, poco después, lo anuló: E3 y E4 siguen en esta sesión, en orden. El contrato de la descarga se conserva porque es lo que E4 conectará al worker; si E3 tuviera que cambiarlo, se actualiza esta sección antes que el código. La otra sesión dejó sus notas en `docs/plans/feature/feed-refresh/`, `docs/fonts/feature/feed-refresh/` y `bitacora-construccion/feature/feed-refresh/`; E4 reutilizó `refresh-retry.ts` y el 2026-11-05 esas notas se marcaron como cerradas y absorbidas en E4, sin borrarlas.

**Servicio de descarga (E3):**

```ts
// src/remote-source/remote-source.module.ts
@Module({ imports: [ArtifactsModule], providers: [RemoteSourceService, …], exports: [RemoteSourceService] })
export class RemoteSourceModule {}

// src/remote-source/remote-source.service.ts
@Injectable()
export class RemoteSourceService {
  /**
   * Descarga `url` a `tmp/` y devuelve el archivo con la misma forma que una
   * subida (`StoredUpload`), listo para `CatalogImportService.accept`.
   * `signal` permite abortar al apagar; el tiempo límite propio (30 s) se
   * combina con él con `AbortSignal.any`.
   * Si falla, lanza `RemoteSourceFailure` y no deja nada en `tmp/`.
   */
  download(url: string, signal?: AbortSignal): Promise<DownloadedSource>;
}

// src/remote-source/remote-source.types.ts
export type DownloadedSource = StoredUpload; // { filename: string; size: number; hash: string }
export class RemoteSourceFailure extends ApplicationFailure {
  // Estado HTTP del origen cuando el fallo es SOURCE_HTTP_ERROR; si no, undefined.
  readonly upstreamStatus?: number;
}
```

**Códigos de `RemoteSourceFailure.detail.code`** (nuevos en `ErrorCodes`, con textos es/en) y su clasificación para D4:

| Código | Cuándo | D4 |
| --- | --- | --- |
| `SOURCE_URL_NOT_ALLOWED` | Esquema distinto de `https:`, credenciales en la URL o alguna dirección resuelta no pública (F21, F34, F35). | Definitivo |
| `SOURCE_REDIRECT_NOT_ALLOWED` | Respuesta 3xx. | Definitivo |
| `SOURCE_HTTP_ERROR` | Otra respuesta no 2xx; `upstreamStatus` lleva el estado. | Temporal si `upstreamStatus` es 5xx o 429; definitivo si es otro 4xx |
| `SOURCE_UNREACHABLE` | Error de DNS o de conexión. | Temporal |
| `SOURCE_TIMEOUT` | Pasaron los 30 s (`TimeoutError`). | Temporal |
| `SOURCE_TOO_LARGE` | Más de 10 MiB (`IMPORT_LIMITS.fileBytes`), por `Content-Length` o al contar bytes. | Definitivo |

Un aborto por la señal de apagado se propaga tal cual (`AbortError`), no como `RemoteSourceFailure`: el trabajo no falló, se interrumpió.

**Columnas de la fuente en `feeds` (E3):** `source_url`, `source_id_column` y `source_delimiter` (`'comma' | 'semicolon'`), todas nulas o todas con valor. El worker de E4 las lee del feed.

**Qué es de cada etapa:**

- E3: `src/remote-source/`, la migración `20261102000200_add_feed_source`, la ruta `PUT …/feeds/:feedId/source` en `src/feeds/` y los códigos `SOURCE_*`.
- E4: `src/jobs/`, la tabla `feed_refreshes` en una migración posterior, el worker y el cambio de `buildAcceptance` para aceptar ids previstos (D9).

## Comprobación prevista

**Verificación de cada etapa:** `tsc --noEmit`, `pnpm lint`, `prettier --check src test/features`, `pnpm test:features`. Con migración nueva, también `pnpm db:verify` y la comprobación esquema-migraciones («This is an empty migration»), la migración añadida a `test/prisma-migrations.test.mjs` y el conteo de `projects.repository.int-spec.ts` actualizado (hoy 10). Arranque real con la base local o PGlite según el patrón de las features anteriores, **sin tocar Neon**. Las 585 pruebas actuales siguen como regresión.

**Lo que PGlite no demuestra** (R4), dicho en un comentario de cada prueba afectada: dos workers reclamando a la vez, el `SKIP LOCKED` real y la espera de un `UPDATE` concurrente. La regla que importa para la aceptación (el token viejo no tiene efectos) sí se demuestra en secuencia.

**Fuera de lo automatizado:**

- aplicar cada migración en Neon, que hace el usuario con `pnpm db:status` y `pnpm db:migrate` desde la carpeta de la API;
- la descarga programada de Merchant Center desde una URL pública (D15).

## Límites y continuidad

**Fuera del plan:**

- Organizaciones y membresías (incremento 4; docs-diagrams/11, E1).
- Migrar importación y evaluación a leases y desplegar varias instancias (R1). Candidato natural del plan de trabajos de docs-diagrams/17, que deberá reutilizar `src/jobs/` o justificar el cambio. [F7]
- Credenciales de la fuente remota y fuentes FTP/SFTP.
- Avisos activos (correo, webhook) y métricas.
- Limitación de peticiones en la URL pública.
- GraphQL de feeds (plan aplazado al final del backend).
- Frontend.

**Revisar este plan si:**

- el despliegue necesita más de una instancia antes de migrar importación y evaluación (R1);
- una medición muestra pasos más largos que el lease (D2: añadir renovación);
- `exclude` del prefijo y `VERSION_NEUTRAL` no producen `/feeds/<token>.tsv` exacto (D7);
- fijar la IP en Node exige una dependencia nueva (D9: se decide en E3 y se anota aquí);
- Merchant Center en el piloto no acepta la URL, el tipo de contenido o el `404` de una URL revocada;
- el piloto pide credenciales en la fuente o una frecuencia distinta de la diaria.
