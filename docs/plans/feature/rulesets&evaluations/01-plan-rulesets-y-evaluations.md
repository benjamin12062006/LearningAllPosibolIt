# 01 — Guardar reglas versionadas y evaluar un snapshot de forma reproducible

Fecha de creación: 2026-10-31  
Última actualización: 2026-10-31 (D9 aceptada por el usuario; D3 revisada con la ficha 05; D10 cerrada con la ficha 06; E1 implementada con cuatro ajustes marcados «en E1»); 2026-11-01 (E2 y E3 implementadas con ajustes marcados «en E2» y «en E3»; ficha 07); 2026-11-01 (E4 implementada; BOM decidido con la ficha 08)  
Estado: E1–E4 implementadas y verificadas en local ([bitácora 01](../../../../bitacora-construccion/feature/rulesets&evaluations/01-motor-de-evaluacion-puro.md), [02](../../../../bitacora-construccion/feature/rulesets&evaluations/02-guardar-versiones-de-reglas.md), [03](../../../../bitacora-construccion/feature/rulesets&evaluations/03-evaluacion-asincrona.md), [04](../../../../bitacora-construccion/feature/rulesets&evaluations/04-informe-de-la-evaluacion.md)). Las migraciones de E2 y E3 no están aplicadas en Neon, y deben aplicarse antes de arrancar la API: el worker de evaluaciones consulta su tabla al arrancar. Quedan pendientes la comprobación manual de `errores.csv` en una hoja de cálculo y GraphQL (plan `02`).  
Ámbito: incremento 2 de `docs-diagrams` (mapeo, reglas y evaluación): RF03/UC03, RF04/UC04, RNF02 y RNF04.  
Relacionada con: [estado real](../../../fonts/feature/rulesets&evaluations/01-estado-real-y-antecedentes.md), [fuentes técnicas](../../../fonts/feature/rulesets&evaluations/02-fuentes-tecnicas.md), [cursos y reconstrucciones](../../../fonts/feature/rulesets&evaluations/03-cursos-y-reconstrucciones.md), [mapa de necesidades](../../../fonts/feature/rulesets&evaluations/04-mapa-de-necesidades-para-el-plan.md), [experimento del discriminador](../../../fonts/feature/rulesets&evaluations/05-experimento-discriminador-y-validationpipe.md), [formato de errores.csv](../../../fonts/feature/rulesets&evaluations/06-csv-de-errores-owasp-y-rfc4180.md), [plan de catalog-import](../projects&catalog-import/03-plan-catalog-import.md), [plan de testing](../../config/01-testing-nest-para-futuras-features.md), [secuencia objetivo](../../../../../docs-diagrams/08-secuencias-y-estados.md).  
Revisión de referencia: `1f0be2d`, con 53 archivos modificados sin commit al escribir el plan.

## Objetivo

Un operador guarda una **versión inmutable** de mapeo y reglas de su proyecto. Después pide evaluar un snapshot `ready` con una revisión concreta y recibe un resumen con varias partes:

- **Conteos**: válidos, inválidos y excluidos.
- **Muestra**: una selección de las filas evaluadas.
- **Informe paginado**: los problemas de cada fila.
- **`errores.csv`**: el archivo con fila, producto, campo, problema y corrección sugerida.

El incremento está completo cuando se cumplen estas condiciones:

1. Guardar reglas crea la revisión siguiente sin modificar las anteriores. Dos guardados simultáneos nunca comparten número. [F1, F2, F22, F23]
2. Repetir la misma evaluación produce las mismas filas, problemas, conteos y suma de comprobación. [F1 RNF02]
3. En toda evaluación terminada se cumple `válidos + inválidos + excluidos = total del snapshot`, comprobado en el motor y en la base. [F2 inv. 3]
4. Ninguna regla cambia el ID externo, y ningún precio pasa por `number`. [F2 inv. 2, F1 RNF04]
5. Un propietario no ve ni usa versiones, snapshots ni evaluaciones de otro: recibe `404`.

Queda fuera la exportación TSV (incremento 3), así como GraphQL, reintentos y varias réplicas. Detalle en «Límites y continuidad».

## Punto de partida

Está disponible lo siguiente ([ficha 01](../../../fonts/feature/rulesets&evaluations/01-estado-real-y-antecedentes.md)):

