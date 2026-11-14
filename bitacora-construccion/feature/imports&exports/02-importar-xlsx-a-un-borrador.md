# 02 — E5.2: importar un XLSX a un borrador de hoja

Fecha de creación: 2026-11-07  
Última actualización: 2026-11-07  
Estado: Implementado y verificado.  
Relacionada con: [plan 01](../../../docs/plans/feature/imports&exports/01-plan-e5-importar-y-exportar-hojas.md) (D9, D11–D14), [fuentes 02, spike XLSX](../../../docs/fonts/feature/imports&exports/02-spike-de-librerias-xlsx.md), [bitácora 01 (E5.1)](01-importar-csv-a-un-borrador.md), [bitácora 01.1](01.1-limite-de-filas-por-hoja.md).  
Revisión de partida: `main` `7921f00` más E4, E5.1 y E5.1.1 sin commit.

## Necesidad

Las personas trabajan con Excel. Hasta ahora solo se podía importar CSV, lo que obliga a exportar desde Excel y pierde la información de tipos (fechas, números, errores de fórmula). Hacía falta aceptar un XLSX por las mismas rutas, elegir la hoja y la fila de cabecera, convertir cada celda sin pérdida y rechazar los archivos peligrosos con límites de recursos (T13, T14).

## Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| Spike (ficha 02): avisos de `xlsx`, `exceljs` sin mantener, `read-excel-file` acepta macros y vacía los errores; bomba aceptada o 76 s y caída | D9: lector propio sobre `yauzl` 3.4.0 y `saxes` 6.0.0 | `worksheet-xlsx.ts`; dependencias exactas en `package.json` (`@types/yauzl` 3.4.0 en desarrollo) |
| Medición: 5.000 × 200 en menos de 1 s, 73 ms de bloqueo máximo | D1 se mantiene: se lee dentro de la petición | Mismas rutas; `WorksheetUploadInterceptor` (antes `CsvUploadInterceptor`) acepta `sheet` y `headerRow` |
| H7, C31, C33 | D11: formato por los primeros bytes; hoja por nombre y, sin nombre, solo la de un libro de una hoja; `headerRow` | `formatOf` y `previewChoiceOf` en el servicio; `chooseSheet`; `XlsxImportOptions` |
| H8, F62, C32 | D12: límites sobre el directorio central antes de descomprimir; contenido activo rechazado; plazo de 60 s | `XlsxPackage.open`, `assertWithinLimits`, `assertNoActiveParts`, `assertNoMacroContentType`, `xmlParser` (rechaza `DOCTYPE`) |
| H9, H10, F64, F65 | D13: celdas con tipo; texto exacto de los números; fechas por estilo y `date1904`; error y fórmula sin valor como problemas de fila | `fieldOf`, `plainDecimal`, `dateOfSerial` en el lector; `convertTyped` y `typedCandidate` en `import-plan.ts` |
| Migración de E5.1 aplicada en Neon | D14: migración nueva | `20261107100000_allow_xlsx_worksheet_imports` |

## Ajustes al escribir el código

- **Un tipo de tabla para los dos formatos.** `CsvTable` pasa a `ImportTable` (en `worksheet-imports.types.ts`) con `format` y filas de `ImportField`: texto tal cual o una celda con tipo (`TypedCell`). El planificador de E5.1 no cambia su recorrido: solo `convert` distingue las celdas con tipo.
- **Las opciones son una unión por formato** (`CsvImportOptions` con `delimiter`, `XlsxImportOptions` con `sheet` y `headerRow`), con la misma forma plana que ya enviaba el cliente; se guarda `format` dentro de las opciones como procedencia. Una opción del otro formato es un error (`IMPORT_OPTIONS_INVALID`), no se ignora. El orden de los problemas de opciones de E5.1 se conserva.
- **`decimalSeparator` y `booleanLabels` solo afectan a celdas de texto.** Un número de Excel siempre se escribe con punto en el XML, y un booleano de Excel es `true`/`false` aunque la persona haya puesto etiquetas «sí»/«no» para el texto.
- **El código del problema de una celda es opcional en `convert`**: sin código sigue significando `CELL_VALUE_INVALID`, así las pruebas de E5.1 no cambian sus aserciones.
- **Se quitó el presupuesto de bytes al descomprimir** que tenía el prototipo: el total declarado ya está acotado a 50 MiB y yauzl falla si una entrada da más de lo declarado. Era una segunda capa sin caso que la alcanzara. Se mantiene el plazo de 60 s.
- **Un dato a la derecha de la última cabecera rechaza el archivo** (`CSV_HEADERS_INVALID`, cuyo mensaje no menciona el CSV): no hay columna a la que llevarlo y descartarlo en silencio iría contra [12]. Es el equivalente de `relax_column_count: false` del CSV.
- **`sourceRow` cuenta filas de datos no vacías**, igual que el CSV (que salta líneas vacías): no es el número de fila de Excel. Las filas por encima de `headerRow` y las vacías no cuentan.
- **Un estilo de fecha con hora no se trunca**: `46096.5` sigue siendo un número y no entra en una columna de fecha. Las series de 1900 anteriores al 01/03/1900 (incluida la 60, el 29/02/1900 que no existió) no se aceptan como fecha.
- **El nombre del interceptor chocaba** con el `ImportUploadInterceptor` del catálogo: se llama `WorksheetUploadInterceptor`.
- **En la vista previa se comprueba la hoja antes de mirar el archivo**, como en E5.1: a un propietario ajeno se le responde 404 sin leer nada.
- Diez códigos nuevos al final de los archivos compartidos: `XLSX_ENCRYPTED`, `XLSX_ACTIVE_CONTENT`, `XLSX_LIMITS_EXCEEDED` (413), `XLSX_INVALID`, `XLSX_SHEET_REQUIRED`, `XLSX_SHEET_NOT_FOUND`, `XLSX_EMPTY`, `XLSX_ROW_LIMIT`, `XLSX_CELL_ERROR` y `XLSX_FORMULA_NOT_CALCULATED`.

