# 01 — Revisar una evaluación y exportar su TSV para Merchant Center

Fecha de creación: 2026-11-01  
Última actualización: 2026-11-01 (E1 implementada con ajustes marcados «en E1»); 2026-11-01 (E2 implementada con ajustes marcados «en E2»); 2026-11-01 (E3 implementada con ajustes marcados «en E3»); 2026-11-01 (E4 implementada con ajustes marcados «en E4»); 2026-11-02 (E5 implementada con ajustes marcados «en E5»); 2026-11-02 (E6 implementada con ajustes marcados «en E6»); 2026-11-02 (E7: diagramas actualizados; plan cerrado)  
Estado: E1–E7 implementadas y verificadas en local ([bitácora 01](../../../../bitacora-construccion/feature/reviews&exports/01-serializador-tsv.md), [02](../../../../bitacora-construccion/feature/reviews&exports/02-comprobar-la-aprobacion.md), [03](../../../../bitacora-construccion/feature/reviews&exports/03-perfil-de-google-v2026-11-01.md), [04](../../../../bitacora-construccion/feature/reviews&exports/04-modulo-de-artefactos.md), [05](../../../../bitacora-construccion/feature/reviews&exports/05-exportar.md), [06](../../../../bitacora-construccion/feature/reviews&exports/06-descarga-borrados-y-limpieza.md), [07](../../../../bitacora-construccion/feature/reviews&exports/07-cierre-documental.md)). Plan cerrado. La migración de E5 se aplicó en Neon el 2026-11-02 (`pnpm db:status` → «Database schema is up to date!»). Pendiente: procesar el TSV en la cuenta piloto (D14).  
Ámbito: incremento 3 de `docs-diagrams` (revisión y exportación TSV): RF05/UC05 e invariantes 1, 3, 4 y 5. Solo backend.  
Relacionada con: [estado real](../../../fonts/feature/reviews&exports/01-estado-real-y-antecedentes.md), [fuentes técnicas](../../../fonts/feature/reviews&exports/02-fuentes-tecnicas.md), [cursos y reconstrucciones](../../../fonts/feature/reviews&exports/03-cursos-y-reconstrucciones.md), [mapa de necesidades](../../../fonts/feature/reviews&exports/04-mapa-de-necesidades-para-el-plan.md), [plan anterior](../rulesets&evaluations/01-plan-rulesets-y-evaluations.md) (D8, D9, D14), [actividad de revisión](../../../../../docs-diagrams/05-analisis-y-requisitos.md), [publicación consistente](../../../../../docs-diagrams/08-secuencias-y-estados.md).  
Revisión de referencia: `d5e8f54` en `main`, árbol limpio salvo `.idea/dataSources.xml`.

## Objetivo

Un operador revisa una evaluación terminada (conteos, filas inválidas y excluidas, `errores.csv`), confirma lo que vio y obtiene `productos.tsv` como **descarga privada**. El incremento está completo cuando se cumplen estas condiciones:

1. Solo se exporta una evaluación `succeeded`, vigente y con al menos un producto válido. Sin válidos, la exportación se bloquea. [F1]
2. La aprobación identifica la evaluación, su suma de comprobación y las exclusiones aceptadas. Si lo enviado no coincide con lo guardado, no se exporta. [F4, RC4]
3. Ninguna fila inválida ni excluida llega al TSV, y ningún valor del TSV contiene tabuladores ni saltos de línea. [F2 inv. 3, F18, F21]
4. El TSV se escribe, se finaliza y se verifica antes de la transacción que lo referencia; un fallo deja como mucho un archivo huérfano que la limpieza retira. [F2 inv. 5, C10]
5. Un propietario no ve ni exporta evaluaciones de otro: recibe `404`.

Queda fuera la fase B (URL estable, `feed`, `feed_version`, `published_version`, publicaciones, `/feeds/{token}.tsv`), GraphQL y el frontend. Detalle en «Límites y continuidad».

## Punto de partida

Disponible ([ficha 01](../../../fonts/feature/reviews&exports/01-estado-real-y-antecedentes.md)):

- Evaluaciones inmutables con conteos, `result_checksum`, `engine_version` y `profile_version`; `evaluation_rows` con `outcome` y `product_values` normalizados (F7, F8, F9).
- `GET …/evaluations/:evaluationId` ya devuelve estado, versiones, conteos y `resultChecksum`; `…/rows?outcome=` y `errores.csv` ya muestran inválidas y excluidas.
- `ArtifactStore` privado de `catalog-import`, que solo admite `<uuid>.csv` y cuya limpieza borra todo lo que no referencie un snapshot (F10, F11, F12).
- Patrón de descarga con `StreamableFile` (F13).

