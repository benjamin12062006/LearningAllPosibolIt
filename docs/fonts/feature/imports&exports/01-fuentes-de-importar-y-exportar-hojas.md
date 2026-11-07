# 01 — Fuentes para importar y exportar hojas (E5)

Fecha de creación: 2026-11-06  
Última actualización: 2026-11-06  
Estado: Investigación que respalda el [plan 01](../../../plans/feature/imports&exports/01-plan-e5-importar-y-exportar-hojas.md). Cubre E5.1 (CSV) con detalle; E5.2–E5.4 se completan en su propia ficha.  
Relacionada con: [hojas](../../../../../docs-diagrams/12-hojas-modelo-editor-importacion-y-exportacion.md), [contratos](../../../../../docs-diagrams/16-nuxt-tabla-central-chat-y-contratos.md), [trabajos](../../../../../docs-diagrams/17-trabajos-integraciones-operacion-y-expansion.md), [secuencia](../../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md), [fuentes y pendientes](../../../../../docs-diagrams/19-fuentes-trazabilidad-y-decisiones-pendientes.md), [fuentes de borradores](../changesets/01-fuentes-de-borradores-y-revisiones.md).

## Estado real del código (2026-11-06, tras cerrar E4)

| ID | Hallazgo |
| --- | --- |
| E1 | `catalog-import/csv-parser.ts` ya lee CSV con `csv-parse` 7.0.3 (`bom: true`, `cast: false`, `trim: false`), UTF-8 estricto y límites `IMPORT_LIMITS` (10 MiB, 5.000 filas, 200 columnas). Exige una columna ID única: está hecho para el catálogo, no para hojas. |
| E2 | La subida del catálogo pasa por `ImportUploadInterceptor` y `ArtifactStore` (archivo temporal en disco, trabajo durable). |
| E3 | E4 ya ofrece borradores con `insert_row`, `set_cell` y `add_column`, comparación, aprobación y aplicación atómica. `worksheet_changesets.source` solo admite `manual` y `revert`. |
| E4 | Aplicar escribe cada fila con dos consultas (cerrar versión e insertar). Con 5.000 filas son 10.000 viajes a la base dentro de una transacción. |
| E5 | `cell-values.ts` define la forma canónica de cada tipo (texto tal cual, enteros y decimales como cadena, fecha `YYYY-MM-DD`, booleano, ID de opción). |

## Requisitos del diseño

| ID | Documento y pasaje | Qué exige |
| --- | --- | --- |
| H1 | [18](../../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md), fila E5 y microentregas | E5.1 CSV con IDs y mapeo, sin IA; E5.2 XLSX y límites de ZIP; E5.3 exportaciones; E5.4 adaptador a snapshot. Salida: «Archivo → borrador → revisión → archivo». |
| H2 | [12](../../../../../docs-diagrams/12-hojas-modelo-editor-importacion-y-exportacion.md), «Importación de extremo a extremo», pasos 1–8 | Tamaño acotado y hash; CSV conserva texto; modo `append` o `upsert` con clave única en archivo y destino; duplicados son errores; «Ausencia en archivo no implica eliminación»; linter con `sourceRow`, `columnId` y código; materializar un borrador sobre una revisión base; exclusiones con «exactamente sus IDs, razones y hash del conjunto incluido». |
| H3 | [12](../../../../../docs-diagrams/12-hojas-modelo-editor-importacion-y-exportacion.md), «Identidad y tipos de celda» | Conservar ceros iniciales; booleano con «etiquetas de importación mapeadas explícitamente»; selección por ID de opción. |
| H4 | [16](../../../../../docs-diagrams/16-nuxt-tabla-central-chat-y-contratos.md), tabla de rutas | `POST P/worksheet-imports` (multipart, trabajo, 202) y `POST P/worksheet-imports/:id/proposal` (mapping, destino, base). |
| H5 | [18](../../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md), T04, T13, T15 | T04 importes exactos, null/vacío, SKU con ceros. T13 CSV con comillas, BOM, saltos y duplicados. T15 la exclusión fija IDs y hash y el resto no cambia antes de aplicar. |
| H6 | [19](../../../../../docs-diagrams/19-fuentes-trazabilidad-y-decisiones-pendientes.md), P05 | Librería XLSX elegida con un spike (fixtures, mantenimiento, licencia, memoria y límites), «no hay paquete elegido por intuición». |

