# 05 — Hacer legibles auth, users, projects, catalog-import y graphql sin cambiar su comportamiento

Fecha de creación: 2026-10-30
Última actualización: 2026-10-30
Estado: Ejecutado y verificado el 2026-10-30. Ver la [bitácora 04](../../../../bitacora-construccion/feature/projects&catalog-import/04-legibilidad-modulos.md).
Ámbito: `src/auth`, `src/users`, `src/projects`, `src/catalog-import`, `src/graphql` y `src/database`; `src/common` ya se trató en el [plan errors/02](../../errors/02-legibilidad-common-http.md).
Relacionada con: [fuente 07](../../../fonts/feature/projects&catalog-import/07-legibilidad-modulos-clean-code.md), [fuente types/02](../../../fonts/types/02-legibilidad-common-http.md), [bitácora types/02](../../../../bitacora-construccion/types/02-legibilidad-common-http.md), [bitácora settings/15 (capa GraphQL)](../../../../bitacora-construccion/settings/15-separar-capa-graphql.md).
Revisión de referencia: `1f0be2d` (commit guardado antes de este trabajo; sirve de oráculo).

## Objetivo

Que una persona pueda abrir cualquier archivo de estos módulos y seguirlo de arriba abajo: la función principal muestra los pasos con nombres que explican la intención y el detalle está debajo, en funciones cuyo nombre lo justifica. El comportamiento (rutas, respuestas, códigos de error, SQL ejecutado, esquema GraphQL) no cambia. Se reconoce completo cuando:

- las 203 pruebas existentes, `db:verify`, `users:verify` y `route-wiring` siguen pasando sin modificar sus aserciones;
- un arnés diferencial temporal da los mismos resultados con el código de `1f0be2d` y con el nuevo en las funciones puras modificadas;
- el esquema GraphQL coincide con `schema.expected.graphql`.

## Punto de partida

Tras leer todos los archivos de los módulos (unas 2.100 líneas sin `common`):

| Módulo | Qué cuesta leer |
| --- | --- |
| auth, users, projects, catalog-import | Cada controlador REST repite su propia comprobación de identidad (`requireIdentity`, `identityOf`) aunque ya existe `@CurrentIdentity()`. Imports mezclados: `ErrorCodes` primero y `apiError` al final. |
| users | `LocalUser` y `UserProjection` son el mismo tipo; `toLocalUser` copia campo a campo; la lista de columnas `RETURNING` se repite tres veces. |
| projects | Condiciones largas sin nombre: «configuración completa» (en dos sitios), «cambia la configuración», `fields`/`count` en `update`. `@ValidateIf` repetido cuatro veces. SQL con sangría irregular. |
| catalog-import · repository | SQL en una sola línea, sin espacios tras las comas, y tipos de fila escritos dentro de los genéricos. El chequeo de integridad de `complete` es una condición de cuatro partes sin nombre. |
| catalog-import · service | `accept` mezcla construir la aceptación, sanear el nombre del archivo (bucle de caracteres en línea), guardar el archivo y un `try/catch` anidado de tres niveles. |
| catalog-import · worker | `consume` hace bucle, registro de error, ternario anidado y reintento en el mismo bloque; `process` repite dos condiciones de «lote lleno». |
| catalog-import · csv-parser | Un generador de 130 líneas que valida cabeceras, filas, identificadores y traduce errores, con `as string[]` tras una comprobación en línea. |
| catalog-import · interceptor | La comprobación del formulario y la configuración de multer están en línea dentro del flujo. |
| graphql | Correcto tras la bitácora 15; `formatError` tiene la normalización en línea dentro de la configuración. |
| database | Una condición de TLS de dos niveles sin nombre. |

Restricciones: los tests importan archivos y símbolos por su ruta (`CatalogImportRepository`, `parseCatalogCsv`, `ProjectsService.requireConfigured`, `UsersRepository`, `LocalUser`…). No se renombran archivos ni exports públicos. `route-wiring` exige `@UseGuards` por método en `UsersController`.

## Fuentes y decisiones

Criterios de la [fuente 07](../../../fonts/feature/projects&catalog-import/07-legibilidad-modulos-clean-code.md) (G1–G11, R1) y de la [types/02](../../../fonts/types/02-legibilidad-common-http.md) (F1–F9):

