# 02 — E6.1b.1: Nest manda el conocimiento al servicio de IA

Fecha de creación: 2026-11-09  
Última actualización: 2026-11-12  
Estado: Implementado y verificado el 2026-11-12. Migración 31 aplicada en Cloud SQL y confirmada por Prisma.  
Relacionada con: [plan E6](../../../docs/plans/feature/ai-assistant/01-plan-e6-ia-con-qdrant-y-llamaindex.md) (D14–D18), [ficha 03](../../../docs/fonts/feature/ai-assistant/03-fuentes-de-indexar-el-conocimiento.md), [bitácora 02 del servicio de IA](../../../../claudeLearningAllPosibolIt-ai/bitacora-construccion/feature/base-del-servicio/02-indexar-el-conocimiento.md).

## Necesidad

El servicio de IA ya sabe guardar y buscar (E6.1a), pero nadie le manda los datos. Nest tiene que convertir lo que cada proyecto tiene (configuración, catálogo, evaluación, reglas y feed) en documentos y mantenerlos al día sin tocar los módulos existentes.

## Avance (2026-11-09, pausado a petición del usuario el 2026-11-11)

**Implementado** con `tsc` y `pnpm lint` limpios:

| Archivo | Qué hace |
| --- | --- |
| `prisma/migrations/20261109100000_create_knowledge_sync_state/migration.sql` + modelo `KnowledgeSyncState` en `schema.prisma` | Tabla de estado sin clave foránea (D16). Añadida a `test/prisma-migrations.test.mjs`; el conteo de `projects.repository.int-spec.ts` pasa de 30 a 31. **Aplicada en Cloud SQL el 2026-11-12.** |
| `src/knowledge/knowledge.types.ts` | Tipos de fuente, documento, clave, opciones (pasada cada 30 s). |
| `src/knowledge/ai-service.client.ts`, `ai-service-config.ts` | Cliente HTTP con token, `X-Request-Id` y plazo de 180 s; 5xx/red → «no disponible», 4xx → «rechazado». Sin `AI_SERVICE_URL`, desactivado; con URL y token corto, la API no arranca. |
| `src/knowledge/knowledge.repository.ts` | Huellas de las fuentes `project`, `catalog`, `evaluation`, `ruleset` y `feed` con `md5(json_build_array(…))`; estado guardado; lecturas de cada fuente (sin URL de la fuente del feed ni token). |
| `src/knowledge/knowledge-documents.ts` | Textos en español por fuente; ficha por producto (catálogo + última evaluación + feed); ids largos con SHA-256; recortes a los límites del servicio. |
| `src/knowledge/sync-plan.ts` | Qué cambió, qué sobra y qué proyectos ya no existen (función pura). |
| `src/knowledge/source-documents.ts`, `knowledge-sync.worker.ts` | Reconciliador con `WorkerLoop`: borra primero, después reemplaza; guarda la huella solo si el servicio confirmó; para si el servicio cae; un 4xx se registra y se sigue. |
| `src/knowledge/knowledge.service.ts`, `knowledge.controller.ts`, `knowledge.module.ts` | `GET /projects/:id/knowledge` (miembro) y `POST /projects/:id/knowledge/reindex` (Manager+, 202; 503 `KNOWLEDGE_DISABLED` si está desactivado). Registrado en `AppModule`. |
| `.env.example` | `AI_SERVICE_URL` y `AI_SERVICE_TOKEN` vacíos. El `.env` real **no** se tocó: activarlo empezaría a mandar a Google los datos de Cloud SQL. |

**Pruebas hechas:** unitarias `test/features/knowledge/` (plan de sincronización, documentos, cliente HTTP y configuración): **20 de 20**.

## Cierre (2026-11-12)

Retomada con el [plan 02 de cierre](../../../docs/plans/feature/cierre-backend/02-plan-terminar-hojas-visor-y-agente.md) (paso P1). No hizo falta cambiar el código del módulo: lo que faltaba eran las pruebas de recorrido y la verificación.

### Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| Ficha 03: cada fuente tiene una huella barata de calcular | Reconciliador que compara huellas y manda solo lo que cambió (D15) | [`knowledge-sync.worker.ts`](../../../src/knowledge/knowledge-sync.worker.ts), [`sync-plan.ts`](../../../src/knowledge/sync-plan.ts), `currentSourcesOf` en [`knowledge.repository.ts`](../../../src/knowledge/knowledge.repository.ts) |
| Bitácora 02 del servicio: reemplazar una fuente es idempotente por hash | Sin bloqueo entre instancias; la huella se guarda solo si el servicio confirmó | `KnowledgeSyncWorker.replace` |
| D16: sin clave foránea a `projects` | Un proyecto sin ninguna fuente actual es un proyecto borrado: se retira entero | `planSync`, `forgetProject` |
| 15 y C6: reindexar gasta llamadas a Google | `POST …/knowledge/reindex` pide Manager; el estado lo lee cualquier miembro | [`knowledge.service.ts`](../../../src/knowledge/knowledge.service.ts) |
| D18: textos sin datos personales | La consulta del feed no lee la URL de la fuente ni el token | `findFeedFacts`, [`knowledge-documents.ts`](../../../src/knowledge/knowledge-documents.ts) |

