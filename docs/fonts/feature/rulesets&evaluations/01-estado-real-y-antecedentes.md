# 01 — Estado real y antecedentes de rulesets y evaluations

Fecha de creación: 2026-10-31  
Tipo de fuente: código local, bitácora del proyecto y requisitos de `docs-diagrams`.  
Origen: API `claudeLearningAllPosibolIt` (copia de `estadistica-forms-api`) y `docs-diagrams`.  
Fecha de consulta: 2026-10-31  
Revisión inspeccionada: `1f0be2d` («feat: migrar a Neon, añadir GraphQL y límites de consultas») con 53 archivos modificados sin commit. La raíz KSuT no es un repositorio Git.  
Relacionada con: [fuentes técnicas](02-fuentes-tecnicas.md), [cursos y reconstrucciones](03-cursos-y-reconstrucciones.md), [mapa para el plan](04-mapa-de-necesidades-para-el-plan.md), [feature anterior](../projects&catalog-import/05-implementacion-catalog-import.md), [bitácora de borrado](../../../../bitacora-construccion/feature/projects&catalog-import/05-eliminar-proyectos-e-importaciones.md).

## Necesidad

Delimitar qué feature sigue a `catalog-import`, qué exige y qué código existente puede reutilizar, antes de escribir su plan. Esta ficha no propone implementación; separa lo observado de lo que el plan debe decidir.

## Qué feature sigue

`docs-diagrams` ordena los incrementos así: 1a `projects`, 1b `catalog-import`, 1c interfaz mínima Nuxt, **2 mapeo, reglas y evaluación**, 3 revisión y exportación TSV ([09, incrementos](../../../../../docs-diagrams/09-decisiones-y-plan-de-construccion.md)). 1a y 1b están implementados en esta API ([bitácora 02](../../../../bitacora-construccion/feature/projects&catalog-import/02-implementar-projects.md), [bitácora 03](../../../../bitacora-construccion/feature/projects&catalog-import/03-implementar-catalog-import.md)). 1c pertenece al repositorio web (`estadistica-forms-web`), no a esta API. Por tanto, la siguiente feature de backend es el incremento 2, que se nombra `rulesets&evaluations` por sus recursos HTTP previstos (`/rulesets`, `/evaluations`).

## Requisitos que debe cumplir (especificación, no evidencia de ejecución)

| ID | Fuente y localizador | Exigencia para el incremento 2 |
| --- | --- | --- |
| F1 | [05, tabla de requisitos](../../../../../docs-diagrams/05-analisis-y-requisitos.md), RF03, RF04, RNF02, RNF04 | Guardar mapeo y reglas **como una versión** y aplicarlas en orden; mostrar problemas por fila y contar válidos, inválidos y excluidos; un resultado identifica entrada, reglas, perfil y versión del motor; IDs como texto y precios decimales con moneda explícita. |
| F2 | [06, clase RuleSetVersion/Evaluation e invariantes](../../../../../docs-diagrams/06-dominio-y-datos-postgresql.md) | `ruleset_version` único por `(project, revision)`; versiones inmutables; `validos + invalidos + excluidos = total`; la columna identificadora no la cambian las reglas; precios sin `float`; no inferir moneda ni separador ambiguo; no mezclar proyectos en una referencia. |
| F3 | [07, puertos y contrato HTTP](../../../../../docs-diagrams/07-arquitectura-y-contratos.md) | `RuleSetRepository` y `EvaluationRepository`; `POST /projects/{id}/rulesets` → 201; `POST /projects/{id}/evaluations` → 202 con job; `GET /projects/{id}/evaluations/{id}` con conteos, muestra e informe paginado; `409` para configuración/revisión. |
| F4 | [08, secuencia de importación y evaluación](../../../../../docs-diagrams/08-secuencias-y-estados.md) | El trabajador reclama la evaluación, lee versiones fijadas, el motor normaliza, aplica reglas y valida, y los resultados completos se guardan antes de confirmar. |
| F5 | [01, alcance de la primera entrega](../../../../../docs-diagrams/01-producto-y-prototipo.md) | Tres reglas predefinidas: **limpiar texto, construir título y excluir productos por condición**; validación por fila; salida `errores.csv` con fila, producto, campo, problema y corrección sugerida. |
| F6 | [09, decisiones pendientes](../../../../../docs-diagrams/09-decisiones-y-plan-de-construccion.md) | «No crear de antemano tablas de reglas, feeds u organizaciones»: solo las de este incremento. |

