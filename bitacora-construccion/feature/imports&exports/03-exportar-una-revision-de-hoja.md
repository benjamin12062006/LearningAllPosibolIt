# 03 — E5.3: exportar una revisión de hoja a CSV o XLSX

Fecha de creación: 2026-11-07  
Última actualización: 2026-11-07  
Estado: Implementado y verificado.  
Relacionada con: [plan 01](../../../docs/plans/feature/imports&exports/01-plan-e5-importar-y-exportar-hojas.md) (D10, D15–D21), [fuentes 03](../../../docs/fonts/feature/imports&exports/03-fuentes-de-exportar-hojas.md), [bitácora 02 (E5.2)](02-importar-xlsx-a-un-borrador.md), [plan de reviews y exports](../../../docs/plans/feature/reviews&exports/01-plan-reviews-y-exports.md).  
Revisión de partida: `main` `7921f00` más E4, E5.1, E5.1.1 y E5.2 sin commit.

## Necesidad

Ya se puede llevar un archivo a una hoja (E5.1, E5.2), pero no sacar una hoja a un archivo. Falta exportar una revisión fija a CSV o XLSX con las columnas y el filtro elegidos, sin perder valores, con un checksum y sin que el CSV ejecute fórmulas al abrirlo (T16). Es el último tramo de «archivo → borrador → revisión → archivo».

## Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| E6 (el TSV de evaluaciones se genera, se relee y se guarda en la petición); medición: 5.000 × 200 en 1 s | D15: dentro de la petición, sin trabajo; se adapta [16] (202) | `WorksheetExportsService.create`; rutas en `WorksheetExportsController` |
| H11, H14, E8 | D16: revisión fija, columnas, filtro y orden con la validación de `rows/query`; opciones de CSV solo en CSV | `CreateWorksheetExportDto`, `parseRowQuery`, `exportOptionsOf`; procedencia en `worksheet_exports.query` y `options` |
| H15, F69, E9 | D17: cada celda con su tipo; más de 15 cifras o fecha anterior al 1900-03-01 → texto | `exportCell` (`export-cells.ts`); las calculadas salen de `evaluateRow` |
| F8, F66, F67, C34 | D18: RFC 4180, CRLF, BOM; apóstrofo delante de los textos peligrosos | `csvRecord`, `csvHeader`, `FORMULA_START_PATTERN` (`export-csv.ts`) |
| Spike (ficha 03), F68, F70 | D19: escritor XLSX propio sobre `node:zlib`; el lector de E5.2 decodifica `_xHHHH_` | `ZipWriter` (`zip-writer.ts`), `writeXlsxPackage`, `xlsxSheetXml`, `escapeCellText` (`export-xlsx.ts`); `unescapeXstring` (`worksheet-xlsx.ts`) |
| H11, H12, E6, E7 | D20: archivo por trozos, relectura con SHA-256, fila con auditoría, huérfanos al arrancar; límite de 50 MiB | `ArtifactStore.writeWorksheetExport`, `writeExportFile` (`worksheet-export-file.ts`), `WorksheetExportsRepository.insert`, `WorksheetExportCleanupService`; migración `20261107110000_create_worksheet_exports` |
| H15, E8 | D21: misma revisión y consulta → mismos bytes | Orden total de `orderSql`; ZIP con fecha fija; `SERIALIZER_VERSION` |

## Ajustes al escribir el código

- **La lectura de filas se reutiliza, no se copia.** `WorksheetsModule` exporta `WorksheetRowsRepository` y la exportación usa su `findColumns` y su `findRows` con `whereSql` y `orderSql`. El repositorio propio solo lee la revisión (con el nombre de la hoja, que da nombre a la hoja del XLSX) y guarda o lee exportaciones.
- **El almacén escribe por trozos y devuelve el resultado de quien escribe.** `writeWorksheetExport(extension, write)` da a `write` un `ByteSink` (tipo nuevo en `artifacts.types.ts`, que también usa el ZIP) y devuelve `{ file, result }`: así el servicio recibe las filas y los problemas contados sin variables asignadas desde fuera. La relectura también es por trozos (`verifyInChunks`).
- **`FinalFolder` conserva su sentido para el outbox.** Al añadir `worksheet-exports/`, el tipo de carpetas finales se ampliaba y rompía la prueba del outbox, que lista las carpetas que sabe limpiar. Ahora hay un tipo interno `StoredFolder` (todas las carpetas guardadas) y `FinalFolder` sigue siendo las tres que el outbox puede borrar: las exportaciones de hojas no se borran por eventos.
- **`moveToExports` pasa a `moveInto(folder, key)`**, compartido por los TSV y las exportaciones de hojas; el comportamiento de los TSV no cambia (sus pruebas pasan sin tocarlas).
- **Páginas de 200 filas.** Una página se serializa sin ceder el bucle de eventos: con 500 filas × 200 columnas el bloqueo medido fue de 158 ms; con 200 filas el trozo es 2,5 veces menor.
- **Las opciones se validan después de comprobar la hoja**, como en las importaciones: una hoja ajena responde 404 aunque las opciones también estén mal.
- **Exportar no bloquea la organización ni pide permiso de escritura**: es una lectura ([17], «solo lectura/exportación»). La clave foránea `(worksheet_id, revision_id)` asegura que la revisión es de esa hoja.
- **Una calculada con problema sale vacía y un valor guardado sin la forma de su columna sale como texto**; los dos cuentan en `problemCellCount`, que también cuenta un obligatorio vacío (los mismos problemas que devuelve `rows/query`).
- **La herramienta de escritura de archivos convertía `\uFEFF`, `\uFF1D`… en el carácter real**, invisible en el código. Se reescribieron como escapes y se comprobó con `perl` que no queda ninguno.