- Proyectos con propietario y configuración `country/currency/channelProfile`, que se bloquea en cuanto existe un snapshot.
- Snapshots con `headers` y `projectConfiguration` congelada, y filas con `externalId` y `originalValues`.
- Un trabajador de importación con `claim` y `SKIP LOCKED`, que al arrancar marca los trabajos interrumpidos.
- Paginación compartida y códigos de error es/en.

No existen tipos de regla, un perfil de Google, un tipo de precio ni tablas de evaluación.

Al revisar el código para este plan aparecieron tres restricciones que no estaban en las fichas:

- **R1 — Limpieza de huérfanos.** [`ArtifactCleanupService`](../../../../src/catalog-import/artifact-cleanup.service.ts) borra al arrancar todo `<uuid>.csv` de `artifacts/` que no referencie un snapshot. Si esta feature dejara archivos en esa carpeta, se borrarían.
- **R2 — Borrado de proyectos e importaciones.** [`deleteProject`](../../../../src/catalog-import/catalog-import.repository.ts) (l. 326–351) y `deleteImport` bloquean el proyecto con `FOR UPDATE` y solo comprueban trabajos de importación activos. Una evaluación en curso no impediría borrar su snapshot.
- **R3 — Validación global.** El `ValidationPipe` global usa `whitelist` y `forbidNonWhitelisted` ([configure-http.ts](../../../../src/configure-http.ts), l. 17–23). Las propiedades de una subclase de regla deben estar decoradas, o se rechazarán.

## Decisiones

Cada decisión responde a una fila del [mapa de necesidades](../../../fonts/feature/rulesets&evaluations/04-mapa-de-necesidades-para-el-plan.md) (`D1` corresponde a `N1`, y así sucesivamente). Los identificadores `F`, `RC` y `C` remiten a las fichas 01–03.

### D1 — Versión de reglas inmutable con revisión creciente

- Nueva tabla `ruleset_versions`, con las columnas:
  - `id TEXT` (UUID);
  - `project_id` con FK a `projects`;
  - `revision INT CHECK (revision > 0)`;
  - `mapping JSONB` y `rules JSONB`, ambos **arreglos**;
  - `created_at`.
- Restricciones: `UNIQUE (project_id, revision)` y `UNIQUE (project_id, id)`; esta última sirve de destino para la FK compuesta de evaluaciones.
- No habrá `PATCH` ni `DELETE` por versión. Corregir una regla significa guardar otra revisión. [F2]
- Para calcular la revisión, en una transacción corta:
  1. `SELECT … FROM projects WHERE id AND owner_id FOR UPDATE`, el mismo bloqueo que `accept` y `deleteProject`. [F9, F22]
  2. `COALESCE(MAX(revision), 0) + 1`.
  3. `INSERT`.
- Si a pesar del bloqueo salta un P2002, se traduce a `409 RULESET_REVISION_CONFLICT`. [F23, F24] Ajustado en E2: el `INSERT` usa la API del modelo (`tx.rulesetVersion.create`), porque con `$queryRaw` la misma violación llega como P2010 y no como P2002 ([experimento 04](../../../fonts/feature/rulesets&evaluations/experimentos/04-error-unicidad-prisma.salida.txt)).
- Se exige un proyecto configurado (`requireConfigured`, `409 PROJECT_CONFIGURATION_REQUIRED`), porque el mapeo se valida contra `channelProfile`. [F7]
- Rutas:
  - `POST /projects/:projectId/rulesets` → `201 { id, revision, mapping, rules, createdAt }`.
  - `GET /projects/:projectId/rulesets` (paginado) y `GET /projects/:projectId/rulesets/:revision`, para que la interfaz elija una revisión. [F3, F12]

### D2 — Mapeo como arreglo de pares

- Forma: `mapping: [{ attribute: 'title', column: 'Nombre' }, …]`. Cada `attribute` debe pertenecer al perfil (`@IsIn`, RC1), y `column` tiene entre 1 y 128 caracteres, igual que el límite de cabeceras de la importación. Entre 1 y 8 pares, uno por atributo del perfil v1 (`@ArrayMinSize`/`@ArrayMaxSize`, RC2, F18; corregido en E1, el plan decía 9).
- Un atributo repetido devuelve `400 RULESET_MAPPING_DUPLICATE`, comprobado en el dominio porque `@ArrayUnique` compara por referencia. [F18] Dos atributos sí pueden leer la misma columna.
- `id` no se mapea: procede siempre de `idColumn` del snapshot. [F2 inv. 2]
- Al guardar, el mapeo **no** se valida contra las cabeceras: una revisión pertenece al proyecto y puede aplicarse a snapshots distintos. La existencia de las columnas se comprueba al aceptar la evaluación (D8).
- Al guardar se rechaza, con `400 RULESET_REQUIRED_ATTRIBUTE_MISSING` y la lista de atributos, una versión en la que algún atributo obligatorio del perfil no esté mapeado ni lo produzca una regla. Obligatorios en v1: `title`, `description`, `link`, `image_link`, `price` y `availability`. [F19] Así se evita una evaluación con todas las filas inválidas por un olvido de configuración.

