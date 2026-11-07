# 02 — Spike de librerías XLSX (E5.2, P05)

Fecha de creación: 2026-11-07  
Última actualización: 2026-11-07  
Estado: Investigación con medición. Respalda D9 del [plan 01](../../../plans/feature/imports&exports/01-plan-e5-importar-y-exportar-hojas.md).  
Relacionada con: [fuentes 01](01-fuentes-de-importar-y-exportar-hojas.md), [hojas, «Importación de extremo a extremo»](../../../../../docs-diagrams/12-hojas-modelo-editor-importacion-y-exportacion.md), [fuentes y pendientes, P05](../../../../../docs-diagrams/19-fuentes-trazabilidad-y-decisiones-pendientes.md), [bitácora 01.1](../../../../bitacora-construccion/feature/imports&exports/01.1-limite-de-filas-por-hoja.md).  
Revisión de partida: `main` `7921f00` más E4, E5.1 y E5.1.1 sin commit.

## Pregunta

¿Qué lector de XLSX cumple [12] (una hoja elegida, fila de cabecera, fechas y decimales sin pérdida; 10 MiB comprimidos, 50 MiB descomprimidos, 1.000 entradas, ratio 100:1, 60 s; rechazar cifrados, `.xlsm`, macros, enlaces externos y archivos corruptos) y P05 de [19] («no hay paquete elegido por intuición»)?

## Requisitos

| ID | Documento y pasaje | Qué exige |
| --- | --- | --- |
| H7 | [12], paso 2 | «XLSX exige elegir hoja(s), fila de cabecera y tratamiento de fechas/decimales. MVP: una hoja seleccionada por importación; un libro con varias hojas no se fusiona silenciosamente.» |
| H8 | [12], paso 3 | Límites de ZIP (10 MiB, 50 MiB, 1.000 entradas, 100:1, 60 s); «Rechazar archivos cifrados, `.xlsm`, macros, enlaces externos activos y cargas corruptas». |
| H9 | [18], T13 y T14 | T13: «XLSX fechas 1900/1904, hojas, fórmulas y ceros». T14: «ZIP excesivo/corrupto/cifrado/macros rechazado con límite de recursos». |
| H10 | [12], «Identidad y tipos de celda» y [17] | Conservar ceros; nunca truncar ni redondear en silencio. «Parsing XLSX intensivo puede requerir proceso aislado.» |

## Cursos

Consulta: 2026-11-07. Rutas relativas a `/Users/benji/Documents/chrome-extencions/trancripciones/`. Sin reconstrucción: no hay código que seguir, solo criterios.

| ID | Curso, lección y localizador | Evidencia | Uso |
| --- | --- | --- | --- |
| C31 | Ya registrada en la [ficha 01](01-fuentes-de-importar-y-exportar-hojas.md) (Pandas, lección 134, línea 17) | Con varias hojas, Pandas toma la primera por defecto. | La hoja se elige; solo se toma sin preguntar cuando el libro tiene una. |
| C32 | **Programación VBA**, `Excel/Programación VBA/Sección 1 Getting Started/5. Excel File Types.md`, líneas 17 y 25 | «all workbooks that have macro code must have the» extensión de libro habilitado para macros (la transcripción dice «Excel ask them»; por el contexto es *xlsm*). | Un `.xlsx` legítimo no lleva macros: si aparece `vbaProject.bin` o el tipo `macroEnabled`, se rechaza sin intentar leerlo. |
| C33 | **RAG Multimodal y Agéntico**, `Python/RAG Multimodal y Agéntico/Sección 5 …/16. Parsing CSV And Excel Files.md`, línea 61 | Recorre todas las hojas (`for sheet_name in excel_file.sheet_names`) y junta su contenido. | Alternativa descartada: [12] prohíbe fusionar hojas en silencio. |

## Documentación oficial y registro

Consulta: 2026-11-07.

