# 04 — Fuentes del puente de una revisión de hoja al catálogo y al feed (E5.4)

Fecha de creación: 2026-11-07  
Última actualización: 2026-11-07  
Estado: Investigación. Respalda D22–D28 del [plan 01](../../../plans/feature/imports&exports/01-plan-e5-importar-y-exportar-hojas.md).  
Relacionada con: [fuentes 03, exportar](03-fuentes-de-exportar-hojas.md), [hojas, «Puente al catálogo y feed existentes»](../../../../../docs-diagrams/12-hojas-modelo-editor-importacion-y-exportacion.md), [entregas, T17](../../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md), [backend y transición](../../../../../docs-diagrams/11-backend-nest-organizaciones-y-transicion.md).  
Revisión de partida: `main` `7921f00` más E4, E5.1, E5.1.1, E5.2 y E5.3 sin commit.

## Pregunta

¿Cómo se convierte una revisión fija de una hoja en un snapshot de catálogo nuevo, para que el recorrido existente (reglas → evaluación → TSV → feed) funcione sin cambiar su contrato y sin escribir por fuera de las invariantes de `catalog-import`?

## Estado real del código

| ID | Archivo y símbolo | Hallazgo | Consecuencia |
| --- | --- | --- | --- |
| E11 | [`CatalogImportService.accept`](../../../../src/catalog-import/catalog-import.service.ts), [`FeedRefreshSteps.acceptDownload`](../../../../src/feed-refreshes/feed-refresh.steps.ts) | Un snapshot solo nace de un CSV ya escrito en `tmp/` (`StoredUpload`: nombre, tamaño y SHA-256). `accept` lo enlaza en `artifacts/`, registra snapshot y trabajo en cola, y despierta al worker. La actualización del feed ya entra así con un CSV que no subió una persona (lo descarga): si `accept` falla, borra su temporal. | El puente entra por el mismo camino, con un CSV generado desde la revisión. No escribe `catalog_snapshots` ni `catalog_rows` por su cuenta. |
| E12 | [`CatalogImportRepository.accept`](../../../../src/catalog-import/catalog-import.repository.ts) | En una transacción: bloquea el proyecto `FOR UPDATE` con `owner_id = ownerId` (404 si no), exige país, moneda y perfil de canal (`PROJECT_CONFIGURATION_REQUIRED`) y rechaza si ya hay una importación activa (`IMPORT_ALREADY_ACTIVE`). | Lo que el puente añada (procedencia, auditoría) debe ir en esa misma transacción para no dejar un snapshot sin procedencia. |
| E13 | [`parseCatalogCsv`](../../../../src/catalog-import/csv-parser.ts), `IMPORT_LIMITS` | El worker lee el CSV de forma asíncrona: cabeceras no vacías, únicas, hasta 128 caracteres y 200 columnas; identificador no vacío (tras `trim`) y único; registro de 1 MiB como mucho; 10 MiB y 5.000 filas; BOM admitido; sin conversiones. Un fallo deja el snapshot `failed`, después de haber respondido 202. Al terminar compara SHA-256, bytes y filas con lo aceptado (`matchesParsedFile`). | El puente comprueba antes de aceptar lo que el worker rechazaría, para responder el error en la propia petición. Hojas: 200 columnas, nombres de hasta 120 caracteres y únicos sin distinguir mayúsculas, 5.000 filas y textos de 8.192 caracteres ([`WORKSHEET_LIMITS`](../../../../src/worksheets/worksheet-columns.ts), [`MAX_TEXT_LENGTH`](../../../../src/worksheets/cell-values.ts)): cabeceras y filas caben siempre; el tamaño del archivo y del registro, no. |
| E14 | [`evaluate-row.ts`](../../../../src/evaluations/engine/evaluate-row.ts), [`price.ts`](../../../../src/evaluations/engine/price.ts), [`EvaluationsRepository`](../../../../src/evaluations/evaluations.repository.ts) | La evaluación lee `originalValues[columna]` según el mapeo del ruleset, que nombra columnas por su cabecera; al crearla comprueba que el snapshot está `ready` y que las columnas del mapeo existen. El precio es texto decimal con punto y hasta dos decimales. | Las cabeceras del snapshot son los nombres de columna de la hoja y cada valor, su texto canónico: un ruleset escrito para el CSV equivalente sirve sin cambios. |
| E15 | [`evaluateRow`](../../../../src/worksheets/row-evaluation.ts), [`exportCell`/`cellText`](../../../../src/worksheet-exports/export-cells.ts), [`csvRecord`](../../../../src/worksheet-exports/export-csv.ts) (E5.3) | E5.3 ya convierte una fila evaluada en texto sin pérdida: decimal canónico, fecha `YYYY-MM-DD`, `true`/`false`, etiqueta de la selección y resultado de la calculada; `evaluateRow` da cada problema con su columna. `csvRecord` con `formulas: 'keep'` no altera ningún texto. | Se reutilizan las mismas piezas con `keep`: [12] prohíbe «reutilizar una sanitización que altere datos del feed». |
| E16 | `CatalogImportRepository.deleteSnapshot`, `deleteProject`, `hasWorkbooks` | Borrar una importación borra la fila de `catalog_snapshots` (sus filas y su trabajo caen en cascada). Un proyecto con libros no se puede borrar (409). | La procedencia cae en cascada con su snapshot; la revisión de hoja nunca se borra. |
| E17 | [`lockProjectFor`](../../../../src/worksheets/worksheets.repository.ts), `CatalogImportRepository.accept` | Las escrituras de hojas bloquean primero la organización; crear un libro inserta una fila que referencia el proyecto (la clave foránea toma `FOR KEY SHARE` sobre él). `accept` bloquea el proyecto `FOR UPDATE`. | *Inferencia:* bloquear la organización dentro de `accept` invertiría el orden y podría producir un interbloqueo. Dentro de esa transacción el puente solo vuelve a leer membresía y archivado, sin bloquear. |