Restricciones encontradas al planificar:

- **R1 — Valores no exportables.** Un `title`, `description`, `brand` o `id` puede contener hoy `\t`, `\n` o `\r` si ninguna regla lo limpia (ficha 01, hallazgo 1). Google y la IANA no los admiten sin comillas (F18, F21).
- **R2 — Errores de stream en Express.** Si el archivo falla al abrirse después de devolver el `StreamableFile`, Nest responde `400` (F22, «Stream errors»), que no describe el problema. El archivo debe abrirse antes de devolverlo.
- **R3 — Evaluaciones ya guardadas en Neon.** Cualquier cambio del perfil (D5) deja las evaluaciones anteriores con otra `profile_version`; habrá que reevaluar para exportar. Desde E3 también tienen otra `engine_version`.

## Decisiones

Cada `D` resuelve la `N` del mismo número de la [ficha 04](../../../fonts/feature/reviews&exports/04-mapa-de-necesidades-para-el-plan.md).

### D1 — Qué evaluación se puede exportar

En la misma transacción que crea la exportación (D7), con la evaluación leída bajo el proyecto propio:

| Comprobación | Respuesta si falla |
| --- | --- |
| La evaluación existe y es del proyecto del propietario | `404 EVALUATION_NOT_FOUND` (código existente) |
| `status = 'succeeded'` | `409 EVALUATION_RESULTS_UNAVAILABLE` (código existente) |
| `valid_count > 0` | `409 EXPORT_NO_VALID_PRODUCTS` |

El proyecto ajeno o inexistente responde `404 PROJECT_NOT_FOUND`, como en las features anteriores. [F1, F3, F7, F16]

### D2 — La aprobación: lo que vio el operador, recalculado por el servidor

Body de `POST /projects/:projectId/exports`:

```json
{
  "evaluationId": "uuid",
  "resultChecksum": "64 hex",
  "acceptedInvalidCount": 3,
  "acceptedExcludedCount": 1
}
```

- Los cuatro campos son obligatorios, también cuando los conteos son 0: confirmar es explícito (F1 «confirmar expresamente»).
- El servidor compara con la evaluación guardada: `resultChecksum = result_checksum`, `acceptedInvalidCount = invalid_count` y `acceptedExcludedCount = excluded_count`. Cualquier diferencia → `409 EXPORT_APPROVAL_MISMATCH`. Es el principio de RC4 (l. 25): lo que decide el resultado se toma de la fuente, no de lo que manda el cliente.
- **No hay tabla de exclusiones aceptadas.** `result_checksum` resume, fila a fila por `source_row`, el resultado de cada producto (F9), y `evaluation_rows` es inmutable (F7). Guardar la suma aprobada y los conteos identifica exactamente qué filas se excluyeron; una tabla hija repetiría esa información. Así se cumple F6 («solo las tablas necesarias»). Se descarta la escritura anidada de RC4/RC5 por no haber hijos.
- Los valores salen del `GET` de la evaluación, que ya los devuelve: no hace falta un recurso de revisión nuevo (D12).

### D3 — Vigencia: aprobar una evaluación no aprueba otra

Una evaluación está vigente si se cumplen las tres condiciones:

1. Su `profile_version` y su `engine_version` son las actuales (`PROFILE_VERSION`, `ENGINE_VERSION`). Si no → `409 EXPORT_EVALUATION_OUTDATED`. Las reglas con las que se juzgó cada fila deben ser las que hoy garantizan un TSV válido (D5, R3).
2. No existe en el proyecto otra evaluación más reciente (`created_at`, `id`) con estado `queued`, `running` o `succeeded`. Si existe → `409 EXPORT_EVALUATION_SUPERSEDED`. Responde a la rama «¿Sigue vigente la evaluación? No → nueva versión y reevaluar» de la actividad de revisión (F1): si el operador corrigió datos o reglas y volvió a evaluar, la anterior ya no representa lo revisado. Una evaluación posterior `failed` no reemplaza a nadie.
3. La aprobación coincide (D2).

