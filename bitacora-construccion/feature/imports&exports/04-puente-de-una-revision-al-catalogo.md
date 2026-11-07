# 04 — E5.4: puente de una revisión de hoja al catálogo y al feed

Fecha de creación: 2026-11-07  
Última actualización: 2026-11-07  
Estado: Implementado y verificado.  
Relacionada con: [plan 01](../../../docs/plans/feature/imports&exports/01-plan-e5-importar-y-exportar-hojas.md) (D10, D22–D28), [fuentes 04](../../../docs/fonts/feature/imports&exports/04-fuentes-del-puente-a-catalogo.md), [bitácora 03 (E5.3)](03-exportar-una-revision-de-hoja.md).  
Revisión de partida: `main` `7921f00` más E4, E5.1, E5.1.1, E5.2 y E5.3 sin commit.

## Necesidad

Una hoja ya se revisa y se exporta, pero el recorrido del feed (reglas → evaluación → TSV → feed) solo lee snapshots de catálogo, que hoy nacen de un CSV subido o descargado. Falta llevar una revisión elegida a un snapshot nuevo sin tocar ese recorrido ni su contrato (T17).

## Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| H17, H20, H21, E11, E12, C35 | D22: adaptador en un módulo propio; CSV en `tmp/` y entrada por `CatalogImportService.accept`, como la actualización del feed; la procedencia en la transacción de `accept` | `WorksheetCatalogSnapshotsModule`; `ArtifactStore.writeImportUpload`; `AcceptanceRecorder` y el parámetro `recordSource` de `CatalogImportService.accept` y `CatalogImportRepository.accept` |
| H22, E12, E17 | D23: miembro con `worksheet.write`, organización activa y propietario del proyecto; se comprueba antes y dentro de la transacción, sin bloquear la organización | `assertCanSendToCatalog` (servicio) y `WorksheetCatalogSnapshotsRepository.findAccess` con `client` opcional |
| H17, H19, E14, E15 | D24: `idColumnId` obligatoria y entre las elegidas; columnas, filtro y orden de `rows/query`; cabeceras = nombres de columna | `CreateWorksheetCatalogSnapshotDto`, `parseRowQuery`, `csvPlanOf`, `originalNameOf` |
| H18, E13, E15 | D25: comprobar en la misma pasada lo que el worker rechazaría; 422 / 413 sin dejar nada | `writeCatalogCsv` y `CatalogCheck` (`catalog-csv.ts`), `assertAcceptable` |
| H18, H20, E14, E15 | D26: el texto de E5.3 y CSV con `formulas: 'keep'` | `CATALOG_CSV`, `exportCell`, `cellText`, `csvRecord`; `CATALOG_SERIALIZER_VERSION` |
| H17, E12, E16 | D27: tabla de procedencia con cascada desde el snapshot y evento de auditoría | `worksheet_catalog_snapshots` (modelo `WorksheetSnapshot`), `WorksheetCatalogSnapshotsRepository.insert`; migración `20261107120000_create_worksheet_catalog_snapshots` |
| H18, E15, E13 | D28: misma revisión y petición → mismo CSV; T17 por E2E | Orden total de `orderSql`; E2E que compara filas, evaluación y TSV con los del CSV equivalente |

## Ajustes al escribir el código

- **La lectura por páginas pasa al repositorio de filas.** E5.3 la tenía como método privado de su servicio; ahora es `WorksheetRowsRepository.pagesAt` y la usan la exportación y el puente. El comportamiento de E5.3 no cambia (sus pruebas pasan sin tocarlas), y una unitaria nueva cubre varias páginas, que ninguna prueba recorría: con 3 filas y páginas de 200 nunca se pasaba de la primera.
- **El paso extra solo se pasa cuando existe.** Pasar `undefined` como segundo argumento rompía una prueba existente del servicio de catálogo que comprueba los argumentos exactos de `repository.accept`. En lugar de cambiar esa aserción, `recordAcceptance` llama a `accept(acceptance)` si no hay paso extra y a `accept(acceptance, recordSource)` si lo hay.
- **El 422 necesitaba estar en la lista de códigos con `issues`.** El filtro de errores solo deja pasar `issues` para los códigos de `CODES_WITH_ISSUES`; la E2E lo detectó (el 422 llegaba sin filas) y se añadió `WORKSHEET_CATALOG_ROWS_INVALID` al final de la lista.
- **Nombres cortos en Prisma.** `prisma format` alinea cada modelo por su campo más largo: un nombre de relación largo realineaba `AppUser`, `CatalogSnapshot`, `Worksheet` y `WorksheetRevision` enteros (67 líneas cambiadas en archivos compartidos). Con el modelo `WorksheetSnapshot` y las relaciones `worksheetSnapshots`, `snapshots` y `worksheetSource`, el diff del esquema solo añade líneas.
- **Prisma exige `@@unique([projectId, snapshotId])`** para la relación uno a uno con `CatalogSnapshot` por su clave compuesta; la migración crea ese índice aunque `snapshot_id` ya sea la clave primaria.
- **Si la celda del identificador ya tiene un problema** (por ejemplo, obligatoria y vacía), no se informa además de «identificador vacío»: una sola causa por celda.
- **La revisión se lee con `WorksheetRowsRepository.findRevision`**, la misma de `rows/query`; el repositorio propio solo lee el acceso (con el nombre de la hoja) y guarda o lee la procedencia.
- **Una hoja nueva empieza en la revisión 1** (vacía); la primera importación aplicada crea la 2. La prueba esperaba 1 y se corrigió.

