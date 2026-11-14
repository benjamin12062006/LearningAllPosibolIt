# 01 — Estado real y antecedentes de reviews y exports

Fecha de creación: 2026-11-01  
Estado: Investigación; feature sin plan ni código.  
Tipo de fuente: código local, bitácoras del proyecto y requisitos de `docs-diagrams`.  
Origen: API `LearningAllPosibolIt` (copia de aprendizaje de `estadistica-forms-api`) y `docs-diagrams`.  
Fecha de consulta: 2026-11-01  
Revisión inspeccionada: `d5e8f54` («docs: registrar migraciones de rulesets y evaluaciones aplicadas en Neon») en `main`; árbol limpio salvo `.idea/dataSources.xml`, que no forma parte de esta feature. La raíz KSuT no es un repositorio Git.  
Relacionada con: [fuentes técnicas](02-fuentes-tecnicas.md), [cursos y reconstrucciones](03-cursos-y-reconstrucciones.md), [mapa para el plan](04-mapa-de-necesidades-para-el-plan.md), [plan anterior](../../../plans/feature/rulesets&evaluations/01-plan-rulesets-y-evaluations.md), [bitácora 04 de evaluaciones](../../../../bitacora-construccion/feature/rulesets&evaluations/04-informe-de-la-evaluacion.md).

## Necesidad

Delimitar qué exige el incremento 3 (revisión y exportación TSV, RF05), qué código existente lo condiciona y qué debe decidir el plan. Esta ficha no propone implementación: separa lo observado de lo que queda abierto.

## Línea base medida (2026-11-01)

| Comprobación | Resultado |
| --- | --- |
| `git status --short --branch` | `## main`; solo `?? .idea/dataSources.xml`. `feature/rulesets-evaluations` apunta también a `d5e8f54`. |
| `pnpm test:features` | 25 suites y 425 pruebas en verde (35,8 s). |
| Node | `pnpm exec node --version` → v26.9.0. `.nvmrc` fija 24.19.0, que no está instalada. |

`pnpm db:verify` y `pnpm db:status` no se ejecutaron en esta fase; el estado de Neon (9 migraciones aplicadas) procede del mensaje de traspaso y de la [bitácora 04](../../../../bitacora-construccion/feature/rulesets&evaluations/04-informe-de-la-evaluacion.md).

## Qué feature sigue

`docs-diagrams/09` ordena: 1a `projects`, 1b `catalog-import`, 1c interfaz Nuxt, 2 mapeo, reglas y evaluación, **3 revisión y exportación TSV** ([09, incrementos](../../../../../docs-diagrams/09-decisiones-y-plan-de-construccion.md)). 1a, 1b y 2 están implementados en esta API. 1c pertenece al repositorio web y queda fuera. La feature se nombra `reviews&exports` por sus recursos HTTP previstos.

## Requisitos que debe cumplir (especificación, no evidencia de ejecución)