| ID | Fuente | Evidencia | Uso |
| --- | --- | --- | --- |
| F61 | Registro npm, `npm view` y avisos (`/-/npm/v1/security/advisories/bulk`) | `xlsx` 0.18.5 (última en npm): [GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6) (alta, `<0.19.3`) y [GHSA-5pgg-2g8v-p4x9](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9) (alta, `<0.20.2`); las versiones corregidas solo se publican en el CDN de SheetJS, fuera del registro. `exceljs` 4.4.0 (última, sin versión nueva desde 2023) depende de `tmp` `^0.2.0` con [GHSA-ph9p-34f9-6g65](https://github.com/advisories/GHSA-ph9p-34f9-6g65) (alta) y de `uuid` 8, marcado como no soportado. `read-excel-file` 9.3.14 (MIT, 2026-10-29) sin avisos. `yauzl` 3.4.0 (MIT, 2026-06-07, una dependencia: `pend`) y `saxes` 6.0.0 (ISC, 2021, una dependencia: `xmlchars`; trae sus tipos) sin avisos. | Descartar `xlsx` (avisos altos y origen fuera del registro) y `exceljs` (sin mantenimiento, avisos en dependencias). |
| F62 | [yauzl, README](https://github.com/thejoshwolfe/yauzl#readme) | `validateEntrySizes` «ensures that an entry's reported uncompressed size matches its actual uncompressed size». Sobre bombas ZIP: «Such heuristics are outside the scope of this library, but enforcing the `uncompressedSize` is implemented here as a security feature.» Expone `isEncrypted()` y `lazyEntries`. | Los límites de [12] los pone el código propio sobre el directorio central; yauzl garantiza que nadie descomprime más de lo declarado. |
| F63 | [saxes, README](https://github.com/lddubeau/saxes#readme) | «A sax-style non-validating parser for XML», de flujo, que informa de errores de buena formación; no expande entidades declaradas en un DTD (sección *Regarding `<!DOCTYPE` and `<!ENTITY`*). | Leer la hoja por trozos, sin construir un árbol; rechazar cualquier `DOCTYPE` de forma explícita. |
| F64 | [Open XML, `CellValues`](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.cellvalues) | Tipos de celda: `b`, `n`, `e`, `s`, `str`, `inlineStr` y `d` («only available in Office 2010 and later»). | Una rama por tipo; `e` es un error de fórmula y no un vacío. |
| F65 | [Open XML, `WorkbookProperties.Date1904`](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.workbookproperties.date1904) y [Microsoft, *Date systems in Excel*](https://support.microsoft.com/en-us/office/date-systems-in-excel-e7fe7167-48a9-4b96-bb53-5612a800b487) | Atributo `date1904` de `workbookPr`. «The difference between the two date systems is 1,462 days.» | El sistema de fechas se lee del libro; no es una opción de la persona. |

## Medición

Carpeta temporal de la sesión (`spike-xlsx/`), Node 26.9.0, macOS. Los fixtures se escribieron a mano con `zipfile` de Python para controlar el XML exacto. Cada lector se ejecutó en un proceso propio; «MiB» es la memoria residente máxima del proceso.

**Datos** (`products.xlsx` y su versión 1904): ceros como texto (`007`), espacios, `10.5`, booleanos, fechas con formato estándar y propio, fórmula con valor guardado (`0.1+0.2` → `0.30000000000000004`), fórmula con error (`#DIV/0!`), cadena en línea, texto con formato, fila ausente y dos hojas.

| Lector | Fechas 1900/1904 | Texto exacto de los números | Fórmula con error | Hoja por nombre |
| --- | --- | --- | --- | --- |
| `exceljs` | Bien | No: `number` de JavaScript | Objeto `{ error }` | Sí |
| `read-excel-file` (`trim: false`, `parseNumber`) | Bien | Sí, con `parseNumber` | **Vacía, sin aviso** (lo dice su README) | Sí |
| Prototipo propio (yauzl + saxes) | Número de serie y `date1904` del libro | Sí, el texto de `<v>` | Tipo `error` con `#DIV/0!` | Sí |

**Tamaño y archivos peligrosos:**

| Fixture | `exceljs` | `read-excel-file` | Propio |
| --- | --- | --- | --- |
| 5.000 × 20 (0,5 MB) | 336 ms, 196 MiB | 146 ms, 106 MiB | 118 ms, 111 MiB |
| 5.000 × 200 (5,4 MB; 37,8 MiB descomprimidos) | 2.165 ms, 637 MiB | 1.179 ms, 324 MiB | 942 ms, 368 MiB |
| Bomba (300 KB → 300 MiB de espacios en la hoja) | **Acepta**: 2.257 ms, 893 MiB | **76 s, 1.439 MiB y cae** (desbordamiento de pila) | Rechaza en 8 ms |
| 1.500 entradas | Acepta | Acepta | Rechaza |
| Cifrado por Office (contenedor CFB) | Rechaza (no es ZIP) | Rechaza («legacy `.xls`») | Rechaza |
| Entrada ZIP marcada como cifrada | Rechaza | **Acepta** | Rechaza |
| Macros (`vbaProject.bin`, tipo `macroEnabled`) | **Acepta** | **Acepta** | Rechaza |
| Enlace externo | **Acepta** | **Acepta** | Rechaza |
| Truncado | Rechaza | Rechaza | Rechaza |
| Tamaño descomprimido falseado | Rechaza | Rechaza | Rechaza (yauzl) |
| Hoja inexistente | Rechaza | Rechaza | Rechaza |

**Bloqueo del bucle de eventos** con el prototipo (`monitorEventLoopDelay`): 5.000 × 20, máximo 13 ms; 5.000 × 200, 831 ms en total, **máximo 73 ms** y p99 7 ms, 154 MiB de heap. La hoja se descomprime y se lee por trozos, así que el proceso sigue atendiendo otras peticiones.

## Interpretación

- Ninguna librería aplica los límites de [12]: las dos descomprimen todo lo que encuentran. Con cualquiera haría falta el mismo guardián propio del ZIP delante, y aun así volverían a descomprimir el archivo por su cuenta.
- `read-excel-file` es la mejor librería medida, pero acepta macros, enlaces externos y entradas cifradas, y convierte una fórmula con error en una celda vacía: un `#DIV/0!` pasaría a ser «sin valor» sin que nadie lo vea, lo contrario de H10.
- El prototipo propio son unas 250 líneas sobre dos dependencias pequeñas y mantiene el texto exacto de cada número, que es lo que espera la conversión estricta de E5.1 (D4).
- Con los límites de filas y columnas, el peor caso cabe en la petición (menos de 1 s y 73 ms de bloqueo máximo). No hace falta un trabajo durable ni un proceso aislado ([17]) para estos límites; se revisa si se suben (T34).

## Mapa necesidad → requisito → fuentes → decisión pendiente

| Necesidad | Requisito | Fuentes | Decisión |
| --- | --- | --- | --- |
| Elegir lector | H6, H8, H9 | F61, medición | Lector propio con `yauzl` 3.4.0 y `saxes` 6.0.0. Descartadas `xlsx`, `exceljs` y `read-excel-file`. |
| Límites del ZIP | H8 | F62, medición | Comprobar directorio central (entradas, tamaño declarado, ratio, cifrado) antes de descomprimir; contar bytes reales al descomprimir; yauzl valida que no se supere lo declarado. |
| Contenido activo | H8 | C32, medición | Rechazar `vbaProject.bin`, tipo `macroEnabled`, `externalLinks/`, `activeX/`, `embeddings/` y cualquier `DOCTYPE`. |
| Hoja y cabecera | H7 | C31, C33 | Hoja por nombre; sin nombre, solo si el libro tiene una. Fila de cabecera elegible (por defecto, la 1 de Excel). |
| Tipos de celda | H9, H10 | F64, F65 | Números con su texto exacto; fechas con formato de fecha y serie entera → `YYYY-MM-DD` según `date1904`; error o fórmula sin valor guardado → problema de fila, nunca vacío. |
| Dónde se lee | H10 | medición, [17] | Dentro de la petición, como el CSV (D1). |
