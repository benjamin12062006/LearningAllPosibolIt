# 04 — Fuentes: qué falta para terminar el backend (hojas, después del TSV y agente)

Fecha de creación: 2026-11-12  
Estado: Investigación. Inventario del código y de los documentos de diseño; no hay código nuevo.  
Relacionada con: [plan 02](../../../plans/feature/cierre-backend/02-plan-terminar-hojas-visor-y-agente.md), [plan E6](../../../plans/feature/ai-assistant/01-plan-e6-ia-con-qdrant-y-llamaindex.md), [ficha 03 del conocimiento](../ai-assistant/03-fuentes-de-indexar-el-conocimiento.md), [12, hojas](../../../../../docs-diagrams/12-hojas-modelo-editor-importacion-y-exportacion.md), [15, chat e IA](../../../../../docs-diagrams/15-chat-ia-herramientas-y-propuestas.md), [22, visor y diagnóstico](../../../../../docs-diagrams/22-visor-y-diagnostico-del-feed.md), [visión original](../../../../../docs-diagrams/fuentes/2026-11-01-vision-saas-original.txt), [ampliación del 9 de noviembre](../../../../../docs-diagrams/fuentes/2026-11-09-ampliacion-visor-qdrant-llamaindex.md).  
Revisión de partida: `feature/cierre-backend` `b219b30`, más los cambios sin commit de los días 9–11 (visor V1 y módulo `knowledge`).

## Petición del usuario (2026-11-12, resumida)

1. Terminar **todo el backend**, Nest y FastAPI, como indican `docs-diagrams/fuentes/`.
2. Dejar claras dos partes: lo que falta **en Nest** (sobre todo la feature de hojas, «nuestro propio Excel») y lo que falta **en FastAPI** (el agente, que se integra con toda la API).
3. Hay una feature nueva en `docs-diagrams`: lo que ocurre **después de exportar el TSV**. En vez de mirarlo en Merchant Center, se ve y se trabaja en nuestra app (documento 22).
4. Las dos puntas son la conclusión de la API: **antes de que el CSV entre** (hojas) y **después de crear el TSV** (visor y diagnóstico).
5. El agente debe tener acceso a **prácticamente todas** las features de la API.
6. Orden coherente, plan por pasos y ejecutarlo.

## Estado real del código

### E1 — La API tiene 82 rutas REST y ninguna lista única de ellas

Inventario con `grep` de los decoradores de los 21 controladores de `src/` (2026-11-12):

| Módulo | Rutas | Módulo | Rutas |
| --- | --- | --- | --- |
| `auth`, `users` | 4 | `evaluations` | 5 |
| `organizations` (con invitaciones) | 12 | `exports` | 3 |
| `projects` (con membresía) | 6 | `feeds` | 10 |
| `worksheets` | 6 | `feed-refreshes` | 2 |
| `changesets` | 11 | `feed-viewer` | 2 |
| `worksheet-imports` | 3 | `feeds` (entrega pública) | 1 |
| `worksheet-exports` | 3 | `knowledge` | 2 |
| `worksheet-catalog-snapshots` | 2 | `health` | 1 |
| `catalog-import` | 6 | `rulesets` | 3 |

Consecuencia para el agente: no existe un sitio donde cada operación esté declarada con nombre, descripción y permiso. D9 del plan E6 (el catálogo de operaciones) hay que construirlo, y la única forma de garantizar «prácticamente toda la API» es una prueba que recorra las rutas reales y exija que cada una esté **declarada o excluida con motivo**.

### E2 — Hojas: se crean y se leen, pero no se administran

`src/worksheets/worksheets.controller.ts` tiene seis rutas: crear y listar libros, crear y listar hojas, leer una hoja y consultar filas. Comprobado con `grep` (sin resultados para `archive`, `duplicate`, `findRevisions`, `findChangesets`, `findImports`, `findExports`):

| Falta | Dónde lo pide el diseño |
| --- | --- |
| Renombrar, archivar y duplicar libros y hojas | Visión 4.2 («Crear, abrir, renombrar, duplicar y archivar hojas»); 12, «Crear/renombrar/duplicar/archivar» |
| Listar las revisiones de una hoja (historial) | Visión 4.2 («Comparar con versiones anteriores») y 24 («Consultar quién hizo cada modificación») |
| Listar los borradores de una hoja | 13; hoy solo se lee uno por id |
| Listar las importaciones y exportaciones de una hoja | 12; hoy solo se lee una por id |
| Plantillas de mapeo de importación | Visión 5.2, paso 3 («El mapeo podrá guardarse como plantilla reutilizable»); 12, `import_mappings` |
| Vistas guardadas (filtros, orden y columnas visibles) | 12, `saved_views`; 15, `suggest_view` |
| Vínculo inverso: un catálogo terminado como origen de una hoja nueva | 12, «Puente al catálogo» («El vínculo inverso usa un snapshot terminado como origen de una nueva hoja y copia valores») |

`Worksheet` y `Workbook` no tienen columna de archivado en `prisma/schema.prisma` (líneas 380–425): archivar necesita migración.

### E3 — Lo que ya cubre hojas (no se repite)

