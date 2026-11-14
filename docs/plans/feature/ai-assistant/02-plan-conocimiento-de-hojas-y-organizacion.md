# 02 — Plan de conocimiento de hojas y organización

Fecha de creación: 2026-11-14  
Estado: Implementado y verificado en local el 2026-11-14. Falta Vertex AI.  
Relacionada con: [plan E6](01-plan-e6-ia-con-qdrant-y-llamaindex.md), [fuentes 04](../../../fonts/feature/ai-assistant/04-fuentes-de-hojas-y-organizacion.md), [bitácora 07](../../../../bitacora-construccion/feature/ai-assistant/07-conocimiento-de-hojas-y-organizacion.md).  
Revisión de partida: Nest `7be788b`, FastAPI `d9f00fd`.

| Decisión | Implementación prevista | Evidencia |
| --- | --- | --- |
| D1 | Agregar `workbook`, `worksheet`, `changeset`, `worksheet_import` y `organization` al reconciliador existente. Las claves incluyen la organización y el proyecto. Las huellas reflejan los hechos publicados en cada documento. | H1, E1–E3 |
| D2 | Emitir un resumen del esquema y un documento estable por fila, hasta 5.000 filas de la revisión vigente. FastAPI admite 5.001 documentos únicamente para `worksheet`. | E2, E4 |
| D3 | Indexar recuentos por rol, recuentos y estados de borradores abiertos y el informe agregado de la importación más reciente. Las hojas archivadas conservan su estado visible. Los datos personales de las membresías, los detalles de operaciones, las vistas y las plantillas quedan fuera del índice. | H1, E2–E3 y C2 |
| D4 | Probar envío, actualización, eliminación, límites y aislamiento con datos de dos organizaciones. Separar la comprobación local con embeddings deterministas de la comprobación con Vertex AI. | H1 y E4 |

## Etapas

| Etapa | Comprobación |
| --- | --- |
| E6.1b.2 | Pruebas unitarias y E2E del reconciliador sobre PGlite, contrato HTTP de FastAPI, defectos deliberados, batería completa, esquema frente a migraciones, verificación de base y arranque real. Recorrido local de ambos servicios con Qdrant temporal y embeddings deterministas. El recorrido con Vertex AI requiere autorización explícita. |

Ajuste de D1. Reindexar conserva las claves existentes hasta que Qdrant confirme la retirada. La bitácora registra la prueba de regresión y el resto de las comprobaciones de la etapa.
