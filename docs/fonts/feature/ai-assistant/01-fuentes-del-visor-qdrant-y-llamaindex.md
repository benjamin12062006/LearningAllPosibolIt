# 01 — Fuentes del visor del feed, Qdrant y LlamaIndex (V1 y E6)

Fecha de creación: 2026-11-09  
Última actualización: 2026-11-09  
Estado: Cerrada para V1. Ajustada el 2026-11-09 por la revisión 02. Las etapas E6.1–E6.7 añaden su propia ficha cuando necesiten fuentes nuevas.  
Relacionada con: [plan E6](../../../plans/feature/ai-assistant/01-plan-e6-ia-con-qdrant-y-llamaindex.md), [ampliación de la visión](../../../../../docs-diagrams/fuentes/2026-11-09-ampliacion-visor-qdrant-llamaindex.md), [15, chat e IA](../../../../../docs-diagrams/15-chat-ia-herramientas-y-propuestas.md), [18, entregas](../../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md).  
Revisión de partida: `feature/cierre-backend` `b219b30`.

## Estado real del código (hallazgos E)

| ID | Hallazgo | Dónde |
| --- | --- | --- |
| E1 | El TSV se construye solo con las filas válidas de la evaluación, en el orden de `source_row`; la cabecera es `id`, los opcionales con algún valor y los obligatorios. Ninguna celda lleva tabulador, salto de línea ni comilla inicial (se lanza error antes). | `src/exports/products-tsv.ts` |
| E2 | La descarga privada (`GET …/exports/:id/productos.tsv`) y la URL pública del feed devuelven el archivo entero; no hay lectura en JSON ni paginada. | `exports.controller.ts`, `feed-delivery.service.ts` |
| E3 | Las versiones del feed guardan `export_id` y `evaluation_id` (nulos si se borró la importación de origen) y su propio archivo en `feeds/` (enlace duro). La retención puede retirar el archivo (`artifact_key` nulo, `fileRetained: false`). | `feeds.types.ts`, `feeds.repository.ts`, `artifact.store.ts` |
| E4 | `GET …/evaluations/:id/rows?outcome=valid|invalid|excluded` ya devuelve, paginado, cada producto con sus valores y sus problemas en es/en. Sirve para la pestaña de «diagnóstico» del visor mientras la importación exista. | `evaluations.controller.ts` |
| E5 | El acceso de lectura es `projectsService.requireAccess(identity, projectId, 'organization.read')`: 404 si no es miembro. | `projects/project-access.ts` (C6) |
| E6 | No hay dependencias de IA ni de Qdrant en la API (`package.json`); la palabra «cohere» aparece solo como texto en reglas. | `package.json`, `grep` |
| E7 | En OrbStack hay imagen `qdrant/qdrant:v1.19.1` y un contenedor `backend-qdrant` de **otro** proyecto (volumen `backend_qdrant_data`, puertos 6333/6334 abiertos a todas las interfaces). No se reutiliza. | `docker ps -a`, `docker inspect` |
| E8 | Los contenedores de pruebas siguen un patrón: script que arranca uno con `--cpus 2 --memory 1g` en `127.0.0.1`, ejecuta y lo para siempre. | `scripts/testing/postgres-features.mjs` |
| E9 | `HealthModule` informa de la base y de la cola; no conoce servicios opcionales. | `src/health/` |

## Requisitos (H)

| ID | Requisito | Origen |
| --- | --- | --- |
| H1 | Ver dentro de la web lo que se exporta y lo que se publica: productos, columnas y valores tal cual van al canal. | Ampliación 2026-11-09, punto 1 |
| H2 | Qdrant de desarrollo con la imagen ya descargada, configurado en la API y con su módulo Nest. | Punto 2 |
| H3 | El agente conoce todo lo guardado (hojas, importaciones, catálogo, reglas, evaluaciones, feed) y responde con datos reales del usuario. | Punto 3 |
| H4 | Construir la IA con LlamaIndex y que funcione con este Qdrant. | Punto 4 |
| H5 | Nunca datos de otra organización; el modelo no aprueba, aplica ni publica; todo funciona sin IA. | 15, 8.3 de la visión, T02, T18–T22 |
| H6 | No saturar el portátil: un contenedor con límites, Jest en serie, parar al terminar. | Memoria del usuario (2026-11-07) |

## Cursos locales (C)

Rutas relativas a `/Users/benji/Documents/chrome-extencions/trancripciones/`.

| ID | Lección | Qué aporta |
| --- | --- | --- |
| C1 | `Python/Evaluación y Optimización de RAG/Sección 5 …/56. Establish FTS BASELINE.md`, línea 13 | Medir primero con búsqueda de texto: «Bm25 is been around for 20 for 30 years or more» y sigue siendo la referencia. Justifica tener una lectura exacta (SQL, filtros) además de la semántica. |
| C2 | `Python/Aplicaciones GenAI y Sistemas Multiagente/Sección 14 …/154. Ranking, Sparse, Dense & Ensemble Retrievers.md`, línea 23 | Los recuperadores por palabras encuentran claves (SKU, códigos) y los densos el significado; se combinan. Por eso las herramientas exactas (`query_rows`, filtros) conviven con `search_knowledge`. |
| C3 | `Angular/Angular OpenAI con NestJS/Sección 15 Backend - Asistentes de OpenAI/134–138` | Módulo propio para el asistente en Nest (134, línea 13: «una funcionalidad totalmente independiente»), casos de uso separados para thread, mensaje y run, y comprobar el estado del run sin «bombardear» al proveedor (138, línea 15). Base de conversaciones/mensajes/runs de E6.2–E6.4. |
| C4 | `IA/Agentes y Automatización con IA/Sección 12 …/122, 123 y 126` | Herramientas propias con descripción clara, un servidor MCP como punto de entrada para otros clientes (123, línea 17) y autenticación por cabecera (126, línea 19). Base de D10 (forma MCP y etapa opcional). |
| C5 | `Python/Aplicaciones GenAI y Sistemas Multiagente/Sección 16 Model Context Protocol (MCP)/179–180` | Servidor MCP y sus transportes; referencia para E6.7. |
| C6 | `Python/Agentes con LangChain y LangGraph/Sección 9 …/42–49` | Recorrido de RAG: cargar, trocear, embeber, guardar y recuperar en dos pasos. Mismo esquema que LlamaIndex (documentos → nodos → índice → recuperador). |