### D3 — Reglas: subclase elegida a mano con `@Transform`, más validación explícita de `type`

Decisión revisada el 2026-10-31 tras el [experimento de la ficha 05](../../../fonts/feature/rulesets&evaluations/05-experimento-discriminador-y-validationpipe.md):

- **El discriminador de `@Type` sí rechaza** los tipos desconocidos y los campos ajenos a cada subclase. [F27]
- **Pero con `rules: [null]`**, que es JSON válido, `class-transformer` 0.5.1 lanza un `TypeError` antes de validar, y el filtro global responde `500`. [F27, F28]
- **Por eso no se usa el discriminador.**

- `rules: RuleDto[]`, con estos decoradores:
  - `@IsArray`, `@ArrayMaxSize(20)`. Sin mínimo (ajustado en E2): una versión solo con mapeo ya sirve para validar el catálogo;
  - `@IsObject({ each: true })`;
  - `@ValidateNested({ each: true })`;
  - `@Transform(({ obj }) => …, { toClassOnly: true })`. [RC2, F29]
- La función de `@Transform` (`toRuleDto`) solo actúa sobre los objetos que no son arreglos:
  1. busca la subclase en un `Map<RuleType, clase>` (`Map.get` no recorre el prototipo, así que `"__proto__"` y `"constructor"` no resuelven a nada);
  2. si no la encuentra, usa `RuleDto`;
  3. llama a `plainToInstance`.

  Los demás valores (`null`, cadenas, arreglos) pasan sin cambios y los rechaza `@IsObject`/`@ValidateNested` con `400`. [F29]
- `RuleDto` declara `@IsIn(RULE_TYPES) type`. Un tipo desconocido falla en `rules.N.type`, y sus campos, en `whitelistValidation` (R3). [F27, F29]
- `mapping` mantiene el `@Type(() => MappingDto)` simple de RC2: no tiene el fallo con `null`. [F30]
- La prueba previa E2.0 ya está hecha (ficha 05). Sus casos se convierten en pruebas unitarias del DTO en E2.
- Se guarda como arreglo JSON en el orden recibido; la posición en el arreglo es el orden de aplicación. [F20, F21]
- Tipos de dominio separados del transporte: `Rule = CleanTextRule | BuildTitleRule | ExcludeWhenRule`, discriminados por `type`. [RC6] El DTO se convierte a ese tipo en el servicio, y la base guarda la forma de dominio, no la instancia de clase.
- Al leer una versión se vuelve a validar su forma, porque Prisma no tipa los campos `Json`. [F25]

### D4 — Las tres reglas de v1

Todas operan sobre los **atributos mapeados**, no sobre las columnas crudas, y ninguna puede escribir `id`.

| `type` | Parámetros | Efecto |
| --- | --- | --- |
| `clean_text` | `attributes`: entre 1 y 5 de `title`, `description`, `brand`, `availability` y `condition`, sin repetir | `normalize('NFC')`, colapsa espacios en blanco (`/\s+/g` → `' '`) y recorta. NFKC queda descartado porque cambia caracteres de compatibilidad. [F26, RC7] |
| `build_title` | `template`: de 1 a 300 caracteres, con marcadores `{atributo}` | Sustituye cada marcador por el valor actual del atributo, colapsa espacios y escribe `title`. No trunca: si supera 150 caracteres, la validación lo marca (D6). [F19] |
| `exclude_when` | `attribute` (atributo del perfil o `id`), `operator` ∈ `equals`, `not_equals`, `contains` o `is_empty`, y `value` de 1 a 200 caracteres; con `is_empty` debe ir vacío (corregido en E1: con `contains`, un valor vacío excluiría todas las filas) | Si el predicado se cumple, la fila queda **excluida** con la posición de la regla y se detiene su procesamiento. [RC9] La comparación es exacta y distingue mayúsculas; no depende de la configuración regional. |

