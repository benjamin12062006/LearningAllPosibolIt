# 01 — Estado real y antecedentes de feeds y publicaciones

Fecha de creación: 2026-11-02  
Estado: Investigación; feature sin plan ni código.  
Tipo de fuente: código local, planes del proyecto y requisitos de `docs-diagrams`.  
Origen: API `LearningAllPosibolIt` y `docs-diagrams`.  
Fecha de consulta: 2026-11-02  
Revisión inspeccionada: `f6b4bf9` («feat: revisar y exportar el TSV de una evaluación aprobada») en `feature/reviews-exports`, con cambios sin commit: la revisión de legibilidad ([bitácora 08 de reviews&exports](../../../../bitacora-construccion/feature/reviews&exports/08-revision-de-legibilidad.md)) y la investigación aplazada de GraphQL. Línea base: `pnpm test:features`, 31 suites y 585 pruebas en verde.  
Relacionada con: [fuentes técnicas](02-fuentes-tecnicas.md), [cursos y reconstrucciones](03-cursos-y-reconstrucciones.md), [mapa para el plan](04-mapa-de-necesidades-para-el-plan.md), [plan reviews&exports](../../../plans/feature/reviews&exports/01-plan-reviews-y-exports.md), [GraphQL aplazado](../../../plans/feature/graphql&rulesets-evaluations-exports/01-plan-aplazado-sincronizacion-graphql.md).

## Necesidad

El usuario pidió atacar la siguiente feature de backend después de aplazar GraphQL al final. Esta ficha delimita qué pide el diseño para el incremento 5, qué existe en el código y qué condiciona el plan. No propone implementación.

## Por qué el incremento 5 y no el 4

- El orden de [docs-diagrams/09](../../../../../docs-diagrams/09-decisiones-y-plan-de-construccion.md) («Incrementos con dependencias») es 3 → 4 → 5. El 4 dice «Organizaciones **si se requieren**» y su evidencia empieza por «Si se introduce organización…». Ningún piloto lo ha pedido todavía.
- [docs-diagrams/06](../../../../../docs-diagrams/06-dominio-y-datos-postgresql.md) añade: «Organizaciones, membresías y programación se incorporarán en B/C según necesidad».
- El diseño detallado de organizaciones ya está en la ampliación ([docs-diagrams/11](../../../../../docs-diagrams/11-backend-nest-organizaciones-y-transicion.md), E1), que según [docs-diagrams/18](../../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md) («Puerta de entrada obligatoria») se abre después de los planes vigentes.
- El incremento 5 no depende de organizaciones: el acceso sigue siendo por propietario, como en las features anteriores.

Si el usuario prefiere organizaciones antes, el cambio es de orden, no de contenido de esta investigación.

## Requisitos y antecedentes (especificación, no evidencia de ejecución)

| ID | Fuente y localizador | Qué fija |
| --- | --- | --- |
| F1 | [docs-diagrams/03](../../../../../docs-diagrams/03-fases-y-diagramas.md), fase B | Organizaciones y membresías si el piloto las necesita, recuperación de trabajos, fuente CSV por URL, actualización diaria, URL del feed y alertas. |
| F2 | [docs-diagrams/05](../../../../../docs-diagrams/05-analisis-y-requisitos.md), RF06 / UC06–08, RNF03, RNF05 | Programar una fuente autorizada, mantener una URL estable y mostrar fecha, fallos y versión publicada. Un fallo no cambia el feed publicado; las tareas pesadas tienen concurrencia limitada. Archivos privados salvo el feed habilitado; registros sin credenciales ni catálogo completo. |
| F3 | [docs-diagrams/06](../../../../../docs-diagrams/06-dominio-y-datos-postgresql.md), tablas `feed` / `feed_version` y `job`; invariante 5 | Feed por proyecto y canal con `published_version`, generación y política aprobada; versiones con evaluación, archivo, checksum y fecha. Trabajo con clave de idempotencia, intentos, lease, token de ejecución y error público. El puntero y el registro de publicación comparten transacción; el archivo queda fuera. |
| F4 | [docs-diagrams/07](../../../../../docs-diagrams/07-arquitectura-y-contratos.md), puertos y contrato HTTP | `JobRepository`: encolar, reclamar, renovar lease, terminar o reintentar, con token que invalida a trabajadores antiguos. `FeedRepository`: preparar versión, publicar con generación esperada y leer la vigente. `CatalogSource` remoto en B. Rutas `POST /api/v1/projects/{id}/feeds/{feed_id}/publications` y `GET /feeds/{delivery_token}.tsv` con token revocable, independiente de la sesión, y prefijo configurado aparte. |
| F5 | [docs-diagrams/08](../../../../../docs-diagrams/08-secuencias-y-estados.md), «Publicación consistente» y «Ciclo de vida del trabajo» | Escribir y verificar el TSV, después una transacción con versión y cambio condicional del puntero; si hay conflicto, no cambia la versión vigente. La actualización automática exige una política aprobada (versiones de reglas y perfil, exclusiones permitidas, límite de caída de productos); si no se cumple, queda pendiente de revisión. Estados `queued → running → succeeded | retry_wait | failed`. Lease y token; «no prometemos ejecución exactamente una vez». Clave de idempotencia por propietario, proyecto y operación; una clave por ejecución programada; espera creciente con máximo; los errores de datos no se reintentan. |
| F6 | [docs-diagrams/09](../../../../../docs-diagrams/09-decisiones-y-plan-de-construccion.md), incremento 5 | Aceptación: «Fallo y reinicio conservan publicación previa; dos trabajadores no publican con lease vencido.» Además: PGlite acredita migraciones y persistencia, no concurrencia entre procesos. |
| F7 | [docs-diagrams/17](../../../../../docs-diagrams/17-trabajos-integraciones-operacion-y-expansion.md), E2 | La ampliación propone outbox + BullMQ/Redis, pero: «Si la fase B ya adoptó otra ejecución durable que satisface las pruebas, reutilizarla o justificar la migración». La fase B condiciona, por tanto, lo que venga después. |

