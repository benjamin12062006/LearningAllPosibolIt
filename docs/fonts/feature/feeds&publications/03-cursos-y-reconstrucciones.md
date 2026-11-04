# 03 — Cursos y reconstrucciones para feeds y publicaciones

Fecha de creación: 2026-11-02  
Estado: Cuatro guías reconstruidas, renderizadas, verificadas e instaladas; plan sin escribir; feature no implementada.  
Tipo de fuente: transcripciones originales, guías derivadas y registro de herramientas.  
Origen: `Go/APIs de Producción con Go`, `NodeJS/NodeJS Clean Architecture` (Fernando Herrera/DevTalles), `Go/Building, scaling and deploying distributed systems in Golang and Kubernetes`, `PHP/Backend con Laravel` y `Arquitectura/Diseño y Seguridad de APIs REST`.  
Fecha de consulta: 2026-11-02  
Revisión del proyecto: `f6b4bf9` con cambios sin commit (ficha 01).  
Relacionada con: [estado real](01-estado-real-y-antecedentes.md), [fuentes técnicas](02-fuentes-tecnicas.md), [mapa para el plan](04-mapa-de-necesidades-para-el-plan.md), [recetas](reconstrucciones/recetas/), [salida verificada](reconstrucciones/salida-2026-11-02/).

Biblioteca: `/Users/benji/Documents/chrome-extencions/trancripciones/`. Las rutas de las tablas son relativas a esa raíz.

## Necesidad y selección

La feature necesita:

1. publicar sin pisar una publicación concurrente (generación esperada);
2. disparar una tarea con un horario y poder probarla;
3. reintentar con espera creciente y un máximo, y cerrar como fallo definitivo;
4. limitar el tiempo de una operación externa;
5. decidir la caché de la URL pública y cómo se entrega una credencial a una máquina.

Búsqueda con `rg -i` en toda la biblioteca (sin las guías existentes): `nestjs/schedule|ScheduleModule|@Cron|cron job`, `bullmq|nestjs/bull`, `for update|row level lock`, `optimistic lock|optimistic concurrency|version column`, `AbortSignal|AbortController`, `etag|if-none-match|cache-control`, `timingSafeEqual|randomBytes`, `exponential backoff|reintentos?`, `ssrf`, `dead letter|DLQ`, `api.?key`. Se leyeron completos con `nl -ba` los originales elegidos. Antes de instalar se comprobó que no existía ninguna guía de esas lecciones.

**Vacíos de la biblioteca:** ningún curso enseña `@nestjs/schedule`, BullMQ, leases con token, `SKIP LOCKED`, SSRF, `ETag` ni tokens guardados como hash. Se cubren con la [ficha 02](02-fuentes-tecnicas.md). Los cursos de Nest (`NestJS API Profesional`, `Backend Completo`, `Microservicios`) no tienen tareas programadas.

## Fuentes primarias y guías derivadas

| ID | Original (sección, líneas) | Guía instalada y mecanismo recuperado | Necesidad |
| --- | --- | --- | --- |
| C1 / RC1 | `Go/APIs de Producción con Go/Sección 7 Posts CRUD/43. Optimistic Concurrency Control.md`, l. 17–55 | [43 — guía](</Users/benji/Documents/chrome-extencions/trancripciones/Go/APIs de Producción con Go/Sección 7 Posts CRUD/43. Optimistic Concurrency Control - Reconstrucción guiada.md>). Columna `version`; `UPDATE … SET …, version = version + 1 WHERE id = $n AND version = $m RETURNING version`; cero filas → error; el instructor recomienda 409 y lo deja como reto. [Receta](reconstrucciones/recetas/go-apis-produccion/43-optimistic-concurrency-control.json). | Publicar con generación esperada (1) y terminar solo con el token vigente. |
| C2 / RC2 | `NodeJS/NodeJS Clean Architecture/Sección 8 Aplicación de Monitoreo - NOC/112. CronService.md`, l. 13–37; contexto 111 l. 13–29 | [112 — guía](</Users/benji/Documents/chrome-extencions/trancripciones/NodeJS/NodeJS Clean Architecture/Sección 8 Aplicación de Monitoreo - NOC/112. CronService - Reconstrucción guiada.md>). Adaptador `CronService.createJob(cronTime, onTick)` sobre el paquete `cron`: tipos propios, `job.start()` y devolver el trabajo para poder pararlo; expresión de seis campos (con segundos). [Receta](reconstrucciones/recetas/nodejs-clean-architecture/112-cronservice.json). | Programador detrás de una pieza propia (2). |
| C3 / RC3 | `NodeJS/NodeJS Clean Architecture/Sección 12 NOC - Testing - Clean Architecture/184. Pruebas en CronService.md`, l. 13–21 | [184 — guía](</Users/benji/Documents/chrome-extencions/trancripciones/NodeJS/NodeJS Clean Architecture/Sección 12 NOC - Testing - Clean Architecture/184. Pruebas en CronService - Reconstrucción guiada.md>). `jest.fn()` como tarea, espera real de 2 s con `done`, dos llamadas y `job.stop()`; alternativa sin reloj real (simular `CronJob`) solo mencionada. [Receta](reconstrucciones/recetas/nodejs-clean-architecture/184-pruebas-cronservice.json). | Probar el disparo (2). |
| C4 / RC4 | `Go/Building, scaling and deploying distributed systems in Golang and Kubernetes/Sección 14 Reliability/87. Implementing Message Retries.md`, l. 13–47 | [87 — guía](</Users/benji/Documents/chrome-extencions/trancripciones/Go/Building, scaling and deploying distributed systems in Golang and Kubernetes/Sección 14 Reliability/87. Implementing Message Retries - Reconstrucción guiada.md>). `retry.WithBackoff(ctx, cfg, op)` con máximo de 3 y esperas observadas de 1, 2 y 4 s; al agotarse, cabeceras con intentos, motivo y origen, rechazo sin reencolar; ack solo tras el éxito. El código del paquete `retry` no aparece en la clase. [Receta](reconstrucciones/recetas/go-sistemas-distribuidos/87-message-retries.json). | Reintentos y fallo definitivo con motivo (3). |