## Implementación

Rutas bajo `P = /organizations/:organizationId/projects/:projectId`:

| Ruta | Respuesta |
| --- | --- |
| `POST P/worksheets/:worksheetId/catalog-snapshots` | 202 `{ catalogSnapshot, snapshotId, jobId, status: 'queued', statusUrl }`, la misma forma que una importación (`statusUrl` es la ruta existente del trabajo). Cuerpo: `idColumnId` y, opcionales, `revisionId`, `columns`, `filter` y `sort`. |
| `GET P/worksheet-catalog-snapshots/:snapshotId` | 200 `{ catalogSnapshot }`: hoja, revisión, autor, columna identificadora, columnas con su cabecera, filtro, orden, filas, SHA-256 y versión del serializador. Lo ve cualquier miembro; lo ajeno, 404. |

El snapshot, su trabajo y sus filas se consultan, evalúan, exportan y borran por las rutas existentes del propietario (`/projects/:projectId/imports`, `jobs`, `evaluations`, `exports`, `feed`), sin ningún cambio.

Recorrido de `create`:

1. Usuario actual y acceso: miembro de la hoja (404), organización activa (409 `ORGANIZATION_ARCHIVED`), `worksheet.write` (403 `FORBIDDEN`) y propietario del proyecto (403 `WORKSHEET_CATALOG_OWNER_REQUIRED`).
2. Revisión pedida o la actual (404), sus columnas y la consulta validada como en `rows/query`; la columna identificadora, entre las elegidas (400 `CATALOG_ID_COLUMN_INVALID`).
3. CSV en `tmp/` por páginas de 200 filas (`ArtifactStore.writeImportUpload` + `writeCatalogCsv`), con BOM, coma, CRLF y los textos sin tocar. En la misma pasada se comprueba cada fila; si algo falla, 422 `WORKSHEET_CATALOG_ROWS_INVALID` (con `rows.<rowId>.<columnId>`, hasta 500), 422 `WORKSHEET_CATALOG_EMPTY` o 413 `WORKSHEET_CATALOG_TOO_LARGE`, y el temporal se borra.
4. `CatalogImportService.accept` con ids planificados: enlaza el CSV en `artifacts/`, inserta snapshot y trabajo y, en la misma transacción, vuelve a comprobar el acceso y guarda la procedencia con su evento `worksheet.catalog_snapshot.created`. Los errores de `accept` (proyecto sin configurar, importación activa, base caída) se devuelven tal cual y el temporal se retira.
5. El worker de importaciones procesa el CSV como cualquier otro y compara su SHA-256 con el aceptado.

Archivos:

- `src/worksheet-catalog-snapshots/`: `catalog-csv.ts` (`writeCatalogCsv`, `CatalogCheck`), `worksheet-catalog-snapshots.{module,controller,service,repository,dto,types}.ts`.
- `src/catalog-import/catalog-import.repository.ts` (`AcceptanceRecorder`, `accept(input, recordSource?)`) y `catalog-import.service.ts` (`accept(..., plannedIds?, recordSource?)`): `catalog-import` no importa nada de hojas.
- `src/artifacts/artifact.store.ts` (`writeImportUpload`).
- `src/worksheets/worksheet-rows.repository.ts` (`pagesAt`, `AllRowsAtRevision`) y `src/worksheet-exports/worksheet-exports.service.ts` (lo usa en lugar de su método privado).
- `src/common/http/api-exception.filter.ts` (`WORKSHEET_CATALOG_ROWS_INVALID` en `CODES_WITH_ISSUES`); 9 códigos al final de `error-codes.ts` y `messages.ts`; `src/app.module.ts`.
- `prisma/schema.prisma` (`WorksheetSnapshot` y sus relaciones) y `prisma/migrations/20261107120000_create_worksheet_catalog_snapshots/` (`CHECK` de columnas, filas y SHA-256; claves foráneas al snapshot del mismo proyecto con cascada, a la hoja, a la revisión de esa hoja y al usuario). Añadida a `test/prisma-migrations.test.mjs`; el recuento de `projects.repository.int-spec.ts` pasa a 29.

## Comprobaciones realmente ejecutadas

2026-11-07, Node 26.9, en el portátil de desarrollo.

- **Pruebas nuevas:**
  - `catalog-csv.spec.ts`: el CSV que se escribe lo lee el parser real del catálogo (`parseCatalogCsv`) con los mismos textos (ceros y espacios, decimal, fecha anterior a 1900, booleano, etiqueta de selección, calculada, texto con `=` sin apóstrofo, saltos de línea y comas); identificador vacío, en blanco o repetido; celdas con problema; sin repetir el problema del identificador; registro de más de 1 MiB; 413 al pasar de 10 MiB; tope de 500 problemas; sin filas;
  - `artifact-store-import-upload.spec.ts`: el CSV queda en `tmp/` como una subida (tamaño, SHA-256, permisos 0600), `finalize` lo enlaza y si quien escribe falla no queda nada;
  - `worksheet-rows-pages.spec.ts`: `pagesAt` recorre varias páginas, sin una página vacía al final y sin filas;
  - `worksheet-catalog-snapshots.e2e-spec.ts` (12 pruebas, dos propietarios): **T17** (la revisión llega a un snapshot `ready` cuyas filas son las mismas que las del CSV equivalente subido por la ruta de siempre, y cuya evaluación, `resultChecksum` y TSV son idénticos byte a byte; evento de auditoría), revisión fija con el mismo SHA-256 después de avanzar la hoja, columnas, filtro y orden, 422 con las filas, 422 sin filas, 400 por la columna identificadora, acceso (ajeno 404, lector 403, editor u `owner` que no es propietario del proyecto 403, archivada 409), organización archivada mientras se escribe el CSV (409 dentro de la transacción), importación activa (409), fallo al enlazar el CSV (503 sin temporal), procedencia que no se guarda (503 sin snapshot ni archivo), borrado por la ruta existente con cascada, y SHA-256 del archivo guardado.
- **Suite completa** (`pnpm test:features`): 86 suites y 1.442 pruebas, todas pasan (antes de E5.4: 82 y 1.409). Las suites de catálogo, evaluaciones, exportaciones TSV, feeds, actualizaciones y E5.3 pasan sin cambiar ninguna aserción.
- **`pnpm db:verify`** (regresión de migraciones y conexión): 3 de 3.
- **`tsc --noEmit`**, **`pnpm lint`** (oxlint) y **`prettier --check src test/features`**: limpios. Ningún carácter invisible en los archivos nuevos (`perl`).
- **Esquema frente a migraciones** (`prisma migrate diff` con PGlite como base sombra): «This is an empty migration» con 29 migraciones.
- **Arranque real** de `AppModule`, con sus workers, y PGlite en un puerto (una conexión). Hoja de 5.000 filas × 200 columnas (las 8 del ruleset y 192 más) importada por CSV y aplicada; después:
  - llevarla al catálogo: 202 en 1.092 ms, con un bloqueo máximo del bucle de eventos de 29 ms;
  - el worker de importaciones la dejó `ready` en 1,8 s: 5.000 filas, 200 cabeceras, 7,2 MB, mismo SHA-256 que la procedencia, nombre `Productos 2026 (revisión 2).csv`;
  - ruleset, evaluación (5.000: 4.500 válidos y 500 excluidos por no tener marca, en 1,1 s), exportación y descarga del TSV con 4.500 productos;
  - la misma revisión otra vez da el mismo SHA-256; con la marca como identificador, 422; la procedencia se lee por GET; `/health` responde.
