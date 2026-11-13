# 02 — Revisión de LlamaIndex para la API: qué hace, qué nos daría y su estado

Fecha de creación: 2026-11-09  
Última actualización: 2026-11-09  
Estado: Revisión cerrada; la elección de framework la decide el usuario.  
Relacionada con: [fuentes 01](01-fuentes-del-visor-qdrant-y-llamaindex.md), [plan E6](../../../plans/feature/ai-assistant/01-plan-e6-ia-con-qdrant-y-llamaindex.md), [ampliación de la visión](../../../../../docs-diagrams/fuentes/2026-11-09-ampliacion-visor-qdrant-llamaindex.md).

El usuario pidió revisar LlamaIndex a fondo antes de planificar, para no hacer un plan genérico. Esta ficha se hizo leyendo el **código publicado** de los paquetes (descargados con `npm pack` en una carpeta temporal), no solo su web.

## Qué es LlamaIndex, en sencillo

Es una caja de herramientas para que un modelo de lenguaje trabaje con **tus** datos. Resuelve cinco cosas:

| Pieza | Qué hace | Ejemplo en nuestra API |
| --- | --- | --- |
| **Documentos y nodos** | Convierte tus datos en trozos de texto con metadatos (de dónde salen). | Una fila de la hoja «Zapatillas rojas, 59,90 €, SKU 0042» con `{organización, proyecto, hoja, revisión, fila}`. |
| **Ingesta** (`IngestionPipeline`) | Trocea, calcula embeddings y guarda en Qdrant; con estrategia *upsert* solo recalcula lo que cambió (hash por documento). | Al aplicar una revisión, reindexar solo las filas cambiadas. |
| **Índice y recuperador** (`VectorStoreIndex`, `asRetriever`) | Busca los trozos más parecidos a una pregunta, con filtros por metadatos. | «¿Qué productos de running tienen el precio mal?» → filas relevantes del proyecto. |
| **Motores** (consulta, chat, sub-preguntas, router) | Junta lo recuperado y pide al modelo una respuesta con citas. | Responder sobre el catálogo citando hoja, fila y revisión. |
| **Agente y herramientas** (`agent`, `tool`), **memoria** (`createMemory`) y **evaluación** (Faithfulness, Relevancy, Correctness) | El modelo decide qué herramienta llamar; la memoria lleva la conversación; los evaluadores puntúan si la respuesta se apoya en los datos. | Herramientas `query_rows`, `get_evaluation_report`, `create_change_proposal`; dataset de E6.5. |

Extras: extractores con el modelo (título, palabras clave, preguntas que responde un trozo), reranking, `ObjectIndex` (elegir herramientas por búsqueda cuando hay muchas) y `mcpTool` (envolver un flujo como herramienta MCP).

## Lo que encontré al leer su código

| ID | Hallazgo | Consecuencia para nosotros |
| --- | --- | --- |
| R1 | **LlamaIndex.TS está abandonado.** npm marca `@llamaindex/core`, `@llamaindex/qdrant` y `@llamaindex/workflow` como «This package is deprecated and no longer maintained»; `@llamaindex/workflow-core` dice «Please use LlamaAgents (Python Workflows) instead». La API de GitHub da `archived: true` para `run-llama/LlamaIndexTS` (último *push* 2026-03-11) y `run-llama/workflows-ts`. El README: «This project is deprecated and no longer maintained.» | Sin parches de seguridad ni compatibilidad con SDK nuevos. No es una base para un SaaS. |
| R2 | El conector de Claude (`@llamaindex/anthropic` 0.3.27) usa `@anthropic-ai/sdk` 0.58.0 y solo conoce modelos hasta Sonnet 4.5. | Quedaría congelado con un SDK antiguo. |
| R3 | `VectorIndexRetriever._retrieve` guarda cada nodo devuelto en `index.indexStruct.nodesDict` y nunca lo vacía. | Un índice compartido en el servidor crece en memoria con cada búsqueda: habría que crear uno por petición. |
| R4 | El retriever llama a `vectorStore.query(…)` **sin** opciones, así que el filtro forzado `qdrant_filters` de `QdrantVectorStore` no se puede usar desde él; los `MetadataFilters` del conector de Qdrant traducen `==`, `<`, `>`, `>=`, pero no «proyecto en esta lista». | El filtro de empresa y proyectos visibles tendría que ponerlo una pieza nuestra envolviendo el almacén. |
| R5 | `QdrantVectorStore` crea la colección al primer `add` con un vector sin nombre y `Cosine`, y guarda el nodo serializado en el payload. | Los índices de payload (`organization_id` con `is_tenant`) los tendríamos que crear nosotros igualmente. |
| R6 | La versión **Python** sí está viva: `llama-index-core` 0.14.25 (2026-09-21), `llama-index-vector-stores-qdrant` 0.10.4 (2026-10-08), `llama-index-llms-anthropic` 0.12.3 (2026-10-12) en PyPI. | Usar LlamaIndex de verdad implica un servicio en Python. |
| R7 | En TypeScript, la alternativa mantenida con las mismas piezas es LangChain.js: `@langchain/core` 1.3.5 (2026-11-05), `@langchain/qdrant` 1.0.3 (2026-06-17), `@langchain/langgraph` 1.7.2 (2026-11-07), `@langchain/anthropic` 1.6.1 (2026-11-07), `@langchain/mcp-adapters` 2.0.2 (2026-11-02). `@langchain/community` sí está obsoleto, pero no hace falta. | Mismo recorrido (documentos → trozos → embeddings → Qdrant → recuperador → agente con herramientas → memoria → MCP) dentro de Nest. Tus cursos «Agentes con LangChain y LangGraph», «LangGraph y Agentes» y «RAG Multimodal y Agéntico» (LangChain v1) explican estas piezas, aunque en Python. |

## Opciones

| Opción | A favor | En contra |
| --- | --- | --- |
| **A. LangChain.js + LangGraph.js dentro de Nest** (recomendada) | Mantenido; un solo backend, como dice la visión («sin un segundo backend»); los permisos y servicios de Nest se usan directamente en las herramientas; Qdrant, Claude y MCP con paquetes oficiales; cursos locales del mismo framework. | No es LlamaIndex: cambia el nombre de las piezas, no la idea. |
| **B. LlamaIndex en Python como servicio de IA aparte** | Es LlamaIndex, mantenido y con su ecosistema completo (incluido Qdrant híbrido). | Segundo backend que la visión descarta; otro despliegue en Cloud Run; Nest sigue siendo la puerta y el servicio Python tendría que pedirle a Nest cada dato con la identidad de la persona; más piezas que probar. |
| **C. LlamaIndex.TS aunque esté abandonado** | Lo pedido al pie de la letra. | R1–R4: sin parches, SDK de Claude antiguo, fuga de memoria y filtro de seguridad a mano. No recomendable. |
| **D. Sin framework**: SDK de Qdrant, de Claude y de MCP | Menos dependencias y control total. | Más código propio (trocear, memoria, bucle de herramientas, evaluación). |

## Lo que no cambia con ninguna opción

V1 (visor del feed) y E6.0 (Qdrant de desarrollo, cliente oficial, configuración, estado en `health` y el filtro de organización) no dependen del framework: se construyen igual. La forma de la colección (nombre del vector, dimensiones y payload) se fija en E6.1, cuando se sepa qué framework y qué embedding la usan.