## Implementación

- `POST P/worksheets/:worksheetId/imports/preview` con un XLSX:
  - libro de varias hojas sin `sheet` → 200 con `format: 'xlsx'`, `sheets` y `sheet: null`, sin cabeceras;
  - con `sheet` (o un libro de una hoja) → cabeceras, muestra (las celdas con tipo se muestran como texto: `10.5`, `true`, `2026-03-15`, `#DIV/0!`) y mapeo sugerido;
  - campos `sheet` y `headerRow`; `delimiter` es solo para CSV.
- `POST P/worksheets/:worksheetId/imports` con un XLSX: `options.sheet` y `options.headerRow`; sin hoja en un libro de varias → 400 `XLSX_SHEET_REQUIRED`. El resto (mapeo, modos, exclusiones, huella, límite de filas por hoja) es el de E5.1. La importación guarda `format: 'xlsx'`.
- Rechazos antes de crear nada: contenedor CFB → 400 `XLSX_ENCRYPTED`; entrada cifrada → 400 `XLSX_ENCRYPTED`; macros, enlaces externos, ActiveX, objetos incrustados o `DOCTYPE` → 400 `XLSX_ACTIVE_CONTENT`; más de 1.000 entradas, más de 50 MiB declarados, ratio mayor de 100:1 o más de 60 s → 413 `XLSX_LIMITS_EXCEEDED`; ZIP o XML dañados, UTF-8 inválido o partes que faltan → 400 `XLSX_INVALID`; más de 5.000 filas de datos → 400 `XLSX_ROW_LIMIT`.
- Problemas de fila (422 `IMPORT_ROWS_INVALID`, excluibles como en E5.1): `XLSX_CELL_ERROR` y `XLSX_FORMULA_NOT_CALCULATED`.

## Comprobaciones realmente ejecutadas

Ejecutado el 2026-11-07 sobre el árbol de trabajo (sin commit), en `/Users/benji/Documents/Proyect-Learning/LearningAllPosibolIt`:

- **Spike** (ficha 02): tres lectores contra 12 fixtures escritos a mano, con tiempo, memoria y bloqueo del bucle de eventos.
- **Pruebas nuevas:**
  - `worksheet-xlsx.spec.ts` (44): tipos de celda (texto con ceros y espacios, texto con formato, cadena en línea, número exacto y con exponente, booleanos, fecha con estilo estándar y propio, número con texto entre comillas que no es fecha, serie con hora, fórmula con valor, con error y sin valor, `t="str"` y `t="d"`); fechas 1900 y 1904 (1.462 días); prefijo de espacio de nombres; hojas (lista sin elegir, por nombre, inexistente); `headerRow` y filas vacías; cabeceras vacías, repetidas o datos fuera de ellas; 5.000 filas sí y 5.001 no; ZIP vs CFB; bomba de 60 MiB rechazada en menos de 1 s; ratio > 100:1; más de 50 MiB declarados con ratio bajo; más de 1.000 entradas; macros, `macroEnabled`, enlace externo, objeto incrustado y `DOCTYPE`; entrada cifrada; truncado, tamaño falseado, sin libro, XML mal formado, UTF-8 inválido y cadena compartida inexistente; `plainDecimal` y `dateOfSerial`.
  - `import-plan.spec.ts` (+16): conversión de celdas con tipo a cada tipo de columna, separador y etiquetas solo para texto, error de fórmula como problema de fila con su código, y opciones por formato.
  - `worksheet-imports.e2e-spec.ts` (+4): vista previa de un libro de dos hojas (lista y después la hoja elegida); XLSX → 422 por `#DIV/0!` sin crear nada → excluir la fila → borrador → revisión con `007`, `10.5`, booleanos y fecha (T13); sistema 1904; rechazos por HTTP sin crear nada (cifrado, macros, bomba con 413, hoja sin elegir, opción de CSV, campos de vista previa inválidos) y propietario ajeno con 404 (T14).