## Implementación

Rutas bajo `P = /organizations/:organizationId/projects/:projectId`:

| Ruta | Respuesta |
| --- | --- |
| `POST P/worksheets/:worksheetId/exports` | 201 `{ export, downloadUrl }`. Cuerpo: `format`, y de forma opcional `revisionId`, `columns`, `filter`, `sort`, `delimiter` y `formulas` (los dos últimos, solo CSV). |
| `GET P/worksheet-exports/:exportId` | 200 `{ export }`: revisión, opciones, consulta, versión del serializador, filas, columnas, celdas con problema, tamaño y checksum. La clave del archivo no sale del servidor. |
| `GET P/worksheet-exports/:exportId/file` | El archivo, con `Content-Length`, `Content-Disposition: attachment` y `text/csv; charset=utf-8; header=present` o el tipo de XLSX. Si falta en disco, 503 `EXPORT_FILE_UNAVAILABLE`. |

Recorrido de `create`: el usuario actual → la revisión (pedida o la actual; ajena o inexistente, 404) → las opciones (una de CSV en un XLSX, 400 `FIELD_NOT_ALLOWED`) → las columnas de esa revisión y la consulta validada como en `rows/query` → el archivo (`ArtifactStore.writeWorksheetExport` + `writeExportFile`, páginas de 200 filas, 413 `WORKSHEET_EXPORT_TOO_LARGE` si el contenido pasa de 50 MiB) → la fila `worksheet_exports` y el evento `worksheet.export.created` en una transacción. Si la fila falla, se borra el archivo.

Archivos:

- `src/worksheet-exports/export-cells.ts`: `exportCell`, `cellText`, `MAX_EXACT_DIGITS`, `FIRST_EXCEL_DATE`.
- `src/worksheet-exports/export-csv.ts`: `csvRecord`, `csvHeader`, `CSV_BOM`, `FORMULA_START_PATTERN`.
- `src/worksheet-exports/export-xlsx.ts`: `writeXlsxPackage`, `xlsxSheetXml`, `escapeCellText`, `excelSheetName`, `excelSerial`, `columnLetters`.
- `src/worksheet-exports/zip-writer.ts`: `ZipWriter` (deflate al vuelo con descriptor de datos, fecha fija).
- `src/worksheet-exports/worksheet-export-file.ts`: `writeExportFile` y `ExportTally` (filas, problemas y límite).
- `src/worksheet-exports/worksheet-exports.{module,controller,service,repository,dto,types}.ts` y `worksheet-export-cleanup.service.ts`.
- `src/artifacts/artifact.store.ts` y `artifacts.types.ts`; `src/worksheets/worksheets.module.ts`; `src/worksheet-imports/worksheet-xlsx.ts` (`unescapeXstring`); `src/app.module.ts`; `WORKSHEET_EXPORT_NOT_FOUND` (404) y `WORKSHEET_EXPORT_TOO_LARGE` (413) al final de `error-codes.ts` y `messages.ts`.
- `prisma/schema.prisma` (`WorksheetExport`) y `prisma/migrations/20261107110000_create_worksheet_exports/` (`CHECK` de formato, checksum, clave y recuentos; claves foráneas a la hoja, a la revisión de esa hoja y al usuario).

## Comprobaciones realmente ejecutadas

2026-11-07, Node 26.9, en el portátil de desarrollo.

- **Pruebas nuevas:**
  - `export-writers.spec.ts` (celdas, CSV, XLSX, ida y vuelta con el lector de E5.2, mismos bytes, límite de 50 MiB);
  - `artifact-store-worksheet-exports.spec.ts` (escritura por trozos, fallos, relectura que no coincide, claves);
  - dos pruebas de `_xHHHH_` en `worksheet-xlsx.spec.ts`;
  - `worksheet-exports.e2e-spec.ts` con dos propietarios: CSV de la revisión actual con el contenido exacto, XLSX con tipos y reimportado por `upsert` sin cambios (409 `IMPORT_NOTHING_TO_CHANGE`), revisión fija con los mismos bytes después de avanzar la hoja, columnas, filtro y orden guardados como procedencia, 400 sin dejar fila ni archivo, lo ajeno 404, fila que falla sin archivo, 503 si falta el archivo y limpieza de huérfanos.