Validación de referencias al guardar (función pura, `400 RULESET_REFERENCE_INVALID`): cada atributo que nombra una regla, o un marcador de la plantilla, debe estar mapeado o haberlo producido una regla anterior. Solo `build_title` produce un atributo, `title`. Leer `id` está permitido; escribirlo, no.

### D5 — Motor puro, versionado y con `switch` exhaustivo

- Ubicación: `src/evaluations/engine/`, sin dependencias de Nest, Prisma, `fs` ni `Date`. Contiene:
  - `evaluateRow(row, ruleset, { currency }): RowOutcome`. El perfil no se pasa como parámetro: hay uno solo y se importa con su `PROFILE_VERSION` (ajustado en E1);
  - el perfil `google_merchant`;
  - el analizador de precios. [RC7, F4]
- Recorrido fijo por fila: construir atributos desde el mapeo, aplicar reglas en orden, validar contra el perfil y normalizar el precio. [RC8]
- Devuelve objetos nuevos y no modifica `originalValues`. [RC7]
- Constantes guardadas en cada evaluación: `ENGINE_VERSION = '1'` y `PROFILE_VERSION = 'google_merchant@2026-10-31'`, la fecha de consulta de F19. Cambiar reglas, perfil o algoritmo obliga a subir la constante correspondiente. [F1 RNF02]
- Para aplicar las reglas se usa un `switch (rule.type)` con rama `never`. El principio abierto/cerrado [C10, C11] queda descartado por ahora con un criterio concreto: hay tres tipos cerrados, y añadir uno ya obliga a tocar el DTO, la validación de referencias y `ENGINE_VERSION`. Un registro de manejadores no evitaría esos cambios. Se revisará si el número de tipos crece.
- Funciones pequeñas con nombre y validación separada del procesamiento. [C14]

### D6 — Perfil `google_merchant` v1 y política de precios

Problemas por fila: `{ attribute, code }`, como mucho uno por atributo y en el orden del perfil. Los códigos pertenecen al perfil, no a `ErrorCodes`. [F19] La corrección sugerida se genera desde el código en E4, con los mensajes es/en, para que el motor no dependa del idioma (ajustado en E1; el plan incluía `suggestion` en el problema).

| Atributo | Regla v1 | Código |
| --- | --- | --- |
| `id` (del snapshot) | ≤ 50 caracteres (añadido en E1 desde F19) | `TEXT_TOO_LONG` |
| obligatorios (D2) | No vacío tras las reglas | `FIELD_MISSING` |
| `title` / `description` / `brand` | ≤ 150 / ≤ 5000 / ≤ 70 caracteres | `TEXT_TOO_LONG` |
| `link`, `image_link` | `new URL()` válido con protocolo `http:` o `https:` | `URL_INVALID` |
| `availability` | `in_stock` u `out_of_stock` | `AVAILABILITY_INVALID` |
| `availability` | `preorder` o `backorder` exigen `availability_date`, que v1 no mapea | `AVAILABILITY_DATE_REQUIRED` |
| `condition` (opcional) | `new`, `refurbished` o `used` | `CONDITION_INVALID` |
| `price` | Formato y moneda (siguiente párrafo) | `PRICE_FORMAT_INVALID`, `PRICE_CURRENCY_MISMATCH`, `PRICE_ZERO` |

**Precio** (decisión propia; no se encontró fuente sobre separadores regionales, [ficha 02](../../../fonts/feature/rulesets&evaluations/02-fuentes-tecnicas.md)):

- Se acepta `^\d{1,9}(\.\d{1,2})?$`, seguido opcionalmente de un espacio y un código ISO 4217 que debe coincidir con `currency` congelada en el snapshot. [F8]
- No se aceptan coma decimal, separador de miles ni símbolo. La sugerencia indica el formato esperado («1234.50»), sin adivinar el valor. [F2 inv. 2, F1 RNF04]
- La salida normalizada `"15.00 USD"` se construye con operaciones de texto: se rellenan los decimales a dos y nunca se usa `Number`, `parseFloat` ni `Math.round`. [C12, citado como contraste]
- Un precio igual a cero produce `PRICE_ZERO`.

### D7 — Clasificación y conteos

- Cada fila tiene exactamente un resultado:
  - **excluida**, si la detuvo una regla `exclude_when` (no se valida);
  - **inválida**, si la validación dejó al menos un problema;
  - **válida**, en otro caso.
