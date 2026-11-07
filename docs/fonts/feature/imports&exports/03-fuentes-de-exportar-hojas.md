# 03 — Fuentes para exportar una revisión de hoja (E5.3)

Fecha de creación: 2026-11-07  
Última actualización: 2026-11-07  
Estado: Investigación con medición. Respalda D15–D21 del [plan 01](../../../plans/feature/imports&exports/01-plan-e5-importar-y-exportar-hojas.md).  
Relacionada con: [fuentes 01](01-fuentes-de-importar-y-exportar-hojas.md), [spike de lectura XLSX (02)](02-spike-de-librerias-xlsx.md), [hojas, «Exportación»](../../../../../docs-diagrams/12-hojas-modelo-editor-importacion-y-exportacion.md), [contratos](../../../../../docs-diagrams/16-nuxt-tabla-central-chat-y-contratos.md), [fuentes y pendientes, F8 y P05](../../../../../docs-diagrams/19-fuentes-trazabilidad-y-decisiones-pendientes.md), [plan de reviews y exports](../../../plans/feature/reviews&exports/01-plan-reviews-y-exports.md).  
Revisión de partida: `main` `7921f00` más E4, E5.1, E5.1.1 y E5.2 sin commit.

## Pregunta

¿Cómo se exporta una revisión fija de una hoja a CSV y XLSX con las columnas y el filtro elegidos, un checksum y una política contra fórmulas, sin perder valores (ceros, decimales, fechas) y sin elegir una librería por intuición (P05, «escribir XLSX» sigue abierto)?

## Estado real del código

| ID | Archivo y símbolo | Hallazgo | Consecuencia |
| --- | --- | --- | --- |
| E6 | [`ExportsService.generateAndSave`](../../../../src/exports/exports.service.ts), [`ArtifactStore.writeExport`](../../../../src/artifacts/artifact.store.ts) | La exportación TSV de evaluaciones ya resuelve «archivo completo antes de la referencia»: escribe en `tmp/`, enlaza en `exports/`, relee y compara tamaño y SHA-256, y solo entonces inserta la fila. Si la fila no se guarda, borra el archivo; lo que quede lo retira `ExportCleanupService` al arrancar (`removeOrphans`, más de 1 h). Todo dentro de la petición, sin trabajo durable. | Reutilizar el mismo patrón y el mismo almacén en una carpeta propia. |
| E7 | `ArtifactStore`, `KEY_PATTERNS` | Cada carpeta solo admite su tipo de clave (`<uuid>.tsv`, `<uuid>.csv`); `writeExport` recibe un `Buffer` entero. | Carpeta nueva `worksheet-exports/` con `<uuid>.csv` y `<uuid>.xlsx`, y una escritura por trozos: [12] pide no materializar la hoja entera. |
| E8 | [`WorksheetRowsRepository.findRows`](../../../../src/worksheets/worksheet-rows.repository.ts), [`orderSql`](../../../../src/worksheets/row-query-sql.ts), [`parseRowQuery`](../../../../src/worksheets/row-query.ts) | Las filas de una revisión fija se leen con filtro y orden ya validados contra sus columnas; el orden termina siempre en `sort_key, row_id`, así que es total. Las versiones de fila son inmutables: paginar por desplazamiento sobre una revisión fija no se salta ni repite filas. | La exportación usa la misma consulta y la misma validación, por páginas. Mismo orden → mismo archivo. |
| E9 | [`evaluateRow`](../../../../src/worksheets/row-evaluation.ts) | Devuelve los valores de las columnas pedidas, con las calculadas ya resueltas, y sus problemas (`CELL_VALUE_INVALID`, problemas de cálculo). | Las calculadas se exportan por su resultado; los problemas se cuentan. |
| E10 | [`worksheet-xlsx.ts`](../../../../src/worksheet-imports/worksheet-xlsx.ts) (E5.2) | El lector no decodifica `_xHHHH_` en el texto de las celdas. | Hueco de E5.2: Excel escribe así el retorno de carro. Se corrige en E5.3 para que exportar → importar sea exacto (F68). |

## Requisitos