### Pruebas añadidas

[`knowledge.e2e-spec.ts`](../../../test/features/knowledge/knowledge.e2e-spec.ts): 17 pruebas con los módulos reales sobre PGlite y un servicio de IA de mentira (`FakeAiService`) que anota lo recibido y puede caerse o rechazar una fuente. Una segunda aplicación sin cliente de IA prueba el modo desactivado.

- Recorrido completo (reglas → catálogo → evaluación → exportación → feed publicado): una pasada manda las cinco fuentes y el estado queda al día.
- La ficha de cada producto junta catálogo, evaluación y feed (válido y en el feed; inválido con su problema; excluido).
- Una evaluación en cola no borra de la ficha el resultado de la última terminada. *Añadida al ver que el defecto 15 no se detectaba.*
- No viajan correos, tokens de entrega ni la URL pública.
- Sin cambios, cero envíos; una evaluación nueva manda solo `catalog` y `evaluation`.
- Servicio caído: la pasada para, no guarda huellas y la siguiente lo manda todo. Fuente rechazada (4xx): sigue con las demás y esa queda pendiente; el registro no lleva contenido.
- Proyecto borrado: `removeProject` y estado olvidado; si el servicio cae al borrar, se reintenta. Catálogo borrado: solo se retira esa fuente.
- Dos organizaciones (T18b): cada documento viaja con la organización de su proyecto y nada de una entra en lo de la otra.
- Rutas: estado para cualquier miembro (todo pendiente antes de la primera pasada); reindexar Viewer y Editor 403, Manager 202 y manda el proyecto entero sin tocar los demás; ajeno 404; sin sesión 401; id mal formado 400; desactivado: `enabled: false` y 503 `KNOWLEDGE_DISABLED`.

### Comprobaciones realmente ejecutadas (2026-11-12)

- **Pruebas del conocimiento:** 37 de 37 (20 unitarias y 17 E2E).
- **Defectos a propósito** (copia del repositorio, uno cada vez, recompilando): **15 de 15 detectados.** El 15 no se detectó al principio y motivó una prueba nueva.

  | Id | Defecto | Detectado |
  | --- | --- | --- |
  | K1 | La huella del catálogo no incluye la evaluación | Sí |
  | K2 | Guardar la huella aunque el servicio rechace la fuente | Sí |
  | K3 | No olvidar el proyecto borrado | Sí |
  | K4 | No detectar proyectos borrados | Sí |
  | K5 | «En el feed» sin exigir resultado válido | Sí |
  | K6 | Reindexar con permiso de lectura | Sí |
  | K7 | Reindexar sin olvidar el estado | Sí |
  | K8 | Reindexar aunque esté desactivado | Sí |
  | K9 | Estado nunca pendiente | Sí |
  | K10 | Organización equivocada en la clave | Sí |
  | K11 | No retirar la fuente que desapareció | Sí |
  | K12 | El servicio caído no interrumpe la pasada | Sí |
  | K13 | Huella guardada antes de que el servicio confirme | Sí |
  | K14 | Mandar todo en cada pasada | Sí |
  | K15 | Usar en la ficha una evaluación sin terminar | Sí, con la prueba añadida |

- **`tsc`, `pnpm lint` y Prettier:** limpios.
- **Esquema frente a las 31 migraciones** (PGlite como sombra, `prisma migrate diff`): «This is an empty migration».
- **Batería completa:** 98 suites pasan (1 saltada) y 1.581 pruebas (5 saltadas).
- **Arranque real de la API:** módulo raíz completo sobre PGlite con los procesos de fondo encendidos y un servicio de IA de mentira que escucha por HTTP. El reconciliador mandó `project` y `feed` con el token y `X-Request-Id`, no repitió en la pasada siguiente, el estado quedó `pending: false`, el apagado terminó y no se registró ningún error.

- **Verificación de la base:** se aplicó la migración 31 mediante el proxy de Cloud SQL. `prisma migrate status` confirmó las 31 migraciones al día. En una copia aislada, las tres pruebas de `db:verify` pasaron con PGlite.

### No ejecutado

- **Los dos servicios reales a la vez** (Qdrant y Vertex AI): queda para el cierre de E6.1b.2, cuando también estén las fuentes de hojas; así se gasta una sola vez en embeddings.

## Consecuencias

- Con `AI_SERVICE_URL` y `AI_SERVICE_TOKEN` en el `.env`, la API empieza a mandar al servicio de IA lo que tiene cada proyecto. Sin ellas, funciona igual que antes.
- Las fuentes de hojas (`worksheet`, `workbook`, `changeset`, `worksheet_import`) y `organization` llegan en E6.1b.2.