- El motor devuelve también los conteos.
- La invariante se comprueba en tres capas:
  1. en el motor, mediante una prueba;
  2. en el trabajador antes de confirmar, contando por resultado en la base y comparando con el motor y con `rowCount` del snapshot;
  3. con un `CHECK` en `evaluations`: si `status = 'succeeded'`, entonces `valid_count + invalid_count + excluded_count = total_count`. [F2 inv. 3]

### D8 — Evaluación asíncrona con trabajador propio

- Tabla `evaluations`, que hace a la vez de evaluación y de trabajo. Columnas:
  - `id`, `project_id`, `snapshot_id`, `ruleset_version_id`;
  - `engine_version`, `profile_version`;
  - `status` ∈ `queued`, `running`, `succeeded` o `failed`;
  - los cuatro conteos (nulos hasta terminar) y `result_checksum`;
  - `created_at`, `started_at`, `finished_at`, `error JSONB`.
- Se elige una sola tabla en lugar de evaluación + trabajo, como en la importación, porque aquí la relación es 1:1 y el diagrama solo exige que un trabajo «produce» una evaluación. Así se crean únicamente las tablas del incremento. [F6]
- Las FK compuestas `(project_id, snapshot_id)` → `catalog_snapshots(project_id, id)` y `(project_id, ruleset_version_id)` → `ruleset_versions(project_id, id)` impiden mezclar proyectos. [F2]
- `POST /projects/:projectId/evaluations { snapshotId, rulesetRevision }`, en una transacción con el proyecto bloqueado (`FOR UPDATE`):

  | Comprobación | Respuesta si falla |
  | --- | --- |
  | El snapshot pertenece al proyecto | `404 IMPORT_NOT_FOUND` |
  | El snapshot está `ready` | `409 EVALUATION_SNAPSHOT_NOT_READY` |
  | La revisión existe | `404 RULESET_NOT_FOUND` |
  | Todas las columnas del mapeo están en `headers` | `409 EVALUATION_COLUMN_MISSING`, con la lista |
  | No hay otra evaluación `queued`/`running` en el proyecto | `409 EVALUATION_ALREADY_ACTIVE` |

  Si todo pasa, `INSERT queued`. Tras el commit: `202 { evaluationId, status, statusUrl }` y `wake()`. [F3, F9]

  Ajustes en E3:
  - **Una sola evaluación activa, garantizada por la base:** un índice único parcial `evaluations (project_id) WHERE status IN ('queued','running')` [F35]. No depende del bloqueo, que PGlite no puede demostrar [F34]. El alta usa `tx.evaluation.create`, de modo que la colisión llega como P2002 [F33] y se traduce a `409 EVALUATION_ALREADY_ACTIVE`.
  - **Lectura del snapshot con `FOR SHARE`:** `deleteImport` lo bloquea con `FOR UPDATE`, así que una de las dos operaciones espera a la otra.
  - **Respuesta de `EVALUATION_COLUMN_MISSING`:** lleva un issue por atributo (`mapping.price`). Para ello el filtro global conserva los issues de ese código ([api-exception.filter.ts](../../../../src/common/http/api-exception.filter.ts), `CODES_WITH_ISSUES`).
  - **La moneda sale del snapshot:** se lee de `project_configuration` congelada en él, no de la configuración actual del proyecto.
- Repetir el POST crea otra evaluación; no hay idempotencia HTTP, igual que en la importación.
- `EvaluationWorker` copia el patrón de [`CatalogImportWorker`](../../../../src/catalog-import/catalog-import.worker.ts) [F10]:
  - sondeo con concurrencia 1;
  - `claim` con `FOR UPDATE SKIP LOCKED`;
  - al arrancar, los `running` pasan a `failed/EVALUATION_INTERRUPTED`;
  - cierre ordenado en `onModuleDestroy`.
- No se generaliza el trabajador de importación: hay dos consumidores, y extraerlo tocaría código ya verificado. Se reconsiderará con el trabajo de exportación (incremento 3).
- Proceso:
  1. leer la versión y `projectConfiguration` del snapshot;
  2. recorrer `catalog_rows` por páginas de 250 según `source_row`;
  3. evaluar e insertar cada lote esperando la escritura;
  4. en una transacción final, verificar los conteos (D7) y marcar `succeeded` con los conteos y el checksum.