Ajustado en E2: si fallan varias, se devuelve el primer motivo en este orden: sin resultados (D1) → desactualizada (D3.1) → reemplazada (D3.2) → sin válidos (D1) → aprobación distinta (D2). Va de lo que impide exportar esa evaluación pase lo que pase a lo que el cliente arregla volviendo a leerla. «Hay una evaluación posterior» llega como propiedad de la evaluación (`hasNewerEvaluation`), calculada en la misma consulta que la lee.

La evaluación se lee con `FOR SHARE` y su snapshot también: `deleteSnapshot` los bloquea con `FOR UPDATE`, así que una operación espera a la otra. PGlite no lo demuestra (una sola conexión); queda respaldado por la FK compuesta y la cascada (D11). [F2 inv. 4, F14]

### D4 — Serializador TSV puro

Función pura `buildProductsTsv(rows)` en `src/exports/products-tsv.ts`, sin Nest, Prisma ni disco (RC3: cada documento es una función que recibe datos). Recibe solo filas `valid` en orden de `source_row`.

- **Columnas.** `id` (de `external_id`) más los atributos de `PRODUCT_ATTRIBUTES` con al menos un valor no vacío en las filas exportadas. Los obligatorios siempre tienen valor en una fila válida (F8), así que siempre aparecen. Nombres en inglés con guion bajo, como pide Google. [F20]
- **Orden de columnas:** `id`, luego los opcionales presentes (`condition`, `brand`) y por último los obligatorios en su orden (`title`, `description`, `link`, `image_link`, `price`, `availability`). Así la última celda de cada línea nunca está vacía y ninguna línea acaba en tabulador, que F18 prohíbe; a la vez todas las líneas tienen el mismo número de campos, que exige F21. Google lee por el nombre de la cabecera, no por la posición (F17, paso 2). *Propuesta propia.*
- **Celdas vacías** permitidas para opcionales sin valor. [F17]
- **Separador** `\t`; **fin de línea** `\n`, también tras la última línea. IANA no fija el terminador; se elige el de Unix y se comprobará en la cuenta piloto (D14). *Propuesta propia.*
- **UTF-8 sin BOM.** F17 admite UTF-8 y no menciona el BOM; un BOM podría quedar pegado al primer nombre de columna (`id`) si el lector no lo quita. El BOM de `errores.csv` sigue, porque ese archivo es para Excel (F27). *Propuesta propia.*
- **Sin comillas ni escape.** D5 garantiza que ningún valor necesita escape; el serializador lo comprueba y lanza un error interno si encuentra un carácter prohibido (invariante, no error del usuario). No se reutiliza la mitigación OWASP: cambiaría el valor (F26).
- Devuelve `{ content: Buffer, rowCount }`. La suma SHA-256 y el tamaño se calculan sobre esos bytes (D6).
- Ajustado en E1:
  - también lanza un error interno con una lista vacía o con un obligatorio vacío, porque los dos indicarían un error del backend;
  - un opcional que solo tiene espacios en todas las filas no crea columna (`isBlank`); si la columna existe por otra fila, el valor se escribe tal cual.
- Ajustado en E3: un opcional vacío o de solo espacios se escribe como celda vacía. Escribirlo tal cual rompía el TSV con un `brand: '\t'`, que el perfil no informa porque el valor está vacío.

### D5 — Valores no exportables: problema del perfil, no escape del TSV

Se descartan las otras dos opciones de la ficha 04:

- **Entrecomillar (F19):** depende de que la fuente del cliente tenga activados los campos entrecomillados, y no está documentado qué hace Google con un valor que empieza por comilla.
- **Rechazar al exportar:** el operador se enteraría al final, sin la fila en el informe ni una corrección sugerida.

Decisión: el perfil marca esos valores como problema, de modo que la fila es **inválida**, aparece en el informe y en `errores.csv`, y nunca llega al TSV.

- Nuevos `ProblemCode` en [google-merchant.profile.ts](../../../../src/evaluations/engine/google-merchant.profile.ts):
  - `TEXT_HAS_LINE_BREAK` — el valor contiene tabulador o salto de línea: `\t`, `\n`, `\r`, `\v`, `\f`, U+0085, U+2028 o U+2029. Google habla de «line breaks» sin enumerarlos; la lista amplia es *propuesta propia*, para no depender de cómo los interprete.
  - `TEXT_STARTS_WITH_QUOTE` — el valor empieza por `"`. Evita la ambigüedad con los campos entrecomillados de F19 en los dos modos de la fuente. Es raro en un catálogo; la sugerencia indica quitar la comilla inicial.