| ID | Fuente y localizador | Exigencia |
| --- | --- | --- |
| F1 | [05, RF05/UC05 y «Actividad de revisión»](../../../../../docs-diagrams/05-analisis-y-requisitos.md) | Exportar **únicamente la evaluación revisada**; confirmar las exclusiones; bloquear un feed vacío. Con filas inválidas: corregir y reevaluar, o confirmar expresamente su exclusión. Las exclusiones por reglas aparecen en el resumen. La actividad comprueba si hay válidos, muestra errores y exclusiones, pide confirmación y vuelve a comprobar que la evaluación **sigue vigente** antes de generar el TSV. |
| F2 | [06, invariantes 1, 3, 4 y 5; diccionario `feed`/`feed_version`](../../../../../docs-diagrams/06-dominio-y-datos-postgresql.md) | Ninguna referencia mezcla proyectos (FK compuestas cuando proceda). Una fila inválida no llega al TSV. Aprobar una vista previa no aprueba una revisión posterior. El feed apunta solo a un archivo completo y verificado; los archivos quedan fuera de la transacción. Los TSV viven detrás de `ArtifactStore`; PostgreSQL guarda metadatos y referencias. |
| F3 | [07, puertos y contrato HTTP](../../../../../docs-diagrams/07-arquitectura-y-contratos.md) | `POST /api/v1/projects/{id}/exports` → «TSV de la evaluación confirmada». `ArtifactStore`: guardar, finalizar, leer y retirar artefacto no referenciado; claves internas, nunca rutas del usuario. `FeedRepository` y publicación son de la fase B. Errores previstos: 400, 401, 404, 409, 422, 503. |
| F4 | [08, «Publicación consistente»](../../../../../docs-diagrams/08-secuencias-y-estados.md) | En A, el mismo archivo se genera como **descarga privada**. La aprobación identifica **la evaluación, la suma de comprobación y las exclusiones aceptadas**. El archivo se finaliza y verifica antes de cambiar referencias en SQL. |
| F5 | [01, «Qué recibe exactamente el cliente»](../../../../../docs-diagrams/01-producto-y-prototipo.md) | Salida `productos.tsv`, delimitada por tabuladores, para Merchant Center. Superar nuestras validaciones no garantiza la aprobación de Google. |
| F6 | [09, ADR04, ADR05, incremento 3 y decisiones pendientes](../../../../../docs-diagrams/09-decisiones-y-plan-de-construccion.md) | Versiones inmutables; archivos detrás de `ArtifactStore`. Aceptación del incremento 3: «Revisar exclusiones y exportar la evaluación confirmada; procesar TSV en una cuenta piloto». «No crear de antemano tablas de reglas, feeds u organizaciones». |

Fuera de la fase A: URL estable del feed, `published_version`, publicaciones, `/feeds/{token}.tsv` y política automática (F2, F3, F4).

## Código existente que condiciona la feature

| ID | Código y localizador | Observación |
| --- | --- | --- |
| F7 | [schema.prisma](../../../../prisma/schema.prisma), `Evaluation`, `EvaluationRow`; [migración de evaluaciones](../../../../prisma/migrations/20261101000200_create_evaluations/migration.sql) | `status` ∈ `queued/running/succeeded/failed`; en `succeeded` el `CHECK` exige conteos, `result_checksum` (SHA-256 hex) y `válidos + inválidos + excluidos = total`. `evaluation_rows`: `excluded` sin valores ni problemas; `valid` con valores y sin problemas; `invalid` con valores y al menos un problema. El índice único `evaluations (project_id, id)` está creado «para claves foráneas compuestas futuras (exportación, incremento 3)». |
| F8 | [google-merchant.profile.ts](../../../../src/evaluations/engine/google-merchant.profile.ts), `PROFILE_VERSION` (l. 8), `PRODUCT_ATTRIBUTES` (l. 11), `withNormalizedPrice` (l. 127) | Orden fijo de atributos `title, description, link, image_link, price, availability, condition, brand`; `id` sale de la columna identificadora (`external_id`). `product_values` ya guarda el precio normalizado (`"15.00 USD"`). |
| F9 | [evaluation-summary.ts](../../../../src/evaluations/engine/evaluation-summary.ts), `EvaluationSummary`, `canonicalLine` (l. 76) | `result_checksum` es el SHA-256 de una serialización canónica propia de los resultados por `source_row`. Identifica el **resultado de la evaluación**, no un archivo TSV. |
| F10 | [artifact.store.ts](../../../../src/catalog-import/artifact.store.ts), `ARTIFACT_KEY_PATTERN` (l. 21), `receive` (l. 44), `finalize` (l. 81), `syncDirectory` (l. 146) | Solo admite claves `<uuid>.csv`. Carpetas `tmp/` y `artifacts/`; `receive` escribe con `open(…, 'wx', 0o600)` y `sync`; `finalize` enlaza con `link` exclusivo y sincroniza el directorio. Está pensado para subidas: no hay operación para escribir un archivo generado por la propia API. |
| F11 | [artifact-cleanup.service.ts](../../../../src/catalog-import/artifact-cleanup.service.ts), `removeOrphanArtifacts` (l. 53); [`findReferencedArtifactKeys`](../../../../src/catalog-import/catalog-import.repository.ts) (l. 360) | Al arrancar borra todo `<uuid>.csv` de `artifacts/` con más de una hora que no referencie **un snapshot** (`catalog_snapshots.artifact_key`). Un TSV guardado con la misma clave en la misma carpeta se borraría; con otra extensión, `pathOf` lo rechazaría. |
| F12 | [catalog-import.module.ts](../../../../src/catalog-import/catalog-import.module.ts) | `ArtifactStore` y `ArtifactCleanupService` son proveedores privados del módulo (solo exporta `CatalogImportService`). La raíz es `CATALOG_IMPORT_ROOT` o `.data/catalog-import`. El plan anterior (D8) aplazó generalizar piezas compartidas «con el trabajo de exportación». |
| F13 | [evaluations.controller.ts](../../../../src/evaluations/evaluations.controller.ts), `downloadErrorsCsv` (l. 70); [errors-csv.ts](../../../../src/evaluations/errors-csv.ts) | Patrón vigente de descarga: serializador puro → `Buffer` → `StreamableFile` con `type` y `disposition`. `errores.csv` lleva BOM y antepone un tabulador a celdas con riesgo de fórmula (OWASP): esa mitigación **altera el valor** y no sirve para un TSV que lee Google. |
| F14 | [catalog-import.repository.ts](../../../../src/catalog-import/catalog-import.repository.ts), `deleteSnapshot` (l. 285), `deleteProject` (l. 329); plan anterior, D14 | `evaluations → catalog_snapshots` es `ON DELETE CASCADE`; `evaluations → ruleset_versions`, `RESTRICT`. Borrar un snapshot borra sus evaluaciones y filas. D14 dejó pendiente revisar estas cascadas cuando algo referencie evaluaciones. Hoy los borrados devuelven claves de artefacto de snapshots para retirarlas después del commit. |
| F15 | [bitácora 04](../../../../bitacora-construccion/feature/rulesets&evaluations/04-informe-de-la-evaluacion.md), «Medición» (l. 77–82) | `errores.csv` de 1.667 filas inválidas: 13 ms y 276.048 bytes; evaluación de 5.000 filas: 730–744 ms. Medido en PGlite dentro de Jest; no predice Neon y no aísla memoria. |
| F16 | [api-exception.filter.ts](../../../../src/common/http/api-exception.filter.ts), `CODES_WITH_ISSUES` (l. 116); [messages.ts](../../../../src/common/http/messages.ts) | Solo los códigos de `CODES_WITH_ISSUES` conservan `issues` (con `field` y `code`). Cada `ErrorCode` nuevo necesita texto es/en, comprobado por `messages.spec.ts`. |