- **Hallazgo fuera de E5.4:** en este arranque, **importar la hoja de partida** (E5.1, `POST …/imports` con 5.000 × 200 textos y decimales) **respondió 500** a los 6 s: su transacción usa el plazo por defecto de Prisma (5 s). En una copia temporal con un plazo de 30 s tardó 6,8 s y funcionó, y con ella se hicieron las medidas de arriba. Con PGlite en el mismo proceso todo es más lento que en PostgreSQL; en Neon no se ha medido. No se cambia aquí: es de E5.1 y queda para decidir.
- **Sin comprobar:** el TSV generado desde una hoja no se ha cargado en Merchant Center (tampoco el de un CSV; sigue pendiente del piloto).

## Defectos a propósito

33 defectos, cada uno en una copia limpia del repositorio, con las pruebas del puente, del almacén, de `pagesAt` y de toda la importación de catálogo (126 pruebas). **Todos detectados**; restaurado el código, las 126 pasan.

| Defecto | Lo detecta |
| --- | --- |
| P1 escapa fórmulas; P2 punto y coma; P3 sin BOM; P4 calculadas sin evaluar; P10 cabecera con IDs | Prueba del parser del catálogo y T17 |
| P5 sin problemas de celda; P6 identificador en blanco aceptado; P7 repetidos aceptados; P8 sin límite de registro; P9 sin límite de archivo | Unitarias de `writeCatalogCsv` y E2E del 422 |
| P11 acepta con problemas; P12 acepta sin filas; P20 identificador fuera de las columnas | E2E del 422 y del 400 |
| P13 sin exigir propietario; P14 sin permiso de escritura; P15 archivada aceptada; P16 acceso sin membresía | E2E de acceso |
| P17 ignora la revisión pedida; P18 ignora el filtro; P19 ignora el orden | E2E de revisión fija y de consulta |
| P21 sin recomprobar en la transacción | E2E «se archiva mientras se escribe el CSV», **añadida al preparar los defectos** |
| P22 temporal sin retirar si `accept` falla | E2E «si el CSV no se puede enlazar», **añadida tras la primera tanda**: no la detectaba nada, porque con una importación activa `accept` ya había movido el temporal antes de fallar |
| P23 identificador por ID en `accept`; P33 serializador sin versión | T17 (el snapshot falla o la procedencia cambia) |
| P24 `accept` ignora el paso extra; P26 procedencia sin cascada; P27 sin auditoría; P28 lectura de procedencia sin membresía | E2E de procedencia, borrado y T17 (las dos últimas comprobaciones, **añadidas al preparar los defectos**) |
| P25 `issues` del 422 filtrados | E2E del 422 |
| P29 subida sin su SHA-256 | Prueba del almacén y E2E (el worker rechaza el archivo) |
| P30 páginas saltadas; P31 página vacía entregada; P32 sin la última página | `worksheet-rows-pages.spec.ts`, **nueva**: con 3 filas las E2E nunca pasan de la primera página |

## Consecuencias

- **El feed ya se puede generar desde una revisión elegida** ([12], «Aceptación»): hoja → snapshot nuevo → reglas → evaluación → TSV → feed, sin cambiar ninguna ruta ni respuesta anterior. Llevar una hoja al catálogo es siempre una acción explícita: publicar una revisión no crea snapshots ni publica el feed.
- **E5 queda cerrada en la API** (E5.1–E5.4), sin commit.
- **Migración sin aplicar en Neon**: `20261107120000_create_worksheet_catalog_snapshots`, junto con las de E5.2 y E5.3 (Neon tiene 26; local, 29). Se aplican con `pnpm db:status` y después `pnpm db:migrate`. **Actualización 2026-11-07: aplicada en Neon por el usuario con `pnpm db:migrate` (Neon tiene las 29 migraciones).**
- **Solo el propietario del proyecto puede llevar una hoja a su catálogo** mientras E1.2 siga aplazada: el catálogo, las reglas, las evaluaciones y el feed siguen siendo suyos. Cuando E1.2 pase esas rutas a membresía, este 403 se sustituye por el permiso de la organización.
- **Por decidir:** el plazo de la transacción de importación de hojas (E5.1) con 5.000 × 200 (hallazgo del arranque real).
- **Aplazado:**
  - el vínculo inverso de [12] (usar un snapshot terminado como origen de una hoja nueva): no lo pide ninguna decisión de E5;
  - listar los snapshots de una hoja: la procedencia se lee por su id, y el listado de importaciones del proyecto ya los muestra con su nombre (`<hoja> (revisión N).csv`).