## Código existente que la feature puede reutilizar

| ID | Archivo y símbolo | Observación |
| --- | --- | --- |
| F7 | [ProjectsService.findOwned](../../../../src/projects/projects.service.ts) y [projects.types.ts](../../../../src/projects/projects.types.ts), `ProjectConfiguration`, `hasCompleteConfiguration` | Acceso a un proyecto propio y configuración `country/currency/channelProfile`. `ChannelProfile` solo admite `'google_merchant'`. |
| F8 | [schema.prisma](../../../../prisma/schema.prisma), `CatalogSnapshot`, `CatalogRow`, `CatalogImportJob` | Snapshot con `headers Json?`, `idColumn`, `projectConfiguration Json` y `status`; filas con `externalId` y `originalValues Json`; job con `status`, `processedRows` y `error Json?`. Siete migraciones aplicadas; la última es `20261030000200_cascade_catalog_import_children`. |
| F9 | [CatalogImportRepository](../../../../src/catalog-import/catalog-import.repository.ts): `accept` (l. 107–115), `claim` (l. 377–395), `complete`, `interruptRunning`, `findSnapshot` (l. 274) | SQL parametrizado con `$queryRaw`; `FOR UPDATE` sobre el proyecto para serializar aceptaciones; `FOR UPDATE OF j SKIP LOCKED` para reclamar; solo los snapshots `ready` exponen muestra. |
| F10 | [CatalogImportWorker](../../../../src/catalog-import/catalog-import.worker.ts), `onApplicationBootstrap`, `onModuleDestroy`, `wake` | Un trabajador por proceso con sondeo, apagado ordenado y `interruptRunning` al arrancar. Es el patrón que la evaluación puede seguir o compartir. |
| F11 | [ArtifactStore](../../../../src/catalog-import/artifact.store.ts), `receive`, `finalize`, `listArtifacts`; [ArtifactCleanupService](../../../../src/catalog-import/artifact-cleanup.service.ts) | Archivos privados con clave interna y limpieza de huérfanos. Las evaluaciones guardarán resultados e informes como artefactos (F2). Hoy vive dentro de `catalog-import`. |
| F12 | [pagination.ts](../../../../src/common/http/pagination.ts), `PaginationQueryDto`, `resolvePage`, `PAGINATION` | Paginación `limit/offset` compartida REST/GraphQL, límite máximo 100. Sirve para el informe paginado. |
| F13 | [error-codes.ts](../../../../src/common/http/error-codes.ts), [public-error.ts](../../../../src/common/http/public-error.ts), [messages.ts](../../../../src/common/http/messages.ts) | Códigos estables `PROJECT_*`/`IMPORT_*` y mensajes es/en; la feature añadirá los suyos. |
| F14 | [src/graphql/](../../../../src/graphql/), `CatalogImportResolver`, `json.scalar.ts`, `pagination.args.ts` | Capa GraphQL separada que llama a los mismos servicios que REST ([settings/15](../../../../bitacora-construccion/settings/15-separar-capa-graphql.md)). |
| F15 | [package.json](../../../../package.json), scripts `test:features*`; [jest.features.config.mjs](../../../../jest.features.config.mjs) | Jest 30 con proyectos unit/integration/e2e; class-validator 0.15.1 y class-transformer 0.5.1 resueltos en el lockfile. Node 24.19.0 (`.nvmrc`). |

Persistencia vigente: Neon PostgreSQL ([settings/12](../../../../bitacora-construccion/settings/12-cambiar-cloud-sql-por-neon.md)). Los diagramas todavía dicen Cloud SQL; para esta feature manda el código.

## Lo que todavía no existe

No hay modelos, tablas, módulos, DTOs, rutas ni pruebas de reglas o evaluaciones. Tampoco hay un tipo de dominio para precios ni un perfil de validación de Google más allá del valor `'google_merchant'`. Los límites de `IMPORT_LIMITS` (5.000 filas, 200 columnas) acotan el tamaño de una evaluación, pero no se han medido para esta carga.

## Interpretación y límites

La evaluación se apoya en filas `ready` de un snapshot y en la configuración del proyecto congelada en `projectConfiguration` (F8). Reutilizar trabajador, artefactos y paginación es una inferencia de lectura del código, no una decisión tomada; el plan debe elegir entre compartir piezas o duplicarlas por feature. Esta ficha no ejecutó pruebas ni consultó Neon.
