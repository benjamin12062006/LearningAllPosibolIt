# 04 — Fuentes de hojas y organización para E6.1b.2

Fecha de creación: 2026-11-14  
Estado: Consultada.  
Relacionada con: [inventario 03](03-fuentes-de-indexar-el-conocimiento.md), [plan de E6.1b.2](../../../plans/feature/ai-assistant/02-plan-conocimiento-de-hojas-y-organizacion.md).  
Revisión de partida: Nest `7be788b`, FastAPI `d9f00fd`.

| ID | Evidencia | Aplicación |
| --- | --- | --- |
| H1 | [Inventario 03](03-fuentes-de-indexar-el-conocimiento.md), tablas de hojas y organizaciones. [Diseño 18](../../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md), T18b. | Estado vigente útil para búsqueda, filtrado siempre por organización y proyecto. |
| E1 | [`KnowledgeRepository`](../../../../src/knowledge/knowledge.repository.ts) y [`SourceDocuments`](../../../../src/knowledge/source-documents.ts); el reconciliador de E6.1b.1 reemplaza por clave y guarda la huella tras confirmación. | Añadir fuentes al mismo recorrido y usar identificadores estables. |
| E2 | [`schema.prisma`](../../../../prisma/schema.prisma), `Workbook`, `Worksheet`, `WorksheetRowVersion`, `WorksheetChangeset`, `WorksheetImport`; [`WorksheetsService`](../../../../src/worksheets/worksheets.service.ts). | Referir las filas al `head_revision_id`. Los libros y las hojas archivados siguen disponibles para lectura. |
| E3 | [`ChangesetsService`](../../../../src/changesets/changesets.service.ts), [`WorksheetImportsService`](../../../../src/worksheet-imports/worksheet-imports.service.ts), [`SavedViewsService`](../../../../src/worksheets/saved-views.service.ts) y [`ImportMappingsService`](../../../../src/worksheet-imports/import-mappings.service.ts). | El índice tiene alcance de proyecto. Los borradores e importaciones se resumen. Las vistas personales y las plantillas se consultarán mediante las herramientas exactas. |
| E4 | [`KnowledgeLimits`, `ReplaceSourceRequest`](../../../../../LearningAllPosibolIt-ai/src/ktsu_ai/http/knowledge_http/dto/knowledge_request_dto.py) y [`SourceType`](../../../../../LearningAllPosibolIt-ai/src/ktsu_ai/domain/knowledge/knowledge_document.py). | FastAPI reconoce las cinco fuentes. El límite anterior de 5.000 documentos precisa un documento adicional para incluir el esquema con las 5.000 filas. |
| C2 | [Ranking, Sparse, Dense & Ensemble Retrievers](</Users/benji/Documents/chrome-extencions/trancripciones/Python/Aplicaciones GenAI y Sistemas Multiagente/Sección 14 Advanced Retrieval Augmented Generation/154. Ranking, Sparse, Dense & Ensemble Retrievers.md>), línea 23, localizado en la ficha 01. | La búsqueda densa permite recuperar por significado. Los filtros y agregados sobre datos de la hoja se resuelven mediante las operaciones exactas del plan E6. |

| Necesidad | Requisito y fuentes | Decisión del plan |
| --- | --- | --- |
| Encontrar la hoja y sus datos vigentes | H1, E1–E2, E4 y C2 | D1–D2 |
| Aislar organización y acotar los datos del índice | H1, E1 y E3 | D1, D3 |
| Comprobar el contrato entre servicios | H1 y E4 | D2, D4 |