- Se comprueban en `id` (sobre `external_id`), `title`, `description` y `brand`. Los enlaces ya se rechazan si tienen espacios en blanco; `price`, `availability` y `condition` solo admiten valores cerrados.
- El orden de los problemas sigue siendo uno por atributo y en el orden de `PRODUCT_ATTRIBUTES`. Ajustado en E3: dentro de un texto libre se informa primero el salto de línea, después la comilla inicial y por último la longitud, porque `clean_text` corrige el salto y puede acortar el texto.
- `PROFILE_VERSION` pasa a `google_merchant@2026-11-01` (fecha de consulta de F18), como exige el comentario del propio archivo. ~~`ENGINE_VERSION` no cambia.~~ Ajustado en E3: `\s` de JavaScript no incluye U+0085, así que `clean_text` no lo quitaba. El colapso de espacios del motor pasa a `[\s\u0085]+` y `ENGINE_VERSION` sube a `'2'`.
- Textos es/en y sugerencias en [problem-messages.ts](../../../../src/evaluations/problem-messages.ts): para `TEXT_HAS_LINE_BREAK`, «aplica la regla `clean_text` a este atributo o corrige el catálogo»; `clean_text` ya colapsa esos caracteres (ficha 01, hallazgo 1). Ajustado en E3: para el `id` sugiere corregir el catálogo y reimportar, porque ninguna regla cambia el id.
- Las evaluaciones anteriores quedan desactualizadas (D3.1) y deben repetirse para exportar (R3).

### D6 — El TSV se guarda como artefacto, en un módulo común

Se guarda en lugar de regenerarlo en cada descarga (RC2), por tres razones:

- F2 y F4 piden que lo descargado sea un archivo completo y verificado, y la fase B apuntará a ese archivo.
- La suma del TSV aprobado debe corresponder a los bytes descargados aunque el serializador cambie después.
- Generarlo una vez cuesta poco (D8).

Cambios:

1. **Extraer `ArtifactStore` a `src/artifacts/`** con un `ArtifactsModule` que lo exporta (RC3: la configuración compartida vive en un módulo que exporta su servicio). Es el tercer consumidor que el plan anterior esperaba (D8). La extracción se hace sin cambiar comportamiento, con el procedimiento de refactorización de `filosofia-codigo-legible-para-humano` (punto de guardado, contratos públicos, comparación antes/después) y las pruebas de `catalog-import` como regresión.
2. **Espacios por tipo de archivo.** Cada tipo tiene su carpeta y su patrón de clave:
   - importaciones: `artifacts/<uuid>.csv`, sin cambios, para que los archivos ya guardados sigan siendo válidos;
   - exportaciones: `exports/<uuid>.tsv`.

   La clave sigue siendo interna: el cliente solo conoce `exportId` (RC1, F3).
3. **Nueva operación `writeGenerated(kind, content)`.** Escribe en `tmp/` con `open('wx', 0o600)`, hace `sync`, enlaza en la carpeta final con `link` exclusivo y sincroniza el directorio, igual que `receive` + `finalize` (F10). Después **verifica**: vuelve a leer el archivo y compara tamaño y SHA-256 con los calculados en memoria. Si algo falla, borra lo que creó. Devuelve `{ key, byteSize, checksum }`.
4. **Raíz:** se mantiene la variable `CATALOG_IMPORT_ROOT` (o `.data/catalog-import`) para no mover archivos ya guardados; el nombre queda como deuda documentada.
5. **Limpieza.** La lógica de huérfanos (antigüedad mínima de una hora, listar, consultar referencias, borrar) se extrae a una función reutilizable. `catalog-import` la usa para `artifacts/` con `catalog_snapshots` y `exports` para `exports/` con la tabla de D7. Cada módulo conserva su servicio de arranque.

Ajustado en E4:

- **Configuración propia.** El almacén tiene su configuración (`ARTIFACT_STORE_OPTIONS`, `{ root }`) y `root` sale de `CatalogImportOptions`.
- **Pruebas.** Las E2E que montan el módulo la sobrescriben, y `isolated-env.ts` apunta `CATALOG_IMPORT_ROOT` a una carpeta temporal, para que ninguna prueba escriba en `.data/`.
- **Nombre de la operación.** Se llama `writeExport`, no `writeGenerated(kind, …)`: solo hay un tipo de archivo generado.
- **`receive`.** Sigue usando el límite y el error de `catalog-import` (único tipo de subida), con un comentario.
- **`tmp/`.** Acepta claves `.csv` y `.tsv`; es la única diferencia de comportamiento con el oráculo.
- **Lectura y limpieza de `exports/`.** Pasan a E6.