- **Suite completa** (`pnpm test:features`): 82 suites y 1.409 pruebas, todas pasan (antes de E5.3: 79 y 1.372).
- **`tsc --noEmit`**, **`pnpm lint`** (oxlint) y **`prettier --check src test/features`**: limpios. Las dos expresiones con caracteres de control llevan una excepción del lint con su motivo.
- **Esquema frente a migraciones** (`prisma migrate diff` con PGlite como base sombra): «This is an empty migration» con 28 migraciones.
- **Arranque real** de `AppModule` con PGlite en un puerto (una conexión). Hoja de 5.000 × 200 columnas de cinco tipos importada por XLSX y aplicada; después:
  - exportar a CSV: 201 en 1.348 ms, 8,3 MB;
  - exportar a XLSX: 201 en 1.778 ms, 4,3 MB;
  - bloqueo máximo del bucle de eventos durante las dos exportaciones: 56 ms (con páginas de 500 filas, en el spike, 158 ms);
  - descargas en 8–27 ms, con el checksum y el tamaño iguales a los guardados;
  - el XLSX descargado lo vuelve a leer el lector de E5.2 (5.000 × 200, con tipos) y lo abre openpyxl 3.1.5 (5.001 filas; `str`, `float`, `int`, `datetime` y `bool`);
  - el CSV empieza por BOM y sus 5.000 líneas con `=1+1` llevan el apóstrofo; ninguna queda sin proteger;
  - la misma revisión exportada otra vez da el mismo checksum; `format: 'pdf'` da 400.
  - La memoria residente máxima del proceso (4,5 GiB) incluye PGlite en el mismo proceso con el millón de celdas y el libro de prueba construido en memoria: no mide la exportación. La del escritor solo se midió en el spike (228 MiB, ficha 03).
- **Sin comprobar:** no hay Excel ni LibreOffice en la máquina. La validez del XLSX se comprobó con openpyxl y con el lector propio, y el comportamiento del apóstrofo en Excel se apoya en OWASP (F8), no en una prueba.

## Defectos a propósito

30 defectos, cada uno en una copia limpia del repositorio, con las pruebas de exportación, del lector XLSX y del almacén (79 pruebas). **Todos detectados**; restaurado el código, las 79 pasan.

| Defecto | Lo detecta |
| --- | --- |
| D1 sin protección de fórmulas; D2 sin variantes de ancho completo; D3 protege también números | Pruebas de CSV y E2E del CSV |
| D4 no duplica comillas; D5 LF en lugar de CRLF; D6 sin BOM | Pruebas de CSV y E2E |
| D7 sin límite de 15 cifras; D8 fechas antiguas como fecha; D9 selección por ID | `exportCell` y E2E del XLSX |
| D10 XLSX sin escapar CR; D11 sin proteger `_x` literal; D15 texto como fórmula; D16 fecha sin estilo; D28 nombre de hoja sin limpiar | Ida y vuelta del XLSX y E2E |
| D12, D13 el lector no decodifica `_xHHHH_`; D14 acepta `_x0000_` | Pruebas nuevas del lector y E2E |
| D17 ignora el orden; D18 ignora el filtro; D19 ignora la revisión pedida | E2E de consulta y de revisión fija |
| D20, D21 sin membresía al leer la revisión o la exportación | E2E de lo ajeno (404) |
| D22 sin límite de contenido; D26 calculadas sin evaluar; D27 problemas sin contar | `writeExportFile` y E2E |
| D23 no relee el archivo; D29 temporal sin borrar si falla escribir | Pruebas del almacén |
| D24 no borra el archivo si falla la fila | E2E «si la fila no se guarda…», **añadida al preparar los defectos**: sin ella, este defecto no lo detectaba nada |
| D25 opciones de CSV en un XLSX ignoradas | E2E de opciones inválidas |
| D30 la limpieza no consulta referencias | E2E de huérfanos |

## Consecuencias

- **Archivo → borrador → revisión → archivo** ya funciona de extremo a extremo: un XLSX exportado se reimporta y no cambia ninguna celda.
- **Migración sin aplicar en Neon**: `20261107110000_create_worksheet_exports`, igual que la de E5.2 (Neon tiene 26; local, 28). Se aplica con `pnpm db:status` y después `pnpm db:migrate`. **Actualización 2026-11-07: aplicada en Neon por el usuario con `pnpm db:migrate` (Neon tiene las 29 migraciones).**
- **Sin dependencias nuevas**: el escritor XLSX usa `node:zlib`.
- **El lector de E5.2 cambia**: decodifica `_xHHHH_` como Excel; un `_x0000_` hace inválido el libro.
- **Pendiente:**
  - comprobar el XLSX y el CSV protegido en Excel y LibreOffice reales ([19], F8: «probar mitigación en consumidores»);
  - no hay listado de exportaciones de una hoja ni borrado, porque no lo pide ninguna decisión: se añadirán cuando haga falta (E7);
  - sigue E5.4: el puente al snapshot y al feed.