## Cursos

Consulta: 2026-11-06. Rutas relativas a `/Users/benji/Documents/chrome-extencions/trancripciones/`. Sin reconstrucción.

| ID | Curso, lección y localizador | Evidencia | Uso |
| --- | --- | --- | --- |
| C30 | **IA y Machine Learning con Go**, `Go/IA y Machine Learning con Go/Sección 9 …/111. Setting up types, and loading and validating data.md`, líneas 25 y 29 | Antes de seguir comprueba que existan todas las columnas necesarias («we can't go any further if we don't have all the required columns») y cada error nombra la columna y la fila (`missing value found in column %s at row %d`, con `i+1`). | El informe de importación da `sourceRow` (desde 1, sin la cabecera) y `field` con la cabecera; un mapeo a una cabecera que no existe se rechaza antes de leer filas. |
| C31 | **Pandas para Análisis de Datos**, `Python/Pandas para Análisis de Datos/Sección 12 Input and Output/134. Import Excel Workbook into pandas.md`, línea 17 | Con varias hojas, «por defecto, Pandas simplemente va a elegir el contenido de la primera hoja». | Para E5.2: elegir la hoja de forma explícita; nunca fusionar ni tomar la primera en silencio ([12]). |

## Documentación oficial

Consulta: 2026-11-06.

| ID | Fuente | Evidencia | Uso |
| --- | --- | --- | --- |
| F60 | [csv-parse, opciones](https://csv.js.org/parse/options/) | `bom`: «detect and exclude the byte order mark (BOM)»; `relax_column_count`: descartar columnas inconsistentes (por defecto `false`); `max_record_size`: máximo de caracteres antes de lanzar; `cast`: si es `true`, intenta convertir a tipos nativos. | Mismas opciones que el catálogo (E1), con `relax_column_count: false`: una fila con otro número de campos es un error con su fila. Sin `cast`: la conversión la hace el código por tipo de columna. |
| F7, F8 | Ya registradas en [19](../../../../../docs-diagrams/19-fuentes-trazabilidad-y-decisiones-pendientes.md) (OWASP File Upload y CSV Injection) | Límites de tamaño y tipo al subir; riesgo de fórmulas al abrir un CSV exportado. | F7 en E5.1 (límite de 10 MiB en la subida); F8 en E5.3 (exportar). |

## Mapa necesidad → requisito → fuentes → decisión pendiente

| Necesidad | Requisito | Fuentes | Decisión |
| --- | --- | --- | --- |
| Leer el CSV de una hoja | H2, H5 | E1, F60 | Lector propio pequeño con las opciones de E1, sin columna ID obligatoria. |
| Trabajo durable o en la petición | H4 | E2, E4, [17] | **Pendiente en el plan:** el CSV acotado se puede leer dentro de la petición; el XLSX puede necesitar un proceso aislado ([17]). |
| Convertir texto a valor canónico | H3, T04 | E5 | Conversión estricta por tipo, sin redondear; separador decimal y etiquetas booleanas como opciones explícitas. |
| Append y upsert | H2 | — | Clave de coincidencia en una columna existente; duplicados en archivo o destino son errores. |
| Exclusiones exactas | H2, T15 | C30 | Las filas inválidas no entran solas: hay que excluirlas por `sourceRow`; se guardan con sus códigos y el hash del conjunto incluido. |
| Aplicar 5.000 filas | H1 | E4 | Escribir las versiones de fila por lotes. |
| Librería XLSX | H6 | C31 | Spike en E5.2. |
