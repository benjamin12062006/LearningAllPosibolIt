# 02 — Lectura explícita de common/http sin cambiar su contrato

Fecha de creación: 2026-10-28
Estado: Implementado y verificado
Ámbito: Presentación del código TypeScript de la base HTTP
Relacionada con: [plan 02](../../docs/plans/errors/02-legibilidad-common-http.md), [fuentes 02](../../docs/fonts/types/02-legibilidad-common-http.md), [constantes anteriores](01-constantes-y-tipos-de-error.md), [contrato bilingüe](../settings/11-mensajes-y-errores-bilingues.md)
Revisión de partida: `a551ed8b647a2ac276e23f8c3aaf2d621d5ebe35`, con los archivos actuales añadidos al índice por trabajo anterior.

## Intención

El usuario considera correcta la solución y pide priorizar al desarrollador que
debe leerla. Se reorganizarán decisiones y nombres dentro de common/http,
conservando la funcionalidad que utiliza el resto de módulos.

La investigación consultó las tres secciones de arquitectura indicadas y el curso
de Maximilian. La [ficha](../../docs/fonts/types/02-legibilidad-common-http.md)
documenta los pasajes, la reconstrucción nueva de la lección 93 y los antecedentes
de constantes ya verificados. El plan se creó antes de modificar la aplicación.

## Estado de partida recuperable

Se leyeron la conversación adjunta, los siete módulos actuales, sus tests y los
planes/bitácoras anteriores. El contenido de partida coincidía con estos blobs
del índice Git; HEAD todavía no contenía esa implementación:

| Archivo | Blob de partida |
| --- | --- |
| api-exception.filter.ts | `8e8c10d9da1254c024c0a068b44fbd7262843a98` |
| public-error.ts | `9fa20ea1374501d2964da4d42ea7bbaf08dad378` |
| transport-errors.ts | `a7e6cc888c5cc9b3a5ab3426977bb14b48a4312a` |
| validation-errors.ts | `ebae844ab9336195e5d7cbb1a02d08405f187c52` |
| api-error.ts | `51be738566fe20fa48d27f992d84163ddde0e94a` |

Se conservó además una copia temporal del código antes de editar para usarla como
oráculo diferencial. No se hizo commit, staging ni modificación de módulos
consumidores. Las entradas anteriores no se reescribieron como si hubieran
justificado esta nueva presentación.

## Evidencia y decisión aplicada

La [ficha 02](../../docs/fonts/types/02-legibilidad-common-http.md) contiene
originales, localizadores y sus límites. F1/F2 fundamentan nombres expresivos;
F3 propone simplicidad y retornos que reducen anidación, sin convertir un límite
de líneas en norma. F4/F5 aclaran SRP como procesos relacionados, no un método por
clase. F6/F7 respaldan conservar responsabilidades y dirección de imports, sin
añadir capas por seguir un diagrama. F8/R1 de Maximilian muestra el guard con
nombre; la adaptación a unknown mantiene comprobaciones de runtime.

Se eligieron helpers privados junto a sus llamadas, condiciones directas y
restricciones nombradas. Se descartaron nuevas librerías, wrappers, dispatch
genérico, clases adicionales y un archivo por condición. Las traducciones siguen
siendo datos explícitos, sin comprimirlas para reducir artificialmente las líneas.

## Implementación y funcionamiento

| Área | Lectura final y razón |
| --- | --- |
| [ApiExceptionFilter.catch](../../src/common/http/api-exception.filter.ts) | Lee request/response, obtiene detalles, resuelve código, recoge incidencias, registra si corresponde y envía. El detalle de inspección no está mezclado con ese recorrido. |
| `getExceptionDetails` | Trata HttpException, ApplicationFailure y fallo inesperado con ramas explícitas. Conserva estado Nest, estado del catálogo y fallback 500. |
| `resolveErrorCode` y `fallbackCodesByStatus` | Prioriza un código conocido; si falta, usa el mapa por estado y finalmente HTTP_ERROR. El nombre del mapa explica que no es la fuente de los códigos de negocio. |
| `readValidationIssues` e `isValidationIssue` | Hace visibles las dos categorías con incidencias permitidas, descarta entradas sin forma válida y recompone cada mensaje desde el catálogo. El predicado describe únicamente los campos comprobados. |
| [localizeStoredError](../../src/common/http/public-error.ts) | El recorrido principal distingue ausencia, código conocido/fallback y contexto permitido. `readStoredErrorContext` concentra sourceRow, field y requestId; `isSourceRow` permite quitar las aserciones `as number`. |
| [transportErrors](../../src/common/http/transport-errors.ts) | Un guard deja pasar entradas sin tipo de parser. El switch muestra las cuatro variantes técnicas y sus tres códigos públicos. Se explica su pertenencia a Express, sin cambiar el registro del middleware. |
| [validationIssues](../../src/common/http/validation-errors.ts) | El recorrido recolecta y deduplica incidencias; `validationErrorCode` reúne las reglas generales/específicas y `compareValidationIssues` expresa orden por campo y código con if sucesivos. |
| [apiError](../../src/common/http/api-error.ts) y fábricas de pipes | El cuerpo añade issues mediante un if visible. Se conservó el switch de clases Nest, que ya expresa la elección con claridad. Las fábricas de validación ahora tienen declaraciones y bloques explícitos. |