Ninguna lección usa Qdrant con TypeScript ni LlamaIndex.TS: para eso manda la documentación oficial (F).

## Documentación oficial y registros (F)

| ID | Fuente | Qué se toma |
| --- | --- | --- |
| F1 | Qdrant, *Multitenancy* (`qdrant.tech/documentation/guides/multiple-partitions/`), consultado 2026-11-09 | Una sola colección con partición por payload; índice `keyword` con `"is_tenant": true` (desde 1.11) y filtrar **cada** consulta por el inquilino. «Creating a separate collection for each tenant is rarely the most efficient approach.» |
| F2 | Qdrant, *Full-text search*, sección BM25, consultado 2026-11-09 | BM25 sobre el índice de texto (`"scoring": true`, consulta `{"text": …}`), sin embeddings; stemmer y stopwords en español. |
| F3 | Qdrant, *Releases* (GitHub), consultado 2026-11-09 | El BM25 de F2 llega en **v1.20.0** (22 oct.). La imagen local es 1.19.1. |
| F4 | npm, `@qdrant/js-client-rest` (Apache-2.0): 1.19.0 publicada 2026-08-04, 1.20.0 el 2026-10-22 | Cliente REST oficial; se fija la versión menor del servidor (1.19.0). |
| F5 | npm, LlamaIndex.TS (MIT): `@llamaindex/core` 0.6.23, `@llamaindex/qdrant` 0.1.33, `@llamaindex/workflow` 1.1.25 (2026-03-09); `llamaindex` 0.12.1 (2025-12-02) | El paquete agregado `llamaindex` fija `@llamaindex/core` 0.6.22 mientras los paquetes sueltos piden 0.6.23 como *peer*: se instalan los paquetes sueltos. `@llamaindex/qdrant` depende de `@qdrant/js-client-rest ^1.14.0`. |
| F6 | LlamaIndex.TS, *Qdrant vector store* (`developers.llamaindex.ai/typescript/…/qdrant/`) y el código publicado de `@llamaindex/qdrant` 0.1.33 | `new QdrantVectorStore({ client, collectionName, embeddingModel })` acepta un cliente propio; `query(…, { qdrant_filters })` usa el filtro que se le da **en lugar** del calculado. Crea la colección con un vector denso `Cosine` al primer `add` si no existe. |
| F7 | Código publicado de `@llamaindex/workflow` 1.1.25 y `@llamaindex/core` 0.6.23 | `agent({ llm, tools })` (FunctionAgent) con eventos `agentToolCallEvent`/`agentStreamEvent`; herramientas con esquema; `@llamaindex/core/llms/mock` para un proveedor simulado. |
| F8 | Código publicado de `@llamaindex/anthropic` 0.3.27 | Usa `@anthropic-ai/sdk` 0.58.0 y solo conoce modelos hasta Sonnet 4.5. Para un modelo actual habrá que evaluarlo frente a un adaptador propio (E6.5). |

## Medición (M)

| ID | Prueba | Resultado |
| --- | --- | --- |
| M1 | Contenedor `qdrant/qdrant:v1.19.1` temporal (2 CPU, 1 GiB, 127.0.0.1:56333): colección sin vectores, índice de texto con `scoring`, índice `is_tenant`, tres puntos de dos organizaciones y consulta `{"text": …}` | Colección e índices: `ok`. Consulta: `Format error in JSON body: Expected some form of vector, id, or a type of query`. Confirma F3: BM25 sobre texto no existe en 1.19.1. |

## Mapa necesidad → requisito → fuentes → decisión

*Ajustado el 2026-11-09:* tras la [revisión 02](02-revision-de-llamaindex-para-la-api.md) (LlamaIndex.TS abandonado), el usuario eligió LlamaIndex en Python como servicio aparte. F5–F8 quedan como evidencia de por qué no se usa la versión TypeScript. Las decisiones son las del [plan 01](../../../plans/feature/ai-assistant/01-plan-e6-ia-con-qdrant-y-llamaindex.md).

| Necesidad | Requisito | Fuentes | Decisión |
| --- | --- | --- | --- |
| Ver el TSV en la web | H1 | E1–E5 | D1: lectura JSON paginada del TSV real |
| LlamaIndex mantenido | H4 | F5–F8, revisión 02 | D2: servicio Python |
| Qdrant de desarrollo | H2, H6 | E7, E8, M1 | D3 |
| Una colección para todas las empresas | H3, H5 | F1 | D4 |
| Búsqueda por palabras y por significado sin proveedor | H3 | C1, C2, F2, F3, M1, revisión 02 | D5: híbrida con FastEmbed |
| Agente con datos reales y sin poder aprobar | H3, H5 | C3, C4, 15 | D6–D9 |
| «MCP» | H3 | C4, C5 | D9 (forma MCP) y E6.7 |