### D7 — Tabla `exports` y alta en una transacción corta

Migración `AAAAMMDD000N00_create_exports` con la fecha de E5 (si fuera hoy, `20261101000300_create_exports`):

| Columna | Tipo y restricción |
| --- | --- |
| `id` | `TEXT` PK (UUID) |
| `project_id`, `evaluation_id` | FK compuesta → `evaluations (project_id, id)` `ON DELETE CASCADE` (D11); usa el índice único creado para esto (F7). |
| `approved_result_checksum` | `TEXT NOT NULL CHECK (~ '^[a-f0-9]{64}$')` |
| `accepted_invalid_count`, `accepted_excluded_count`, `row_count` | `INTEGER NOT NULL`, `CHECK (>= 0)`; `row_count` entre 1 y 5000. |
| `artifact_key` | `TEXT NOT NULL UNIQUE`, `CHECK (~ '^[0-9a-f-]{36}\.tsv$')` |
| `byte_size` | `INTEGER NOT NULL CHECK (> 0)` |
| `tsv_checksum` | `TEXT NOT NULL CHECK (~ '^[a-f0-9]{64}$')` |
| `created_at` | `TEXT NOT NULL` |

- **`UNIQUE (evaluation_id)`: una exportación por evaluación.** El TSV de una evaluación inmutable es siempre el mismo. Repetir el POST con la misma aprobación devuelve la exportación existente con `200` en lugar de `201`. Es idempotencia natural, sin claves de idempotencia.
- No se crean `feed`, `feed_version` ni `published_version`. [F6]
- Flujo de `ExportsService.create`:
  1. Leer la evaluación propia, comprobar D1–D3 y leer sus filas `valid`. Lectura sin bloqueo: así no se tiene una transacción abierta mientras se escribe en disco.
  2. Serializar (D4) y escribir con `writeGenerated` (D6). El archivo queda fuera de la transacción. [F2 inv. 5]
  3. Abrir una transacción corta: volver a leer la evaluación con `FOR SHARE`, repetir D1–D3 (pudo cambiar entre 1 y 3) e insertar con `tx.export.create`. Una colisión llega como P2002 (trampa 3 del traspaso).
  4. Si la transacción falla o hay P2002, borrar el archivo recién escrito. Con P2002, devolver la exportación existente (`200`). Si el borrado también falla, la limpieza de D6.5 lo retira.
- Ajustado en E5:
  - antes de generar, el servicio busca si la evaluación ya tiene exportación y la devuelve sin escribir otro archivo;
  - `assertCanExport` envuelve la comprobación de E2 y la usan el servicio y la transacción;
  - `isProductValues` pasa al perfil para que lo compartan evaluaciones y exportaciones.

### D8 — Síncrono, sin trabajador

`errores.csv` de 1.667 filas tarda 13 ms (F15) y el límite es de 5.000 filas. Medido en E1: el TSV de 5.000 productos se serializa en 7–9 ms (1,54 MB). El TSV se genera dentro del POST: no hace falta tabla de trabajos ni worker, y RNF03 (concurrencia limitada para tareas pesadas) no aplica a esta escala. En E1 se mide la serialización de 5.000 filas y en E5 el POST completo con PGlite. Si una medición contradijera esta decisión, se revisa el plan antes de seguir.

### D9 — Contrato HTTP

| Operación | Ruta | Respuesta |
| --- | --- | --- |
| Exportar | `POST /api/v1/projects/:projectId/exports` | `201` con `{ export, downloadUrl }`; `200` si ya existía la de esa evaluación (D7). |
| Consultar | `GET /api/v1/projects/:projectId/exports/:exportId` | `200` con la exportación: `id`, `evaluationId`, conteos aceptados, `rowCount`, `byteSize`, `tsvChecksum`, `createdAt`. |
| Descargar | `GET /api/v1/projects/:projectId/exports/:exportId/productos.tsv` | `StreamableFile` con `type: 'text/tab-separated-values; charset=utf-8'` (F21), `disposition: attachment; filename="productos-<exportId>.tsv"` y `length: byteSize` (F22). |

