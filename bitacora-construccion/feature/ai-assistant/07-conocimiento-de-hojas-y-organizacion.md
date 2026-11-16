# 07 — E6.1b.2: conocimiento de hojas y organización

Fecha de creación: 2026-11-14  
Estado: Implementado y verificado en local el 2026-11-14. Queda el recorrido con Vertex AI.  
Relacionada con: [fuentes 04](../../../docs/fonts/feature/ai-assistant/04-fuentes-de-hojas-y-organizacion.md), [plan 02](../../../docs/plans/feature/ai-assistant/02-plan-conocimiento-de-hojas-y-organizacion.md), [bitácora del reconciliador](02-nest-manda-el-conocimiento.md).  
Revisión de partida: Nest `7be788b`, FastAPI `d9f00fd`.

## Necesidad

El agente necesita encontrar el esquema y las filas vigentes de las hojas, los libros que las agrupan, los borradores abiertos, el resultado de la última importación y un resumen de la organización. El reconciliador ya envía y retira documentos por organización y proyecto.

## Evidencia y aplicación

| Evidencia y decisión | Aplicación |
| --- | --- |
| Inventario 03, H1 y D1 | [`KnowledgeRepository`](../../../src/knowledge/knowledge.repository.ts) genera huellas de `organization`, `workbook`, `worksheet`, `changeset` y `worksheet_import`. La clave conserva organización y proyecto. |
| E2, E4 y D2 | [`SourceDocuments`](../../../src/knowledge/source-documents.ts) fija la revisión y el esquema. Las consultas de filas usan cursor de `(sort_key, row_id)` en páginas de 100. [`worksheetDocuments`](../../../src/knowledge/knowledge-documents.ts) usa el evaluador de filas existente, traduce las opciones de selección y limita cada fuente a 5.000 filas y su resumen. [FastAPI](../../../../LearningAllPosibolIt-ai/src/ktsu_ai/http/knowledge_http/routes.py) admite el documento adicional. |
| E3 y D3 | Los borradores abiertos incluyen el estado, el tipo y número de operaciones y la decisión sobre la versión vigente. La última importación de cada hoja incluye el informe agregado. La organización lleva recuento de proyectos y de miembros por rol. |

## Ajustes al implementar

- Reindexar marca los registros guardados como pendientes. El reconciliador conserva sus claves para retirar los borradores cerrados y las importaciones sustituidas. El estado público conserva `syncedAt: null` para fuentes pendientes de reindexar. La columna existente admite la marca y las migraciones se mantienen al día.
- Los documentos excepcionalmente anchos se recortan con `…` a un máximo de 8.000 caracteres. Los valores completos siguen disponibles en las lecturas exactas de la API.
- Las hojas y los libros archivados conservan el estado de lectura. El índice recoge solo los datos compartidos del proyecto. Las vistas, plantillas, motivos de decisión y datos personales de las membresías quedan fuera de los documentos.

## Comprobaciones ejecutadas el 2026-11-14

| Comprobación | Resultado |
| --- | --- |
| Nest: TypeScript, lint y Prettier | Pasaron. |
| Nest: batería completa en copia aislada | 120 suites y 1.850 pruebas pasaron. Una suite y cinco pruebas omitidas por configuración. Incluye las siete pruebas E2E de conocimiento de hojas y el caso de reindexado con borrador cerrado. |
| Nest: `pnpm db:verify` | 3 de 3 en PGlite. |
| FastAPI: Ruff, formato, mypy, import-linter y pytest locales | Pasaron 126 pruebas. 30 pruebas de proveedores o Qdrant quedaron fuera de esa ejecución. |
| Arranque integrado | Nest y FastAPI escucharon por HTTP en loopback, con PostgreSQL 15.2 efímero, Qdrant 1.19.1 en colección temporal y embeddings deterministas. Se verificaron salud, 401, 404 entre organizaciones, reindexado, búsqueda de una fila restringida al proyecto, GraphQL y apagado sin errores. Después se eliminó la colección temporal. |
| Esquema frente a migraciones | Las 35 migraciones se aplicaron en PostgreSQL temporal. Prisma devolvió `This is an empty migration` al comparar con el esquema. |

El primer arranque con todos los workers sobre el socket de PGlite falló con `unnamed prepared statement does not exist` durante escrituras concurrentes. El arranque integrado se repetió con PostgreSQL efímero. El arnés de Nest usa Descope simulado y los datos son sintéticos.

### Defectos deliberados

10 de 10 detectados en copias temporales. Cada cambio de Nest compiló y falló en la prueba relacionada.

| ID | Defecto |
| --- | --- |
| K1 | Indexar filas borradas. |
| K2 | Omitir la revisión vigente de la huella de hoja. |
| K3 | Omitir el recuento por rol de la huella de organización. |
| K4 | Mantener borradores aplicados en el índice. |
| K5 | Elegir la importación más antigua. |
| K6 | Paginar filas sin desempatar por su ID. |
| K7 | Borrar las claves guardadas al pedir reindexado. |
| K8 | Aceptar una fila adicional en el generador de documentos. |
| P1 | Permitir el documento adicional también en fuentes distintas de hojas. |
| P2 | Rechazar el documento de esquema cuando la hoja tiene 5.000 filas. |

## Continuidad

El recorrido con Vertex AI queda pendiente de autorización. La siguiente etapa del backend es [E6.2, conversaciones privadas](../../../docs/plans/feature/ai-assistant/03-plan-conversaciones-y-mensajes.md).