Los límites 128 se nombraron según su uso: longitud de campo de incidencia, de
contexto guardado y de ruta de validación. No se añadió configuración ni cambió
su valor. La ordenación sigue usando comparación de strings de JavaScript; no se
introdujo localeCompare, que podría cambiar la secuencia para acentos y mayúsculas.

### Cómo seguir el filtro

El primer detalle que necesita el lector es el resultado de tres decisiones:

```ts
const { status, body } = getExceptionDetails(error);
const code = resolveErrorCode(body.code, status);
const issues = readValidationIssues(code, body);
```

Después se ve la parte con efectos: logging, respuesta ya enviada y construcción
del cuerpo. Solo hace falta abrir el helper relevante cuando se quiera revisar
una política concreta. Los helpers permanecen en el mismo archivo y no se exportan.

### Qué significa aquí «más legible»

`catch` pasó de 54 a 25 líneas, medidas sobre el método real con el parser de
TypeScript. El archivo completo pasó de 88 a 129 y el conjunto common/http de
613 a 694: las condiciones y pasos antes compactados ahora ocupan bloques
explícitos. Estas cifras describen el cambio; no prueban por sí solas legibilidad.

Se revisó que los nombres permitan predecir la tarea y que el método principal
no inspeccione campos arbitrarios en su propio bloque. La comodidad concreta
para el usuario sigue pendiente de su lectura; no se declara validada por tests.

## Comprobaciones ejecutadas

| Comprobación | Resultado observado |
| --- | --- |
| Skill de reconstrucción, lección 93 | Draft, render, lectura completa, verify e install correctos. Una guía nueva, tres originales/contextos verificados por hashes y frases, sin sobrescrituras. La guía declara el esqueleto de IO ausente; no se ejecutó el curso. |
| `pnpm build` | Prisma generate y compilación Nest correctos. |
| `pnpm lint` | Oxlint con tipos correcto. |
| `pnpm format:check` | Correcto. |
| `pnpm test:features` | 11 suites, 180 casos correctos; pruebas anteriores sin modificar. |
| `node --test test/*.test.mjs` | 11 regresiones correctas. |
| Harness diferencial temporal con TypeScript y dependencias reales | 951 comparaciones antes/después correctas. Mismas exportaciones, clases de excepción, estados, cuerpos, logging y contexto normalizado para las entradas examinadas. |
| Comparación de archivos de datos | messages.ts y error-codes.ts idénticos al inicio, incluidos sus 54 códigos, textos y tipos derivados. |
| Diff de código y verificación documental | Solo los cinco archivos previstos cambiaron; sin cambios en tests, features consumidoras, configureHttp, dependencias o configuración. Fechas, enlaces, secuencia 02 y whitespace comprobados al cerrar. |

El harness cargó por separado la copia inicial y la fuente nueva transpiladas con
el compilador instalado. Comparó los 54 códigos con y sin incidencias; JSONB con
filas inválidas, límites numéricos y textos largos; valores desconocidos; estados
HTTP estándar/adicionales; ApplicationFailure; incidencias inválidas, heredadas y
arrays con propiedades; passthrough y traducción del parser; reglas de validación,
deduplicación, anidación, acentos y array disperso. También comparó errores
lanzados por entradas fuera del contrato, sin corregirlos dentro de este trabajo.
La comparación cubre ese conjunto concreto; no es una prueba formal de todo JavaScript.

Se conservaron los casos previos de validación y no se añadieron suites permanentes
que duplicaran la implementación. Los sockets locales se ejecutaron con permiso
del entorno; las pruebas usan PostgreSQL temporal, disco y HTTP locales. No se
cargaron credenciales ni se consultaron Descope o Cloud SQL. Node disponible:
26.9.0; TypeScript 6.0.3. No se cambiaron los engines del proyecto.

## Resultado y límites

El [plan 02](../../docs/plans/errors/02-legibilidad-common-http.md) está ejecutado.
Se conserva el contrato público, los imports anteriores, la correlación, los
mensajes bilingües y la normalización histórica. No se modifican features, frontend,
persistencia, rutas ni respuestas exitosas.

El incremento mejora la presentación del código dentro de la solución existente.
No afirma que lo anterior estuviera funcionalmente mal ni que esta sea la única
forma correcta de escribirlo. Si la lectura del usuario encuentra un nombre o
paso todavía poco claro, esa observación será evidencia para el siguiente ajuste.