- Todas con `DescopeSessionGuard`, `uuidParamPipe` y proyecto propio; recursos ajenos → `404`.
- **Apertura antes de responder (R2):** el servicio abre el archivo (`open` + `createReadStream` desde el descriptor) antes de devolver el `StreamableFile`. Si falta → `503 EXPORT_FILE_UNAVAILABLE`, con registro sin datos del catálogo. Hecho en E6: `ArtifactStore.openExport`; el registro es `EXPORT_FILE_MISSING` con el id de la exportación.
- Extensión `.tsv`: F17 la admite y coincide con el tipo de medio; en la cuenta piloto se puede renombrar a `.txt` si la fuente lo exige (F18).
- Sin listado paginado de exportaciones en este incremento: no lo pide ningún requisito, y cada evaluación tiene como mucho una.
- Ajustado en E5:
  - el `POST` fija el estado con `@Res({ passthrough: true })`, que no se salta interceptores ni filtros;
  - la respuesta no incluye la clave del archivo ni la suma aprobada;
  - `downloadUrl` se devuelve ya, aunque la ruta llega en E6.

### D10 — Errores públicos

Nuevos en [error-codes.ts](../../../../src/common/http/error-codes.ts) y [messages.ts](../../../../src/common/http/messages.ts), con texto es/en:

| Código | HTTP |
| --- | --- |
| `EXPORT_NOT_FOUND` | 404 |
| `EXPORT_NO_VALID_PRODUCTS` | 409 |
| `EXPORT_APPROVAL_MISMATCH` | 409 |
| `EXPORT_EVALUATION_OUTDATED` | 409 |
| `EXPORT_EVALUATION_SUPERSEDED` | 409 |
| `EXPORT_FILE_UNAVAILABLE` | 503 |

- Los errores de forma del body siguen siendo `400 VALIDATION_FAILED`.
- Ninguno necesita `issues`: no se añaden a `CODES_WITH_ISSUES`. [F16]
- `EXPORT_APPROVAL_MISMATCH` no indica qué campo difiere: el cliente debe volver a leer la evaluación.
- Ajustado en E2: los cuatro `409` que devuelve la comprobación de la aprobación se crearon en E2; `EXPORT_NOT_FOUND` y `EXPORT_FILE_UNAVAILABLE` se crearán en E5 y E6.

### D11 — Borrado en cascada y retirada de archivos

- `exports → evaluations` con `ON DELETE CASCADE`. En la fase A, una exportación es un derivado de su evaluación y no vive sin ella. Es el caso «componente» de F23, como `evaluation_rows`. Resuelve lo que D14 del plan anterior dejó pendiente.
- `deleteSnapshot` y `deleteProject` ya borran evaluaciones en cascada. Dentro de su transacción leerán también las `artifact_key` de las exportaciones afectadas y las devolverán junto a las de los snapshots, para retirar los archivos tras el commit con el mismo patrón actual. Si la retirada falla, la limpieza al arrancar los encuentra (D6.5).
- **Revisar en la fase B:** si `feed_version` referencia exportaciones, borrar una evaluación publicada no debería arrastrar el feed vigente. Allí probablemente convenga `RESTRICT`.
- Ajustado en E6:
  - **Claves en lo que devuelven los borrados.** `DeletedImport` lleva `exportArtifactKeys` por importación, y cuatro sitios de las pruebas de `catalog-import` lo añaden con `[]`.
  - **`deleteProject` bloquea los snapshots del proyecto** (`FOR UPDATE`) antes de leer las claves, para esperar a una exportación en curso. PGlite no puede demostrarlo; si fallara, la limpieza de `exports/` retira el huérfano.
  - **Un fallo al retirar un TSV** se registra (`EXPORT_ORPHAN_RETAINED`) y no deshace el borrado.

### D12 — Revisión con los recursos existentes

Las exclusiones por reglas ya aparecen en el resumen (`counts.excluded`) y se listan con `…/rows?outcome=excluded`; las inválidas, con `?outcome=invalid` y `errores.csv`. Las filas excluidas no tienen valores (F7), lo que basta para identificar qué producto se excluye y por qué regla (`excludedByRule`). No se crea ningún recurso de revisión: la confirmación es el POST de D2. [F1]

### D13 — Pruebas