| ID | Documento y pasaje | Qué exige |
| --- | --- | --- |
| H11 | [12], «Exportación», líneas 108–110 | «Crear exportación de una revisión fija, selección y filtro materializados, tipos, idioma/zona y versión del serializador»; CSV con «una política documentada contra interpretación como fórmula»; XLSX: «escribir texto como texto». «Job largo prepara archivo temporal, verifica checksum y finaliza; transacción corta publica la referencia». Descarga autorizada por ID; «no crea enlace público por defecto». |
| H12 | [12], línea 60 | «Comparación y exportación leen páginas/lotes, sin materializar la hoja entera en memoria»; tamaño canónico de una revisión limitado inicialmente a 50 MiB. |
| H13 | [16], línea 81 | `POST P/worksheet-exports`: «Revisión/filtro/columnas/formato; job, 202». |
| H14 | [18], T16 | «Exportación de revisión fija, checksum, columnas autorizadas y fórmula CSV segura», por integración/E2E. |
| H15 | [12], «Aceptación», línea 112 | «exactitud decimal, exportación reproducible». |
| H16 | [17], línea 92 | Una organización con impago pasa a «modo solo lectura/exportación»: exportar es una lectura. |

## Cursos

Consulta: 2026-11-07. Rutas relativas a `/Users/benji/Documents/chrome-extencions/trancripciones/`. La biblioteca no trata la inyección de fórmulas ni la escritura de XLSX (consultas «csv injection formula», «excel xlsx generar exportar»: solo VBA, sin escritura de archivos). Sin reconstrucción: el mecanismo es una concatenación de texto.

| ID | Curso, lección y localizador | Evidencia | Uso |
| --- | --- | --- | --- |
| C34 | **SwiftUI y UIKit para iOS**, `Swift/SwiftUI y UIKit para iOS/Sección 47 Importar y exportar datos desde CoreData (iOS 16)/426. Exportar datos a archivo .csv.md`, líneas 21–25 | Primera línea con los nombres separados por comas, después una línea por elemento concatenando campos con `,` y `\n`. Ningún campo se escapa: una coma o unas comillas dentro de un valor romperían el registro. | Se toma la forma (cabecera + un registro por fila). Se descarta concatenar sin escapar: se aplican RFC 4180 (F66) y OWASP (F8). |

## Documentación oficial y registro

Consulta: 2026-11-07.