| Decisión | Fuente | Se descarta |
| --- | --- | --- |
| `@CurrentIdentity()` en todos los controladores REST (el decorador ya funciona en HTTP y GraphQL) | G11, R1 | Mantener `@Req()` + helper en cada controlador |
| Funciones principales que orquestan; condiciones de bajo nivel en funciones con nombre en positivo | G3, G4, G7, F2, F3 | Reducirlo todo a una línea o a cadenas `filter/map/reduce` |
| Predicado `hasCompleteConfiguration(project): project is ConfiguredProject`, que elimina la copia manual de `requireConfigured` | F8/R1, F9 | Aserciones `as` |
| El `try/catch` como tarea propia (`recordAcceptance`, `recordFailure`) | G8 | Anidar `try` dentro de `catch` |
| Orden uniforme: imports externos y luego del proyecto; constructor, públicos en orden de uso, privados debajo; SQL en varias líneas | G2, G9 | Imponer un orden alfabético |
| Tipos de fila con nombre al principio del repositorio | G3, F1 | Tipos en línea dentro de `$queryRaw<…>` |
| Un objeto `ImportBatch` dentro del worker para el estado del lote | G5 (l. 23–27: reestructurar en lugar de extraer funciones sueltas) | Dos funciones que solo renombran la condición |
| Comentarios solo para el porqué | G10, G1 | Comentarios que repiten el código |
| Ningún archivo, capa ni librería nueva; mismos nombres públicos | G5, F6, F7 | Separar el repositorio en dos o mover archivos (rompería imports de los tests sin aportar lectura) |

## Incrementos

1. **Identidad en REST.** `AuthController`, `UsersController`, `ProjectsController` y `CatalogImportController` reciben `@CurrentIdentity() identity`. Se borran `requireIdentity` e `identityOf`. Se actualiza el comentario del decorador: sirve para HTTP y GraphQL. `UsersController` conserva `@UseGuards` por método.
2. **auth y users.** Imports ordenados; en el guard, `buildIdentity` sustituye el spread condicional. En `UsersRepository`: un único tipo `LocalUser`, una constante `USER_COLUMNS` para la proyección y `rows[0] ?? null` en lugar de `toLocalUser`.
3. **projects.** `hasCompleteConfiguration` en `projects.types.ts` (usado por `toProject`, `requireConfigured`); `changesConfiguration` y `countConfigurationFields` con nombre; `whenPresent` para los `@ValidateIf` del DTO; SQL con sangría uniforme.
4. **catalog-import · repository.** Tipos de fila con nombre, SQL en varias líneas, `matchesParsedFile` para la integridad y `toListedImport` para el mapeo del listado. Mismas consultas y mismos parámetros.
5. **catalog-import · service, guard e interceptor.** `accept` = construir aceptación → mover el archivo → registrar en la base → despertar al worker → responder. `safeOriginalName` con `isUnsafeFileNameCharacter`; `recordAcceptance` concentra la recuperación. En el interceptor, `isImportForm`, `UPLOAD_LIMITS` y `translateUploadError`. En el guard, `readProjectId`.
6. **catalog-import · worker y parser.** `consume` = reclamar → procesar → registrar el fallo. `failureDetail` con `if` en lugar del ternario anidado y `logUnexpectedError` aparte. `ImportBatch` con `wouldOverflow`, `isFull`, `add` y `take`. En el parser: `isStringRecord` (predicado), `assertValidHeaders`, `toImportRow` y `toImportFailure` para la traducción de errores.
7. **graphql y database.** `normalizeApolloError` fuera de la configuración; `requiresTls` en `database-connection.ts`.
8. **Comprobación y bitácora.** Arnés diferencial, pruebas, arranque real y [bitácora 04](../../../../bitacora-construccion/feature/projects&catalog-import/04-legibilidad-modulos.md).

## Comprobación prevista

- `pnpm format:check`, `pnpm build`, `pnpm lint`, `pnpm test:features`, `db:verify`, `users:verify`, `route-wiring`; arranque real contra Neon.
- Arnés diferencial temporal (en el scratchpad, sin añadir suites): carga el código de `1f0be2d` y el nuevo y compara:
  - `parseCatalogCsv` con un conjunto de CSV válidos e inválidos (cabeceras, filas, ids, codificación, límites, BOM, separador);
  - el saneado de `originalName` con caracteres de control, barras y nombres largos;
  - `toProject`/`requireConfigured` con configuraciones completas e incompletas;
  - la secuencia de lotes del worker con filas de distintos tamaños.
- Revisión de lectura: cada función principal se entiende leyendo solo los nombres de los pasos.

## Límites y continuidad

- `src/common` no se toca salvo que algún import lo exija.
- Cuánto mejora la lectura es en parte subjetivo; la valoración final es del usuario. Las pruebas solo demuestran que el comportamiento no cambió.
- El [plan db/03 de eliminación](../../db/03-plan-eliminacion-de-datos.md) se implementa después, ya sobre el código reorganizado.