- Ante un fallo, otra transacción marca `failed` y borra las filas parciales de esa evaluación.
- **R2:** `deleteProject` y `deleteImport` añaden en su transacción bloqueada la comprobación de evaluaciones activas que usan el proyecto o el snapshot, con `409 EVALUATION_IN_PROGRESS`. Es el único cambio previsto en `catalog-import`.

### D9 — Resultados en PostgreSQL, no en artefactos (desviación del diagrama 06)

**Aceptada por el usuario el 2026-10-31.** `docs-diagrams/06` se actualizó el 2026-11-01, durante E4 (el plan lo situaba en E3), para decir que filas y problemas de la evaluación viven en PostgreSQL.

- Tabla `evaluation_rows`, con las columnas:
  - `evaluation_id`, con FK y `ON DELETE CASCADE`;
  - `source_row`, `external_id`;
  - `outcome`;
  - `values JSONB`: atributos normalizados, incluido el precio normalizado;
  - `problems JSONB`: arreglo;
  - `excluded_by_rule INT NULL`.
- Clave `(evaluation_id, source_row)` e índice `(evaluation_id, outcome, source_row)`.
- `docs-diagrams/06` prevé filas y problemas en artefactos. Este plan se aparta por tres razones:
  - **Tamaño:** el volumen está acotado (5.000 filas, F8).
  - **Paginación:** el informe paginado por resultado necesita acceso indexado. [F12]
  - **R1:** un artefacto nuevo exige una carpeta, una política de referencias y una limpieza propias, y la conciliación entre archivo y SQL que ya costó en catalog-import. En cambio, filas y conteos se confirman en PostgreSQL y se borran en cascada.
- Los artefactos vuelven a ser necesarios para el TSV del incremento 3.
- `result_checksum`: SHA-256 de una serialización canónica propia (orden de claves fijo y filas por `source_row`). Permite comparar dos evaluaciones con las mismas entradas sin recorrerlas. [F1 RNF02]

### D10 — Consultas

- `GET /projects/:projectId/evaluations/:evaluationId` → `200` con:
  - estado, versiones (`snapshotId`, `revision`, `engineVersion`, `profileVersion`);
  - conteos y error público;
  - si está `succeeded`, una muestra de las primeras 20 filas por `source_row`.
- `GET …/evaluations/:evaluationId/rows?outcome=invalid&limit&offset` → informe paginado con `PaginationQueryDto` y un máximo de 100. [F12]
- `GET …/evaluations/:evaluationId/errors.csv?lang=es|en` → `errores.csv` (fila, producto, campo, problema y corrección sugerida) a partir de las filas inválidas. [F5] El idioma por defecto es `es`.
- Todas exigen el proyecto propio; los contenidos solo se sirven con `succeeded`. Ajustado en E4: filas y `errores.csv` responden `409 EVALUATION_RESULTS_UNAVAILABLE` si la evaluación no terminó bien, y el GET devuelve `{ evaluation, sample }` con una muestra vacía mientras tanto.

**Formato de `errores.csv`** (decidido el 2026-10-31 con la [ficha 06](../../../fonts/feature/rulesets&evaluations/06-csv-de-errores-owasp-y-rfc4180.md)):

- Cabecera presente y registros separados por CRLF. [F32]
- **Todas** las celdas van entre comillas dobles, y cada comilla interna se duplica. [F31, F32]
- Si una celda empieza por `=`, `+`, `-`, `@`, tabulador, CR, LF o sus variantes de ancho completo (U+FF1D, U+FF0B, U+FF0D, U+FF20), se le antepone un tabulador dentro de las comillas. Es la mitigación de OWASP resistente a Excel, recomendada para archivos de lectura humana. [F31]
  - Coste aceptado: un ID como `-123` aparece como `\t-123` **solo en este archivo**. La API JSON conserva el valor exacto, y el TSV del incremento 3 decidirá su propio escape.
- Las sugerencias de corrección son textos del perfil y no repiten el valor del catálogo. Así se reduce la cantidad de datos no confiables en el archivo.
- La serialización es una función pura y propia, sin dependencia nueva: `csv-parse` solo lee.
- Respuesta con estas cabeceras:
  - `Content-Type: text/csv; charset=utf-8; header=present` [F32];
  - `Content-Disposition: attachment; filename="errores-<evaluationId>.csv"`.