- **Defectos a propósito** (copia temporal con `rsync`, sin `.env` y con `node_modules` enlazado; 20 casos, todos detectados; restaurado, 103/103 pasan). El primer intento dejó ver un hueco: quitar el límite de 50 MiB no lo notaba ninguna prueba, porque la bomba también supera el ratio. Se añadió la prueba de 50 MiB declarados con ratio bajo antes de ejecutar la tanda.

| Defecto | Prueba que falla |
| --- | --- |
| X1 sin límite de entradas | más de 1.000 entradas |
| X2 sin límite de 50 MiB | 50 MiB declarados con ratio bajo |
| X3 sin ratio | ratio mayor de 100:1 |
| X4 acepta entradas cifradas | entrada cifrada |
| X5 acepta partes activas | macros, enlace externo, objeto incrustado y la E2E |
| X6 acepta `macroEnabled` | libro habilitado para macros |
| X7 acepta `DOCTYPE` | `DOCTYPE` con entidades |
| X8 toma la primera hoja | 3 pruebas (unitaria y dos E2E) |
| X9 ignora `date1904` | unitaria y E2E de 1904 |
| X10 ignora el estilo de fecha | 5 pruebas |
| X11 error de fórmula como vacío | 3 pruebas |
| X12 fórmula sin valor como vacía | tipos de celda |
| X13 no desarrolla el exponente | 9 pruebas |
| X14 recorta las cadenas | tipos de celda |
| X15 sin límite de filas | 5.000 sí, 5.001 no |
| X16 ignora datos sin cabecera | dato a la derecha de la última cabecera |
| X17 celdas con tipo como texto | 7 pruebas |
| X18 ignora `headerRow` | cabecera más abajo |
| X19 un CFB se lee como CSV | E2E de rechazos |
| X20 acepta la serie 60 de 1900 | `dateOfSerial` |

- **No probado:** el plazo de 60 s. Con los demás límites, el peor caso tarda menos de 2 s; provocarlo exigiría una entrada lenta artificial.
- `tsc --noEmit`, `pnpm lint` (oxlint sin avisos) y `prettier --check src test/features`: limpios.
- Esquema frente a migraciones (27, con PGlite como base sombra): «This is an empty migration». `test/prisma-migrations.test.mjs` (PGlite) pasa con la lista ampliada.
- Suite completa: **79 suites y 1.372 pruebas** pasan.
- **Arranque real** (`AppModule` escuchando en un puerto, PGlite con una conexión, sin `.env`): libro de 5.000 × 200 y dos hojas (6,3 MB) → vista previa sin hoja con la lista en 31 ms y con la hoja en 1.556 ms (5.000 filas, 200 cabeceras); importar 5.000 × 20 → 201 en 240 ms (`format: 'xlsx'`, 5.000 insertadas, una columna nueva); enviar, aprobar y aplicar → 200 en 286 ms y revisión con 5.000 filas; bomba (206 KB → 200 MiB) → **413 `XLSX_LIMITS_EXCEEDED` en 9 ms**; `GET /health` → 200. La memoria máxima del proceso (1,7 GiB) no mide el servidor: incluye los textos de cientos de MiB que el script genera para los fixtures. La memoria del lector solo se midió en el spike (368 MiB de memoria residente en el peor caso).

## Consecuencias

- **Dos dependencias nuevas de producción** (`yauzl` 3.4.0 y `saxes` 6.0.0, más `pend` y `xmlchars`) y una de desarrollo (`@types/yauzl`). El lector de XLSX es código propio: unas 850 líneas con comentarios, a mantener junto con sus 44 pruebas.
- **Migración nueva `20261107100000_allow_xlsx_worksheet_imports` sin aplicar en Neon.** Hasta aplicarla, crear una importación XLSX en Neon fallaría en la restricción de `format`. Se aplica con `pnpm db:status` y después `pnpm db:migrate`. **Actualización 2026-11-07: aplicada en Neon por el usuario con `pnpm db:migrate` (Neon tiene las 29 migraciones).**
- Las opciones guardadas de una importación llevan ahora `format`; las de E5.1 guardadas antes no lo tienen.
- `sourceRow` no es el número de fila de Excel. Si la web quiere mostrarlo, habría que guardar la correspondencia en la tabla.
- Siguen E5.3 (exportar CSV/XLSX de una revisión) y E5.4 (puente al feed). Para escribir XLSX en E5.3 hará falta otra decisión: este spike solo cubre la lectura.