| ID | Fuente | Evidencia | Uso |
| --- | --- | --- | --- |
| F8 | [OWASP, *CSV Injection*](https://community.owasp.org/attacks/CSV_Injection) (la URL anterior de `owasp.org` redirige aquí) | Caracteres peligrosos al empezar un campo: `=`, `+`, `-`, `@`, tabulador (`0x09`), retorno de carro (`0x0D`) y salto de línea (`0x0A`), y sus variantes de ancho completo, que «may be interpreted as formulas in some locales». Mitigación: anteponer un apóstrofo, duplicar comillas y entrecomillar. Advertencias: la protección no es fiable en Excel tras guardar y reabrir, y «There is no universal CSV sanitization strategy that is safe for all spreadsheet applications and all downstream consumers». | Política `escape` por defecto: apóstrofo delante de los textos que empiezan así. Política `keep` para quien lee el CSV con un programa. Se registra en la exportación cuál se usó. |
| F66 | [RFC 4180](https://www.rfc-editor.org/rfc/rfc4180), secciones 2 y 3 | «Each record is located on a separate line, delimited by a line break (CRLF).» «Fields containing line breaks (CRLF), double quotes, and commas should be enclosed in double-quotes.» Una comilla interior se escapa «by preceding it with another double quote». Tipo `text/csv` con `charset` y `header=present`. | Fin de registro CRLF; comillas solo cuando hacen falta. `Content-Type: text/csv; charset=utf-8; header=present`. |
| F67 | [Microsoft, *Opening CSV UTF-8 files correctly in Excel*](https://support.microsoft.com/en-us/excel/opening-csv-utf-8-files-correctly-in-excel) | «You can open a CSV file encoded with UTF-8 normally if it was saved with BOM (Byte Order Mark).» | El CSV empieza por BOM. El lector de E5.1 ya lo quita. |
| F68 | [MS-OI29500, ST_Xstring (Part 1, §22.9.2.19)](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/d34ae755-c53f-4a44-a363-c6dd3ee018a4) y [hilo del comité SC34 WG4, DR-16-0022](https://mailman.vse.cz/pipermail/sc34wg4/2017-November/004310.html) | El retorno de carro «shall be escaped»; el guion bajo se escapa «only when used to escape the first underscore character in the format \_xHHHH\_»; Office no escapa el salto de línea ni el tabulador en el contenido. El hilo del comité recoge que LibreOffice no decodifica el escape y Excel sí. | Escribir `_x000D_`, los caracteres de control de XML 1.0 como `_xHHHH_` y `_x005F_` delante de un `_xHHHH_` literal. El lector de E5.2 decodifica lo mismo (E10). openpyxl 3.1.5 tampoco decodifica (medición): mostrará el escape. |
| F69 | [Microsoft, *Excel specifications and limits*](https://support.microsoft.com/en-us/office/excel-specifications-and-limits-1672b34d-7043-467e-8e27-269d656771c3) | «Number precision: 15 digits»; «Earliest date allowed for calculation: January 1, 1900». Una celda admite 32.767 caracteres (una de texto de la API, 8.192). | Número con más de 15 cifras significativas → texto. Fecha anterior al 1900-03-01 → texto (la serie 60 es el 29 de febrero que no existió, ficha 02). |
| F70 | Registro npm (`npm view`) y avisos (`/-/npm/v1/security/advisories/bulk`) | `write-excel-file` 4.1.1 (MIT, 2026-06-08), una dependencia: `fflate` `^0.8.2`, que tiene [GHSA-px8p-9vwx-vf98](https://github.com/advisories/GHSA-px8p-9vwx-vf98) (moderado, `>=0.8.0 <0.8.3`, solo al descomprimir ZIP64; se instala 0.8.3). `yazl` 3.3.1 (MIT, 2024-11-23), sin avisos. `xlsx` y `exceljs`, ya descartadas en la ficha 02 (F61). | Candidata medida: `write-excel-file`. `yazl` no hace falta: `node:zlib` ya ofrece `deflateRaw` y `crc32`. |

## Medición (spike)

2026-11-07, Node 26.9 en el portátil de desarrollo; scripts en la carpeta temporal de la sesión (`scratchpad/spike-export/`). Hoja sintética de **5.000 filas × 200 columnas** (el máximo de [12]) con texto, enteros, decimales, fechas y booleanos; incluye textos `=1+1`, `00123`, comillas y comas, `\r\n`, un carácter de control y `_x0041_` literal, decimales de 20 cifras y fechas de 1899.

| Medida | Escritor propio (`node:zlib`, este repositorio) | `write-excel-file` 4.1.1 |
| --- | --- | --- |
| Tiempo XLSX | 1.018 ms | 2.781 ms |
| Tiempo CSV | 411 ms | — |
| Memoria máxima (RSS del proceso) | 228 MiB | 492 MiB |
| Tamaño XLSX | 4,5 MB (hoja de 42,7 MB sin comprimir) | 4,8 MB |
| Bloqueo máximo del bucle de eventos | 158 ms con páginas de 500 filas | No medible: genera todo de una vez antes de ceder |
| `12345678901234567.89` | Se escribe como texto, exacto | `Number(...)` → `12345678901234568` |
| Mismo archivo dos veces | Mismo SHA-256 (XLSX y CSV) | Fecha actual en el ZIP |
| Lectura independiente (openpyxl 3.1.5) | Abre; números `n`, fechas `d` con formato de fecha, booleanos `b`, `=1+1` como texto | — |
| Ida y vuelta con el lector de E5.2 | Exacta tras decodificar `_xHHHH_` (E10), también `\r\n` | — |

Interpretación: el escritor propio es más rápido, usa la mitad de memoria, no redondea y da el mismo archivo para la misma revisión; no añade dependencias. `write-excel-file` exige un `number` de JavaScript para los números y construye el libro en memoria. Límite de la medición: no hay Excel en la máquina; la validez se comprobó con openpyxl y con el lector propio. El bloqueo baja con páginas más pequeñas: con páginas de 200 filas, el arranque real midió 56 ms ([bitácora 03](../../../../bitacora-construccion/feature/imports&exports/03-exportar-una-revision-de-hoja.md)).

## Mapa

| Necesidad | Requisito | Fuentes | Decisión |
| --- | --- | --- | --- |
| Dentro de la petición o con trabajo | H11, H13 | E6, medición | Dentro de la petición, como el TSV y como E5.1 (D1): el peor caso tarda alrededor de 1 s. Se adapta [16] (202). |
| Qué se exporta | H11, H14 | E8, E9 | Revisión fija (por defecto, la actual en ese momento), columnas, filtro y orden validados como en `rows/query`; se guardan en la exportación. |
| Valores sin pérdida | H15 | F69, ficha 02 | Tipos por celda; más de 15 cifras o fecha anterior a 1900-03-01 → texto. |
| CSV seguro | H11, H14 | F8, F66, F67, C34 | RFC 4180, CRLF, BOM, apóstrofo delante de los textos peligrosos (`escape`, por defecto) o nada (`keep`). |
| XLSX | H11, P05 | F68, F70, medición | Escritor propio: `inlineStr`, estilo de fecha 14, escapes ST_Xstring, ZIP determinista. |
| Archivo verificado | H11, H12 | E6, E7 | Carpeta `worksheet-exports/`, escritura por trozos, relectura con SHA-256 y fila después; huérfanos al arrancar. Límite de 50 MiB de contenido. |
| Quién puede exportar | H16 | E8 | Cualquier miembro, también con la organización archivada; lo ajeno, 404. |