### Contexto citado sin nueva guía

| ID | Original y líneas | Evidencia y uso |
| --- | --- | --- |
| C5 | `Go/APIs de Producción con Go/Sección 7 Posts CRUD/44. Managing SQL Query Timeouts.md`, l. 13–19 | Cada consulta recibe un contexto con tiempo límite (5 s en una constante) para liberar recursos en operaciones largas. Equivalente conceptual de `AbortSignal.timeout` (F22) para la descarga remota (4). |
| C6 | `PHP/Backend con Laravel/Sección 17 Events y Listeners/135. Especificar reintentos a un Listener.md`, l. 13–19; `137. Ciclo de ejecución de reintentos y failed en Listeners.md`, l. 13–17 | `$tries = 3`, `attempts()` dice en qué intento va; `failed()` se ejecuta **una sola vez**, cuando se agotan los intentos. Apoya separar «reintento» de «fallo definitivo» y registrar el fallo una vez (3). |
| C7 | `Arquitectura/Diseño y Seguridad de APIs REST/Sección 7 REST API Cache Control Patterns/37. Walk Through API Caching using Cache-Control Directives.md`, l. 13–23 | El servidor fija `Cache-Control: public, max-age=N` y el cliente puede saltarse la caché con `no-cache`; demostración con un contador. Contraste para decidir la caché del feed (5): una caché intermedia podría servir una versión antigua durante `max-age`. |
| C8 | `Arquitectura/Diseño y Seguridad de APIs REST/Sección 9 REST API Security/45. Securing API with API Key & Secret.md`, l. 13–33 | Las claves para máquinas son cadenas largas y aleatorias, emitidas por el proveedor; hay que decidir cómo se envían (cabecera, query, cuerpo), cómo se gestionan e invalidan y cómo se entregan. Sin código. Apoya un token de entrega revocable (5). |
| C9 | `NodeJS/NodeJS Clean Architecture/Sección 8 Aplicación de Monitoreo - NOC/111. CRON Tasks.md`, l. 13–29 | Contexto de RC2: por qué no `setInterval` para horarios de calendario y regla de un único archivo que use el paquete. |

## Diferencia entre evidencia y adaptación

| Evidencia del curso | Interpretación limitada | Posible uso (a decidir en el plan) |
| --- | --- | --- |
| RC1: `WHERE version = $m` + `version = version + 1` | Un registro y dos peticiones HTTP; el conflicto termina en 500 en la clase. | `feeds.generation` como versión: publicar con la generación que vio el operador; 0 filas → 409 público. Con F18 se sabe por qué funciona en `READ COMMITTED`. |
| RC1 aplicada a trabajos | El curso no habla de trabajos. | Token de ejecución como «versión» del reclamo: terminar con `WHERE id = $id AND execution_token = $token`. |
| RC2: adaptador sobre `cron` | El curso usa el paquete directamente; Nest ofrece `@nestjs/schedule`, que también usa `cron` (F15). | Un único sitio conoce el programador; los horarios por proyecto, si se guardan en base de datos (E14 de la guía 112, solo mencionado), se registrarían con `SchedulerRegistry`, o un único tick que consulta qué toca. |
| RC3: espera real de 2 s | Lenta y dependiente del reloj. | En el proyecto, probar la función que el tick llama (y los temporizadores falsos de Jest si hace falta); `toHaveBeenCalledTimes` en Jest 30 (F26). |
| RC4: reintentos dentro del proceso con `WithBackoff` | El mensaje espera en memoria; si el proceso cae, RabbitMQ lo reentrega. | Guardar `attempts` y `next_attempt_at` en la fila (`retry_wait`), para que el reintento sobreviva a un reinicio; máximo y espera configurables; errores de datos sin reintento (docs-diagrams/08). |
| C6: `failed()` una sola vez | Laravel. | El paso a `failed` se registra una vez, con el error público. |

## Incertidumbres conservadas en las guías

- RC1: transcripción traducida automáticamente al alemán; nombres de código normalizados; columnas del `SELECT` y firma de `Update` no visibles.
- RC2: firma del constructor de `CronJob` en la versión del curso no visible; la afirmación del instructor sobre `ChildProcess` no se comprueba.
- RC3: nombre de la variable dictado de dos formas.
- RC4: código del paquete `retry` no mostrado; nombres de cabeceras normalizados salvo `x-retry-count`.

## Registro de herramientas

| Paso | Comando | Resultado |
| --- | --- | --- |
| Borrador | `reconstruction.py draft` (una vez por lección) | 4 recetas vacías. |
| Render | `reconstruction.py render --spec-dir reconstrucciones/recetas/<curso> --date 2026-11-02` (tres cursos) | 1 + 2 + 1 guías. |
| Verificación | `reconstruction.py verify` | 4 verificadas, 5 originales con huella, 0 escrituras. |
| Instalación | `reconstruction.py install` | 4 guías creadas junto a sus originales; ninguna existía antes. |

La validación comprueba frases, IDs y huellas; no compila el código del curso.