Tipos texto, entero, decimal, fecha, booleano, selección y calculada (`worksheet-columns.ts`), consulta de filas con filtro y cursor, borradores con diff, envío, decisión, aplicación, rebase y revertir (11 rutas), cambios de columnas con cambio de tipo (C5), importación CSV/XLSX con vista previa y mapeo en la petición, exportación CSV/XLSX y puente de la hoja al catálogo (E5.4).

### E4 — Después del TSV: V1 lee productos; el resto de 22 no existe

- `src/feed-viewer/`: dos rutas que devuelven una página del TSV (`readTsvPage`, línea a línea, búsqueda en `id` y `title`). No hay lectura de **un** producto.
- `ExportView.evaluationId` y `PublishedVersionView.evaluationId` (que puede ser nulo) enlazan cada archivo con su evaluación: de ahí sale «Requiere atención».
- `GET …/evaluations/:id/rows` da filas con `problems` y `excludedByRule`, pero **sin agrupar**: no hay recuento por problema y atributo ni total de productos distintos.
- No hay comparación entre dos TSV ni vista previa de reglas: `POST …/evaluations` siempre persiste una evaluación completa.
- `GET …/feeds/:feedId` ya da la versión vigente, la última actualización y si la entrega está activa; falta una respuesta que **explique** por qué la URL pública no entrega.

### E5 — Agente: hay índice, no hay conversación ni herramientas

| Pieza | Estado |
| --- | --- |
| Servicio de IA: base, indexar y buscar (E6.0, E6.1a) | Hecho y verificado, sin commit |
| Nest manda el conocimiento (E6.1b.1) | Código y 20 unitarias; faltan E2E, defectos y verificación ([bitácora 02](../../../../bitacora-construccion/feature/ai-assistant/02-nest-manda-el-conocimiento.md)) |
| Fuentes de hojas en el índice (E6.1b.2) | Sin empezar: `SourceDocuments.of` lanza error para `worksheet`, `workbook`, `changeset`, `worksheet_import` y `organization` |
| Conversaciones, ejecuciones, catálogo de operaciones, agente, streaming, modelo real | Sin empezar (E6.2–E6.6) |
| Herramientas de hoja del documento 15 (`preview_transform`, `create_change_proposal`, `propose_sheet_layout`) | Sin empezar. Son lógica de Nest: el modelo da la intención y Nest calcula los valores |

## Requisitos del diseño

| ID | Requisito | Fuente |
| --- | --- | --- |
| H1 | El agente maneja ≈90 % de la API; nunca aprueba, aplica, publica, borra, cambia roles ni tokens; las escrituras piden confirmación | Plan E6 D9 y D13; visión 8.3 |
| H2 | Para cálculos masivos el modelo devuelve la intención y Nest calcula; la propuesta es un changeset | 15, «Herramientas» y «Propuesta estructurada» |
| H3 | Ficha de producto con todos los atributos del TSV y su procedencia | 22, «Ficha de producto» |
| H4 | «Requiere atención»: grupos por problema y atributo, productos distintos, exclusiones aparte, aviso si falta la evaluación de origen | 22, «Requiere atención» |
| H5 | Comparar el TSV candidato con la versión vigente por ID: añadidos, retirados, modificados (qué valores) e iguales | 22, «Probar reglas y comparar» |
| H6 | Comparar reglas actuales y propuestas sobre el mismo catálogo, reutilizando el motor, sin publicar nada | 22, ídem |
| H7 | Explicar por qué el feed no entrega: sin publicación, entrega desactivada, versión retirada | 22, «Entrega del feed» y «Qué demostrar» |
| H8 | Duplicar fija una revisión de origen y crea IDs nuevos con procedencia; archivar impide escrituras y permite lectura | 12 |
| H9 | Una vista guardada no cambia valores; una plantilla de mapeo es reutilizable | 12 |
| H10 | Todo lo nuevo sigue C6: ajeno 404, sin permiso 403, organización archivada 409 | Contexto, «Quién puede qué» |

## Límites de esta ficha

No se consultaron cursos ni documentación externa para este inventario: es estado del código y diseño propio. Cada etapa que necesite un mecanismo nuevo (SSE, agente de LlamaIndex, evaluadores, comparación de archivos) abrirá su ficha con cursos y documentación oficial antes de programar, como pide el flujo.

## Mapa necesidad → requisito → evidencia → decisión

| Necesidad | Requisito | Evidencia | Decisión (plan 02) |
| --- | --- | --- | --- |
| Cerrar lo que quedó a medias | — | E5 | P1 |
| Ver un producto y entender la entrega | H3, H7 | E4 | V2 |
| Saber qué arreglar antes de publicar | H4 | E4 | V3 |
| Saber qué cambia si publico | H5 | E4 | V4 |
| Probar reglas sin publicar | H6 | E4 | V5 |
| Administrar libros y hojas | H8 | E2 | H1 |
| Ver el historial de una hoja | — | E2 | H2 |
| Reutilizar mapeos y vistas | H9 | E2 | H3, H4 |
| Abrir un catálogo como hoja | — | E2 | H5 |
| Que el agente conozca las hojas | — | E5 | E6.1b.2 |
| Que el agente proponga cambios de hoja | H2 | E5 | H6 |
| Que el agente maneje casi toda la API | H1 | E1, E5 | E6.2–E6.6 |