- **BOM UTF-8** (decidido en E4 con la [ficha 08](../../../fonts/feature/rulesets&evaluations/08-informe-bom-streamablefile-y-medicion.md), F36): Microsoft indica que Excel abre normalmente un CSV en UTF-8 «if it was saved with BOM». `errores.csv` empieza con `U+FEFF`. Queda pendiente abrirlo a mano en Excel o Numbers.

### D11 — Errores públicos

Los códigos nuevos van en [error-codes.ts](../../../../src/common/http/error-codes.ts) y [messages.ts](../../../../src/common/http/messages.ts), con texto es/en [F13]:

- **De reglas:** `RULESET_NOT_FOUND`, `RULESET_MAPPING_DUPLICATE`, `RULESET_REQUIRED_ATTRIBUTE_MISSING`, `RULESET_REFERENCE_INVALID`, `RULESET_REVISION_CONFLICT`.
  - Ajustado en E2: los tres de coherencia no van como código principal de la respuesta, sino como issues de un `400 VALIDATION_FAILED`, igual que los errores del DTO. El filtro global solo conserva issues con ese código y solo guarda `field` y `code`, así que el atributo va en `field`: `mapping.price` o `rules.2.color`.
  - Una revisión no numérica o fuera de rango responde `404 RULESET_NOT_FOUND`.
- **De evaluaciones:** `EVALUATION_NOT_FOUND`, `EVALUATION_SNAPSHOT_NOT_READY`, `EVALUATION_COLUMN_MISSING`, `EVALUATION_ALREADY_ACTIVE`, `EVALUATION_IN_PROGRESS`, `EVALUATION_INTERRUPTED`, `EVALUATION_PROCESSING_FAILED`, `EVALUATION_INTEGRITY_FAILED`.

Los recursos ajenos devuelven `404`, igual que en projects e imports.

### D12 — GraphQL

Fuera de este plan. Se añadirá en un plan `02` cuando REST esté verificado, siguiendo la capa separada existente. [F14]

### D13 — Pruebas

Detalle en «Comprobación prevista». Los DTO se prueban con `plainToInstance` + `validate` [RC3] y buscando el error por `property` dentro de `children` [RC4, RC5, C13]. El motor, sin Nest. La integración, con PGlite y el E2E, con dos propietarios, como en la feature anterior. [F15]

### D14 — Borrado

| Relación | Al borrar |
| --- | --- |
| `ruleset_versions` → `projects` | `ON DELETE CASCADE`: `deleteProject` ya borra el proyecto dentro de su transacción. |
| `evaluations` → snapshot | `ON DELETE CASCADE`. |
| `evaluations` → versión | `ON DELETE RESTRICT`: una versión no se borra sola. PostgreSQL responde `23001` (`restrict_violation`), no `23503` (comprobado en E3). |
| `evaluation_rows` → `evaluations` | `ON DELETE CASCADE`. |

Las evaluaciones activas bloquean ambos borrados (D8). No hay archivos que retirar (D9). Cuando el incremento 3 cree feeds que referencien evaluaciones, habrá que revisar estas cascadas.

## Incrementos

| Etapa | Cambios | Evidencia de cierre |
| --- | --- | --- |
| E1 — Dominio puro | Tipos `Rule` y `Mapping`, validación de referencias (D2, D4), perfil v1 y precio (D6), `evaluateRow` y conteos (D5, D7) en `src/evaluations/engine/`. Sin Nest ni base de datos. | Pruebas unitarias del motor en verde (lista abajo). |
| E2 — Rulesets | Migración `ruleset_versions`, DTO con despacho por `@Transform` (D3), repositorio con revisión bloqueada, servicio, controlador y códigos de error. La prueba previa E2.0 ya se hizo (ficha 05). | DTO probado; integración de revisiones concurrentes; E2E `201/400/404/409` con dos propietarios. |
| E3 — Evaluaciones | Migración `evaluations` + `evaluation_rows`, aceptación `202`, `EvaluationWorker`, finalización con comprobación, interrupción al arrancar y comprobación en `deleteProject`/`deleteImport`. Ajustado en E3: también `GET …/evaluations/:evaluationId` con estado, versiones, conteos, suma y error, para que `statusUrl` funcione desde el principio. | Integración de aceptación, finalización, fallo e interrupción; E2E desde el POST hasta `succeeded`. |
| E4 — Consultas e informe | Muestra en el GET de la evaluación, filas paginadas y `errores.csv` con el escape de D10. Medición con 5.000 filas. | E2E de consultas y propiedad; prueba unitaria del serializador CSV; medición registrada en la bitácora. Hecho en E4, salvo la apertura manual en una hoja de cálculo. |

