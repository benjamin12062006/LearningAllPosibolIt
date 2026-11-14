# 03 — Fuentes de E6.1: qué datos van a Qdrant y cómo

Fecha de creación: 2026-11-09  
Última actualización: 2026-11-09  
Estado: Cerrada. *Ajustada el 2026-11-09:* modelos de la API de Google (Vertex AI), sin descargas ni modelos propios.  
Relacionada con: [plan E6](../../../plans/feature/ai-assistant/01-plan-e6-ia-con-qdrant-y-llamaindex.md) (D4, D5, D7), [revisión 02](02-revision-de-llamaindex-para-la-api.md), [plan del servicio de IA](../../../../../LearningAllPosibolIt-ai/docs/plans/feature/base-del-servicio/01-plan-servicio-de-ia.md).

## La pregunta del usuario

«Qdrant tendrá que recibir todos los datos de la base asociados al usuario». Sí: **todo lo que una persona puede ver en un proyecto** acaba en Qdrant, pero no como copia de tablas, sino como **documentos** que el agente entiende («el producto SKU-42, zapatillas rojas, 59,90 €, inválido porque falta la imagen, publicado en el feed»). Tres reglas:

1. **Estado actual, no historia.** Qdrant guarda cómo están las cosas ahora (la revisión vigente de cada hoja, el último catálogo, la última evaluación). La historia (revisiones antiguas, auditoría) sigue en PostgreSQL y el agente la consulta con herramientas exactas (E6.3).
2. **Nada secreto ni técnico.** Fuera: hashes de tokens, claves de archivos, recibos de idempotencia, outbox, leases de trabajos, correos de invitación.
3. **Lo exacto no se busca, se pregunta.** Qdrant sirve para encontrar por significado y por palabras («productos de running con precio mal»). Contar, sumar o filtrar por valor lo hacen herramientas sobre SQL (C1, C2 de la ficha 01).

## Inventario de las 28 tablas (E)

| Tabla | Decisión | Documento (`source_type`) y texto |
| --- | --- | --- |
| `organizations` | Qdrant | `organization`: nombre, si está archivada, número de proyectos y de miembros por rol. |
| `organization_members` | Dentro de `organization` | Solo roles y recuentos. Nombres y correos no: datos personales, se consultan con herramienta si hace falta. |
| `organization_invitations` | **Nunca** | Correo y hash del token. |
| `app_users` | **Nunca** como documento | Datos personales. Las herramientas devuelven `displayName` cuando la persona puede verlo. |
| `projects` | Qdrant | `project`: nombre, país, moneda, perfil de canal, si está configurado, recuentos (hojas, productos, reglas, feed). |
| `workbooks` | Qdrant | `workbook`: nombre y sus hojas. |
| `worksheets` + `worksheet_column_versions` | Qdrant | `worksheet`: nombre, modo, columnas del esquema vigente (nombre, tipo, obligatoria, opciones, fórmula), filas de la revisión vigente. |
| `worksheet_row_versions` | Qdrant, **solo la revisión vigente** | `worksheet_row`: «Hoja Productos · fila 12 · SKU: 0042 · Nombre: Zapatillas rojas · Precio: 59.90». Una por fila; las largas se trocean. |
| `worksheet_revisions` | Herramienta | Historial: número, origen, autor, fecha. |
| `worksheet_changesets` | Qdrant, **solo abiertos** (borrador, en revisión, aprobado sin aplicar) | `changeset`: título, estado, hoja, autor (nombre visible), recuento de operaciones por tipo. Las operaciones completas, por herramienta. |
| `worksheet_changeset_decisions` | Dentro de `changeset` | Última decisión y motivo. |
| `worksheet_imports` | Qdrant, la última por hoja | `worksheet_import`: formato, filas, informe (errores por código), filas excluidas. Sin el hash del archivo. |
| `worksheet_exports`, `worksheet_catalog_snapshots` | Herramienta | Metadatos de archivos y procedencia. |
| `catalog_snapshots` + `catalog_rows` | Qdrant, **el último catálogo listo** | Ver `product`. Además `catalog`: nombre original del archivo, columnas, filas, estado, fecha. |
| `evaluations` + `evaluation_rows` | Qdrant, **la última evaluación** | `evaluation`: recuentos y los problemas agrupados por código, en español. Por producto, dentro de `product`. |
| `ruleset_versions` | Qdrant, la revisión vigente | `ruleset`: mapeo de columnas y cada regla en una frase. |
| `exports` | Herramienta | Una exportación es un archivo aprobado; su contenido ya está en `product` y en el visor. |
| `feeds` + `feed_versions` + `feed_refreshes` | Qdrant | `feed`: versión publicada (filas, fecha, quién), programación, política, última actualización y su error. Sin token ni URL de entrega. |
| `catalog_import_jobs`, `operation_receipts`, `outbox_events` | **Nunca** | Técnicas. |
| `audit_events` | Herramienta | «¿Quién cambió esto?» es una consulta exacta, no una búsqueda. |

### El documento `product`

Es la pieza más útil: **una ficha por producto y proyecto** que junta lo que hoy está repartido en tres tablas. Clave: `(proyecto, id externo)`.

```text
Producto SKU-0042 (catálogo «productos-otoño.csv», fila 43)
Título: Zapatillas de running rojas · Marca: Acme · Precio: 59,90 EUR · Disponibilidad: in stock
Evaluación del 2026-11-08: inválido — falta image_link; el precio usa coma decimal.
En el feed publicado: no.
```