Detalle en «Comprobación prevista»:

- unitarias del serializador, de la comprobación de la aprobación y de los nuevos problemas del perfil, sin Nest;
- integración con PGlite para la tabla, las FK compuestas, la unicidad, la cascada y el almacén con una raíz temporal;
- E2E con Supertest y dos propietarios, con raíz de artefactos temporal y limpieza al terminar (RC6, l. 31–39).

En cada etapa se introducen defectos a propósito para comprobar que las pruebas fallan, y después se restaura con `diff`.

### D14 — Comprobación en Merchant Center

La aceptación del incremento exige procesar el TSV en una cuenta piloto (F6). Es una comprobación manual del usuario, fuera de las pruebas automatizadas. Se registra en la bitácora con:

- si la fuente tiene activados los campos entrecomillados (F19);
- la extensión usada;
- los errores que muestre Google.

Superar esta comprobación no garantiza la aprobación de los productos. [F5]

## Etapas

| Etapa | Cambios | Evidencia de cierre |
| --- | --- | --- |
| E1 — Serializador TSV | `src/exports/products-tsv.ts` puro (D4), con la comprobación de caracteres prohibidos compartida con D5. Ajustado en E1: dos predicados, `hasTabOrLineBreak` y `startsWithQuote`, en `google-merchant.profile.ts`, porque `exports` depende de `evaluations` y no al revés; el perfil no los usa hasta E3. | Hecho en E1: 31 unitarias en verde, 6 defectos detectados, medición de 5.000 filas en 7–9 ms. |
| E2 — Comprobación de la aprobación | Función pura que recibe la evaluación, la aprobación y si existe una más reciente, y devuelve el primer código de D1–D3 o `null`. Ajustado en E2: «existe una más reciente» es una propiedad de la evaluación; cuatro códigos de D10 creados aquí. | Hecho en E2: 26 unitarias, 7 defectos detectados (uno solo tras añadir pruebas). |
| E3 — Perfil v2026-11-01 | `TEXT_HAS_LINE_BREAK`, `TEXT_STARTS_WITH_QUOTE`, `PROFILE_VERSION` nueva y textos es/en (D5). Ajustado en E3: también `ENGINE_VERSION` `'2'` (U+0085 en `clean_text`) y opcional vacío → celda vacía en el serializador. | Hecho en E3: 33 pruebas nuevas, 7 defectos detectados; las dos pruebas que fijaban las versiones se actualizaron. |
| E4 — `ArtifactsModule` | Extracción sin cambio de comportamiento, carpetas por tipo, `writeGenerated` con verificación y limpieza reutilizable (D6). Ajustado en E4: `writeExport`, configuración propia del almacén y red de seguridad en las pruebas. | Hecho en E4: comparación con el oráculo (0 diferencias tras mover; 1 intencionada tras ampliar), 16 pruebas nuevas, ninguna aserción cambiada, 7 defectos detectados, arranque real con `401`. |
| E5 — Exportar | Migración `exports`, repositorio, servicio con el flujo de D7, `POST` y `GET` de metadatos (D9), códigos de D10. | Hecho en E5: 19 pruebas de integración y 13 E2E; 8 defectos detectados uno a uno; esquema y migraciones coinciden; arranque real con `401`. Migración aplicada en Neon el 2026-11-02. |
| E6 — Descarga, borrados y limpieza | `GET …/productos.tsv` con apertura previa (R2), retirada de archivos en `deleteSnapshot`/`deleteProject` (D11) y limpieza de `exports/` al arrancar. Ajustado en E6: `exportArtifactKeys` en `DeletedImport`, bloqueo de snapshots en `deleteProject` y `EXPORT_OPTIONS`. | Hecho en E6: 16 pruebas nuevas; 8 de 9 defectos detectados (el bloqueo de `deleteProject` no se puede demostrar con PGlite); arranque real con `401`. |
| E7 — Cierre documental | Actualizar `docs-diagrams/07` (contrato de exportación) y `06` (tabla `exports` en lugar de `feed_version` en la fase A), bitácoras y este plan. Ajustado en E7: también una nota de estado del incremento 3 en `docs-diagrams/09`. | Hecho en E7: enlaces comprobados; los diagramas Mermaid editados no se renderizaron. |

E1 y E2 no dependen de nada y definen las piezas que usan E3 y E5. E3 va antes de E5 porque la exportación exige la versión nueva del perfil (D3.1). Cada etapa abre su entrada en [la bitácora de la feature](../../../../bitacora-construccion/feature/reviews&exports/).