E1 no depende de nada nuevo y define los tipos que usan E2 y E3; por eso va primero. Al empezar E1 se abre la entrada `01` de [la bitácora de la feature](../../../../bitacora-construccion/feature/rulesets&evaluations/).

## Comprobación prevista

**Unitarias del motor (E1):**

- Cada regla por separado, y su orden: `clean_text` antes y después de `build_title` da títulos distintos.
- `exclude_when` detiene el resto de reglas y la validación.
- Ninguna regla altera `id` ni `originalValues`.
- Para precios:
  - aceptados: `0.50`, `15`, `15.5 USD`;
  - rechazados: `1,50`, `1.234,50`, `$15`, `15.00 EUR` en un proyecto en USD, `0`, `1e3`;
  - la salida es siempre una cadena con dos decimales.
- NFC: `"é"` → `"é"`.
- Límites 150/5000/70 en el valor exacto y en +1.
- URL relativa y `javascript:`.
- Invariante de conteo con mezclas aleatorias fijadas por semilla.
- Misma entrada, misma salida y mismo checksum.

**DTO (E2)**, a partir de los casos de la [ficha 05](../../../fonts/feature/rulesets&evaluations/05-experimento-discriminador-y-validationpipe.md):

- Body válido mínimo, con la subclase correcta y `type` conservado.
- `type` desconocido, ausente, numérico, `"__proto__"` y `"constructor"`, rechazados en `rules.N.type`.
- Campo de otra subclase rechazado (`whitelistValidation`).
- Elementos `null`, cadena y arreglo en `rules` y en `mapping` → `400`, nunca `500`; comprobarlo también por HTTP en el E2E.
- Más de 20 reglas, mapeo vacío y atributo repetido.
- Plantilla con un marcador no mapeado.
- Siempre con `plainToInstance` y búsqueda en `children`. [RC3, RC4, RC5, C13]

**Integración con PGlite:**

- Dos guardados concurrentes dan revisiones 1 y 2; un P2002 forzado se traduce a `409`.
  - Comprobado en E2: con PGlite las transacciones se ejecutan una tras otra (base de una sola conexión con multiplexor), y la prueba de concurrencia pasa también sin `FOR UPDATE`. El bloqueo solo queda respaldado por F22 y por la restricción única hasta probarlo contra un PostgreSQL real. Lo mismo vale para E3 (`SKIP LOCKED`, evaluación activa única).
- FK compuestas: una evaluación con un snapshot o una versión de otro proyecto falla.
- `CHECK` de conteos.
- Fallo después de un lote: las filas quedan borradas y la evaluación `failed`.
- Reinicio con una evaluación `running`.
- Borrar un proyecto o una importación con una evaluación activa da `409`.

**E2E con Supertest y dos propietarios:**

- Recorrido completo: importar CSV, guardar reglas, evaluar, consultar el resultado, las filas y `errores.csv`.
- Bob recibe `404` en cada recurso de Alice.
- Snapshot no listo y columna ausente dan `409`.
- Esperar el estado terminal con un tiempo máximo acotado, sin `sleep` fijo.

**RNF02:** evaluar dos veces el mismo snapshot con la misma revisión y comparar el checksum y los conteos. [F1]

**Rendimiento:** medir la duración y la memoria de una evaluación de 5.000 filas con 20 reglas, y registrarlas sin fijar un objetivo inventado. No hay fuente ni medición previa. [ficha 04, vacíos]

Las suites existentes siguen como regresión, ejecutadas con `test:features`.

## Límites y continuidad

**Fuera del plan:**

- Exportación TSV y aprobación de exclusiones (incremento 3).
- GraphQL (plan `02`).
- Atributos `gtin`, `mpn`, `identifier_exists`, `availability_date` y envío, junto con las secciones de la especificación de Google que no se leyeron. [F19]
- Plantillas con columnas no mapeadas.
- Comparación sin distinguir mayúsculas en `exclude_when`.
- Monedas con 0 o 3 decimales.
- Reintentos, leases y varias réplicas (fase B).

**Revisar este plan si:**

- se actualiza `class-transformer` y su discriminador deja de fallar con `null` (repetir la ficha 05): entonces podría volverse al `@Type` declarativo;
- la medición de E4 muestra que las filas en PostgreSQL no escalan;
- la cuenta piloto usa una moneda sin dos decimales.