## Hallazgos que el plan debe tener en cuenta

1. **Valores con tabuladores o saltos de línea.** `clean_text` y `build_title` colapsan espacios (`WHITESPACE_RUN = /\s+/gu`, [evaluate-row.ts](../../../../src/evaluations/engine/evaluate-row.ts) l. 50 y 204), pero solo cuando una regla se aplica a ese atributo. Una `description` o un `brand` sin regla pueden conservar `\t` o `\n`. Los enlaces se rechazan si contienen espacios en blanco. No se comprobó si `external_id` puede contener tabuladores (el parser usa `trim: false`, [csv-parser.ts](../../../../src/catalog-import/csv-parser.ts) l. 119).
2. **Qué identifica la aprobación.** F4 exige evaluación, suma y exclusiones aceptadas. `result_checksum` (F9) ya identifica el resultado; la suma del TSV generado sería otra distinta. El plan debe decidir cuál aprueba el operador y cuál se guarda.
3. **«Sigue vigente».** Las evaluaciones son inmutables (F7), pero un snapshot puede borrarse y arrastrar su evaluación en cascada (F14). Una evaluación no queda «obsoleta» por sí sola salvo que exista una más reciente para el proyecto; el criterio no está definido en los diagramas.
4. **Excluidas sin valores.** Las filas `excluded` no guardan `product_values` (F7): el resumen de exclusiones solo puede mostrar `source_row`, `external_id` y `excluded_by_rule`.

## Límites de esta ficha

- No se leyó `estadistica-forms-api` (el original): se trabaja solo en la copia.
- Los diagramas citan Cloud SQL; para la base manda el código (Neon con `@prisma/adapter-pg`).
- GraphQL de rulesets y evaluaciones sigue pendiente (plan `02` de la feature anterior) y no entra aquí.