## Comprobación prevista

**Unitarias del serializador (E1):**

- cabecera exacta y orden de columnas de D4, con y sin opcionales;
- solo los opcionales con algún valor; celdas vacías intermedias;
- ninguna línea termina en `\t`; todas tienen el mismo número de campos; `\n` final;
- sin BOM (primer byte `i`);
- precio normalizado tal cual (`15.00 USD`), ID con ceros a la izquierda conservados;
- error interno si llega un valor con `\t`, `\n`, U+2028 o comilla inicial;
- misma entrada, mismos bytes;
- medición: tiempo y tamaño de 5.000 filas, registrados sin umbral inventado.

**Unitarias de la aprobación (E2):** cada código de D1–D3 por separado; orden cuando fallan varios; conteos 0 aceptados; suma en mayúsculas o con otra longitud → mismatch (el DTO ya la limita).

**Unitarias del perfil (E3):** cada carácter de la lista en `id`, `title`, `description` y `brand`; comilla solo al inicio (una interior se acepta); los enlaces siguen rechazando espacios; `clean_text` antes de validar elimina el problema; nueva `PROFILE_VERSION` guardada en la evaluación.

**Integración con PGlite:**

- `writeGenerated`: archivo con permisos `0600`, colisión de clave rechazada, fallo simulado tras escribir borra `tmp/`, verificación detecta un archivo alterado;
- tabla `exports`: FK compuesta (evaluación de otro proyecto falla), `UNIQUE (evaluation_id)`, `CHECK`s; cascada al borrar snapshot y proyecto;
- `create`: rollback borra el archivo; P2002 devuelve la existente y borra el duplicado;
- borrados devuelven las claves de TSV;
- PGlite no demuestra `FOR SHARE` frente a `FOR UPDATE`; se dice en un comentario de la prueba (trampa 4 del traspaso).

**E2E con Supertest y dos propietarios:**

- recorrido completo: importar CSV, guardar reglas, evaluar, leer la evaluación, exportar con lo leído, consultar y descargar;
- el TSV descargado: `Content-Type`, `Content-Disposition`, bytes cuyo SHA-256 es `tsvChecksum` (con `.responseType('blob')`, trampa 7);
- ninguna fila inválida ni excluida aparece en el TSV;
- `409` por evaluación sin válidos, aprobación distinta, evaluación sustituida y perfil antiguo;
- segundo POST igual → `200` con la misma exportación;
- Bob recibe `404` en evaluaciones y exportaciones de Alice;
- archivo borrado a mano → `503 EXPORT_FILE_UNAVAILABLE`.

**Verificación de cada etapa:** `tsc --noEmit`, `pnpm lint`, `prettier --check src test/features`, `pnpm test:features` y, desde E5, `pnpm db:verify` y la comprobación esquema-migraciones («This is an empty migration»). La migración nueva se añade a `test/prisma-migrations.test.mjs` y el conteo de `projects.repository.int-spec.ts` pasa de 9 a 10. Las suites existentes siguen como regresión.

**Fuera de lo automatizado:** subida a una cuenta piloto de Merchant Center (D14) y aplicar la migración en Neon, que hace el usuario con `pnpm db:status` y `pnpm db:migrate`.

## Límites y continuidad

**Fuera del plan:**

- Fase B: URL estable del feed, `feed`/`feed_version`, `published_version`, publicaciones, token de entrega, programación y política automática.
- GraphQL de evaluaciones y exportaciones (plan `02` pendiente de la feature anterior).
- Frontend (`estadistica-forms-web`).
- Listado paginado de exportaciones y borrado individual de una exportación.
- Atributos de Google que el perfil no mapea (`gtin`, `mpn`, envío…) y atributos repetidos o de grupo, que usan comas y dos puntos (F18).
- Renombrar `CATALOG_IMPORT_ROOT`.

**Revisar este plan si:**

- la cuenta piloto rechaza el fin de línea `\n`, la extensión `.tsv` o el orden de columnas;
- la medición de E1 o E5 hace dudar de la exportación síncrona;
- la extracción de E4 obliga a cambiar aserciones de las pruebas de `catalog-import` (indicaría un cambio de comportamiento);
- la fase B necesita conservar exportaciones de evaluaciones borradas (D11).