Metadatos: `organization_id`, `project_id`, `source_type`, `source_id`, `external_id`, `outcome`, `in_feed`.

## Cómo llegan los cambios (D7 del plan)

Recorrer los módulos para añadir eventos en cada transacción tocaría casi toda la API. En su lugar, un **reconciliador** en Nest:

1. Una consulta por proyecto calcula una **huella** de cada fuente con datos que ya existen: `head_revision_id` de cada hoja, `schema_version`, id del último catálogo listo, id y estado de la última evaluación, revisión de reglas, `generation` y última actualización del feed, `updated_at` máximo de los changesets abiertos, nombre y configuración del proyecto.
2. Compara con la tabla nueva `knowledge_sync_state` (proyecto, fuente, huella, fecha), **sin clave foránea** al proyecto, para poder borrar los puntos de un proyecto que ya no existe.
3. Para lo que cambió, construye los documentos (funciones puras, una por tipo) y los manda al servicio de IA, que **reemplaza** los de esa fuente. Para lo que desapareció, pide borrarlos.
4. Se ejecuta cada pocos segundos con el patrón de `jobs` (lease, una instancia), y también al pedir `POST /projects/:id/knowledge/reindex`.

Así ningún módulo existente cambia, y si el servicio de IA o Qdrant caen, se reintenta sin perder nada: la huella solo se guarda cuando el servicio confirmó.

## En el servicio de IA (LlamaIndex)

| ID | Hallazgo en el código instalado | Decisión |
| --- | --- | --- |
| L1 | `QdrantVectorStore(collection_name, aclient=…, enable_hybrid=…, dense_vector_name=…)` (`llama_index/vector_stores/qdrant/base.py` 0.10.4, línea 177) | Almacén de LlamaIndex, de momento solo denso. |
| L2 | `aquery(query, qdrant_filters=…)` sustituye el filtro calculado (línea 1043) | El adaptador consulta el almacén directamente con el filtro de inquilino; no se usa `as_retriever` (en TS guardaba nodos en memoria, R3). |
| L3 | `payload_indexes` solo admite `field_schema` simple (línea 1008): no puede poner `is_tenant` | Los índices los crea nuestro código con `qdrant-client` al arrancar. |
| L4 | `fastembed.sparse.bm25.Bm25` admite `language` (Snowball y stopwords; línea 99) | *Retirada (2026-11-09):* sin búsqueda dispersa propia; ver «Modelos». |
| L6 | `node_to_metadata_dict` (`llama_index/core/vector_stores/utils.py`) escribe `document_id`, `doc_id` y `ref_doc_id` en cada punto (hallado en E6.1a, cuando las pruebas contra Qdrant fallaron) | Nuestro id va en `knowledge_document_id` y esos nombres quedan reservados. |
| L5 | `SentenceSplitter` y `TextNode` de `llama_index.core` | Trocear las filas o fichas largas sin partir frases; el id de cada trozo es estable (fuente + número de trozo). |

## Modelos: la API de Google (decisión del usuario)

El usuario descartó descargar modelos y crear modelos propios: «usaremos los modelos de su api de google». Eso retira L4 (BM25 local) y la medición de FastEmbed.

| ID | Fuente | Qué se toma |
| --- | --- | --- |
| G1 | Google Cloud, *Get text embeddings* (`docs.cloud.google.com/vertex-ai/generative-ai/docs/embeddings/get-text-embeddings`), consultado 2026-11-09 | Modelos: `gemini-embedding-001` (hasta 3072 dimensiones, 2048 tokens, multilingüe), `gemini-embedding-2` (hasta 3072, 8192 tokens, también imágenes), `text-multilingual-embedding-002` (768), `text-embedding-005` (inglés). `output_dimensionality` reduce el vector. Límites: 250 textos y 20.000 tokens por petición; la página también dice que `gemini-embedding-001` admite un solo texto por petición en REST. **Comprobado el 2026-11-09 con Vertex activado:** admite 64 por petición; se usan lotes de 32 con 4 peticiones a la vez (bitácora 02 del servicio). |
| G2 | PyPI: `llama-index-embeddings-google-genai` 0.6.0 (2026-08-29, MIT, `google-genai<3`), `llama-index-llms-google-genai` 0.11.3, `google-genai` 2.32.0 (2026-10-21) | `GoogleGenAIEmbedding(model_name=…, vertexai_config={project, location}, embedding_config=…, retries, timeout)`; sin `api_key` usa las credenciales de la cuenta. |
| G3 | `gcloud services list --enabled --project estadistica-forms-api` (2026-11-09) | Activas: `generativelanguage.googleapis.com` y `sqladmin.googleapis.com`. **No** está `aiplatform.googleapis.com` (Vertex AI). Hay credenciales de la cuenta (`application_default_credentials.json`). El proyecto por defecto de `gcloud` es otro (`expo-city-bol`), así que el servicio fija el proyecto en su configuración. |

Decisión: `gemini-embedding-001` con `output_dimensionality=768` (menos memoria en Qdrant; la página lo permite) y tipos de tarea `RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY`. Las dimensiones se guardan en la configuración y se comprueban contra la colección al arrancar: cambiar de modelo obliga a reindexar.