## Requisitos

| ID | Documento y pasaje | Qué exige |
| --- | --- | --- |
| H17 | [12], «Puente al catálogo y feed existentes», líneas 91–104 | Flujo `Revisión de hoja aprobada → Adaptador de fuente de catálogo → Nuevo CatalogSnapshot ready → Ruleset y Evaluation existentes → Revisión y TSV existentes`. El adaptador «genera una entrada nueva compatible con `catalog-import` o su caso de uso interno de creación de snapshot; registra hoja/revisión/mapping/hash como procedencia. No escribe por fuera de las invariantes del módulo». Los datos quedan materializados para sobrevivir al archivado de la hoja. Una revisión publicada no publica un feed automáticamente. |
| H18 | [18], T17, línea 78 | «Adaptador de hoja crea snapshot nuevo; evaluación/TSV siguen reproducibles», por «Regresión existente + E2E». |
| H19 | [12], «Aceptación», línea 112 | «feed existente generado desde una revisión elegida». |
| H20 | [13], línea 15 | `CatalogSnapshot`, `RulesetVersion`, `Evaluation` y la aprobación del TSV «conservan sus significados». |
| H21 | [10], líneas 48 y 51 | «los snapshots actuales siguen siendo entradas de catálogo»; el feed Google «se conecta a las hojas mediante un adaptador explícito». |
| H22 | [11], línea 109, y [contexto del workspace](../../../../../CONTEXTO-SIGUIENTE-CHAT.md), «E1.2 retirada» | Mantener el contrato de feeds y no mutar snapshots. Las rutas de catálogo, reglas, evaluaciones, exportaciones y feed siguen siendo del **propietario del proyecto**: el acceso por membresía (E1.2) se aplazó. |

## Cursos

| ID | Fuente y localizador | Evidencia | Uso |
| --- | --- | --- | --- |
| C35 | **DDD y Microservicios** (Udemy, «Learn how to build Microservices applications starting with business analysis and domain driven design»), `Arquitectura/DDD y Microservicios/Sección 6 Bounded Context Relationships/29. Asymmetric Relationship Patterns.md`, líneas 23–31 | Cuando un contexto no adopta el modelo de otro, la traducción entre los dos se aísla en una capa propia: «isolate this translation logic in a separate layer» (línea 23). Esa capa conoce los dos modelos, y los dos contextos se ignoran entre sí. | Un módulo nuevo, el adaptador, conoce hojas y catálogo; `catalog-import` no importa nada de hojas y las hojas no saben de snapshots. *Adaptación:* aquí el contexto de llegada (catálogo) ya existe y no cambia, así que la traducción va de la hoja al formato que el catálogo ya acepta (su CSV). |

## Alternativas

| Alternativa | Por qué no |
| --- | --- |
| Insertar `catalog_snapshots` y `catalog_rows` directamente desde la revisión | Escribe por fuera de las invariantes del módulo (H17): sin artefacto, sin hash comprobado por el worker y sin el bloqueo de «una importación activa». |
| Reutilizar el archivo de una exportación de E5.3 | Por defecto protege fórmulas con un apóstrofo, lo que altera datos del feed (E15, [12]); además una exportación puede pesar 50 MiB y el catálogo admite 10. |
| Generar el CSV en un trabajo durable | El peor caso de E5.3 (5.000 × 200) se escribe en ~1 s; el procesamiento del snapshot ya es asíncrono en el worker existente. |
| Dejar que el worker descubra identificadores vacíos o repetidos | El snapshot fallaría después de responder 202, sin decir qué fila: el puente lo comprueba antes, con la fila y la columna. |

## Mapa

| Necesidad | Requisito | Fuentes | Decisión |
| --- | --- | --- | --- |
| Crear el snapshot sin saltarse el módulo | H17, H20, H21 | E11, E12, C35 | D22 |
| Quién puede hacerlo | H22 | E12, E17 | D23 |
| Qué se pide | H17, H19 | E14, E15 | D24 |
| Que el worker no falle tarde | H18 | E13, E15 | D25 |
| Mismos datos que el CSV equivalente | H18, H20 | E14, E15 | D26 |
| Procedencia junto al snapshot | H17 | E12, E16 | D27 |
| Reproducible | H18 | E15, E13 | D28 |