## Código existente

| ID | Código y localizador | Observación |
| --- | --- | --- |
| F8 | [catalog-import.worker.ts](../../../../src/catalog-import/catalog-import.worker.ts) y [evaluations.worker.ts](../../../../src/evaluations/evaluations.worker.ts) | Dos workers casi iguales: `setInterval` con `pollMs` y `autoStart`, un trabajo cada vez, `AbortController` y espera de `shutdownMs` al apagar. Al arrancar llaman a `interruptRunning`, que marca **todos** los trabajos `running` como fallidos: supone un único proceso. No hay lease, token, intentos ni reintentos. |
| F9 | [evaluations.repository.ts](../../../../src/evaluations/evaluations.repository.ts), `claim` | Reclamo con `FOR UPDATE OF e SKIP LOCKED` y `ORDER BY created_at, id LIMIT 1` en una transacción que pasa el estado a `running`. Las escrituras posteriores (`appendRows`, `complete`, `fail`) bloquean la fila y comprueban que sigue activa, pero no quién la reclamó. |
| F10 | [schema.prisma](../../../../prisma/schema.prisma), `CatalogImportJob` y `Evaluation` | Cada tipo de trabajo es su propia tabla (`catalog_import_jobs`; la evaluación hace de trabajo). No existe una tabla `jobs` común ni claves de idempotencia. `GET /projects/:id/jobs/:jobId` existe solo para importaciones. |
| F11 | [exports/](../../../../src/exports/) y [artifacts/](../../../../src/artifacts/) | La exportación ya produce el TSV verificado de una evaluación aprobada (`Export`: archivo `exports/<uuid>.tsv`, SHA-256, aprobación). `ArtifactStore.writeExport` escribe en `tmp/`, sincroniza, enlaza y relee; `openExport` abre antes de responder. Es el archivo que una versión del feed puede apuntar. |
| F12 | [catalog-import.service.ts](../../../../src/catalog-import/catalog-import.service.ts), `accept` | La importación recibe un multipart, lo guarda como artefacto privado y crea snapshot y trabajo. Una fuente remota necesita otra entrada (descargar a un archivo) que termine en el mismo flujo. |
| F13 | [configure-http.ts](../../../../src/configure-http.ts) | Prefijo global `api` y versionado URI con `defaultVersion: '1'`. Una ruta pública `/feeds/...` necesita quedar fuera de ambos. No hay limitación de peticiones (`Throttler`) ni código de error 429. |
| F14 | [package.json](../../../../package.json) | Nest 12.0.3, Jest 30.5.2, Node v26.9.0 en la máquina. No están instalados `@nestjs/schedule`, `cron` ni ningún cliente de colas. |

## Hallazgos que el plan debe tener en cuenta

1. **Trabajos de un solo proceso.** `interruptRunning` al arrancar es incompatible con dos instancias: la segunda en arrancar mataría el trabajo vivo de la primera. La recuperación con lease sustituye a ese mecanismo; hay que decidir si se aplica también a importaciones y evaluaciones o solo a los trabajos nuevos.
2. **Sin «quién reclamó».** Las escrituras del worker comprueban el estado, no un token. Con leases, un worker cuyo lease venció podría terminar un trabajo ya recuperado por otro: es exactamente lo que prohíbe F6.
3. **El archivo ya existe.** La exportación cumple la invariante 5 para un TSV; publicar puede reducirse a apuntar el feed a una exportación existente, sin generar otro archivo.
4. **Ruta pública sin sesión.** El token del feed es la única protección del TSV publicado (F2: privado salvo el feed habilitado). Hace falta guardarlo de forma que una filtración de la base de datos no lo revele, poder revocarlo y no distinguir «no existe» de «revocado».
5. **Fuente remota = petición saliente a una URL del usuario.** Es un riesgo de SSRF que hoy no existe en la API.
6. **PGlite no demuestra concurrencia** (F6), pero sí la regla del token: un reclamo, vencimiento, recuperación y un intento de terminar con el token viejo se pueden ejecutar en secuencia.
7. **Alcance amplio.** F1 junta cinco piezas (URL, publicación, programación, recuperación y alertas). Su dificultad es 4/5 en [docs-diagrams/02](../../../../../docs-diagrams/02-prioridades-y-dificultad.md) («Actualización programada y alertas»).

## Límites de esta ficha

- No se midió el comportamiento de Merchant Center al descargar (tiempos, reintentos, cabeceras): solo hay documentación (ficha 02).
- Merchant Center necesita una URL pública alcanzable; en local no se puede probar la descarga real.
- No se revisó la web: está fuera del alcance de este backend.
