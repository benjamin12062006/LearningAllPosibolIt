# 04 — Código legible en auth, users, projects, catalog-import y graphql

Fecha de creación: 2026-10-30
Estado: Implementado y verificado
Ámbito: presentación del código de `src/auth`, `src/users`, `src/projects`, `src/catalog-import`, `src/graphql` y `src/database`; sin cambios de comportamiento.
Relacionada con: [plan 05](../../../docs/plans/feature/projects&catalog-import/05-plan-legibilidad-modulos.md), [fuente 07](../../../docs/fonts/feature/projects&catalog-import/07-legibilidad-modulos-clean-code.md), [fuente types/02](../../../docs/fonts/types/02-legibilidad-common-http.md), [bitácora types/02 (common/http)](../../types/02-legibilidad-common-http.md).
Revisión de partida: `1f0be2d` (commit guardado justo antes, usado como oráculo).

## Necesidad

El usuario pidió que el resto de los módulos se pudiera leer y mantener como ya ocurre con `src/common`: código para personas, sin buscar la máxima abstracción sintáctica y sin romper lo que funciona. Pidió además revisar la capa GraphQL.

## Evidencia y decisiones

La [fuente 07](../../../docs/fonts/feature/projects&catalog-import/07-legibilidad-modulos-clean-code.md) añade once lecciones a las de la ficha types/02 y una reconstrucción nueva (R1, lección 177 de Nest). Se aplicaron así:

| Criterio | Fuente | Dónde se ve |
| --- | --- | --- |
| La función principal orquesta pasos; el detalle va en funciones cuyo nombre lo explica | G3, G4 | `CatalogImportService.accept`, `CatalogImportWorker.processClaimedJob`, `parseCatalogCsv` |
| Condiciones con nombre y en positivo | G7, F2 | `hasCompleteConfiguration`, `changesConfiguration`, `isActiveJob`, `matchesParsedFile`, `isImportForm`, `isTextRecord`, `requiresTls`/`usesTls` |
| Predicado de tipo en lugar de copiar campos o usar `as` | F8/R1, F9 | `hasCompleteConfiguration(project): project is …` en `requireConfigured` y `accept`; `isTextRecord` quita el `as string[]` del parser |
| Un `try/catch` por función | G8 | `moveToArtifacts`, `recordAcceptance`, `checkAcceptanceExists`, `removeUnreferencedArtifact`, `saveFailure` |
| Reestructurar con un objeto en vez de extraer funciones que solo renombran | G5 (l. 23–27) | `ImportBatch` (estado del lote) en el worker |
| Decorador de parámetro para el usuario autenticado; 500 si falta | G11, R1 | `@CurrentIdentity()` en los cuatro controladores REST |
| Leer de arriba abajo, el mismo orden en todos los archivos | G2, G9 | imports externos y luego del proyecto; constructor, públicos, privados; funciones auxiliares debajo de la clase; SQL en varias líneas |
| Comentarios solo para el porqué | G10, G1 | bloqueos `FOR UPDATE`, `SKIP LOCKED`, NUL en PostgreSQL, patrón de las claves de artefacto, códigos de diagnóstico |

**Descartado:** dividir `CatalogImportRepository` en dos (API y worker) o mover archivos. Los tests importan por ruta y nombre, y la división no ayudaba a leer más que separar el archivo en dos bloques. Tampoco se añadieron librerías, capas ni un archivo por condición (G5, F6, F7).

## Cambios por módulo

- **auth:** `AuthController` usa `@CurrentIdentity()`. En el guard, `buildIdentity` sustituye el spread condicional. El comentario del decorador explica que sirve para HTTP y GraphQL y por qué responde 500.
- **users:** el controlador usa `@CurrentIdentity()` (conserva `@UseGuards` por método, que `route-wiring` comprueba). El repositorio tiene un único tipo `LocalUser` y la constante `USER_COLUMNS`; desaparecen `UserProjection` y `toLocalUser`, que copiaba los mismos cinco campos.
- **projects:** `hasCompleteConfiguration` y `ChannelProfile` en `projects.types.ts`; `assertUpdateIsValid` y `countConfigurationFields` en el servicio; `changesConfiguration` y `PROJECT_COLUMNS` en el repositorio; `whenPresent`, `trimAndUppercase` y `CHANNEL_PROFILES` en el DTO.
- **catalog-import:**
  - Repositorio: tipos de fila con nombre al principio y SQL en varias líneas, separado en dos bloques (peticiones del propietario y trabajo del worker), con `toListedImport`, `readSample`, `isActiveJob` y `matchesParsedFile`.
  - Servicio: `accept` en cinco pasos; el saneado del nombre del archivo va en `safeOriginalName`.
  - Worker: `ImportBatch`, `failureDetail` (sustituye al ternario anidado), `logUnexpectedError` y `diagnosticFields`; un `switch` sobre los eventos del parser.
  - Parser: `createRecordParser`, `readFields`, `assertValidHeaders`, `findIdColumn`, `assertRowFits`, `assertNewExternalId`, `toImportRow` y `toImportFailure`.
  - Interceptor: `UPLOAD_LIMITS`, `isImportForm`, `translateUploadError` y `streamingStorage`. Guard: `readProjectId`. `ArtifactStore`: `ARTIFACT_KEY_PATTERN`, `pathOf` e `isMissingFile`. Tipo `ImportDelimiter` en lugar de repetir `'comma' | 'semicolon'`.
- **graphql:** `normalizeApolloError` sale de la configuración de Apollo con un comentario de qué errores trata; resolvers y tipos ya estaban claros tras la [bitácora settings/15](../../settings/15-separar-capa-graphql.md).
- **database:** `requiresTls` y `usesTls` en `database-connection.ts`.

Cómo se lee ahora la aceptación de una importación:

```ts
const acceptance = buildAcceptance(ownerId, projectId, upload, fields, requestId);

await this.moveToArtifacts(upload, acceptance);
await this.recordAcceptance(acceptance);
this.worker.wake();
```

El número de líneas sube (de 780 a 1.321 líneas cambiadas en 23 archivos; el repositorio pasa de 310 a 469). Es lo esperado: el SQL en una línea pasa a una columna por línea y cada condición gana un nombre. No se tomó el número de líneas como criterio.

## Comprobación

| Comprobación ejecutada | Resultado |
| --- | --- |
| `pnpm format:check`, `pnpm build`, `pnpm lint` | Correctos |
| `pnpm test:features` | 203 pruebas en 14 suites correctas, sin cambiar ninguna aserción |
| `route-wiring`, `db:verify`, `users:verify` | 1, 3 y 8 correctas |
| Arnés diferencial temporal (`.test-build/legibilidad-diff`, borrado al terminar) | 263 comparaciones iguales entre `1f0be2d` y el código nuevo |
| Control del arnés | Al cambiar a propósito una condición de la copia nueva detectó 6 diferencias; al restaurarla, 0 |

El arnés compiló las dos versiones con el mismo `tsconfig` y comparó:
- `parseCatalogCsv` con 42 entradas (cabeceras, filas, ids, NUL, comillas, UTF-8 partido y truncado, 5.000/5.001 filas, más de 10 MiB, registro de más de 1 MiB, ENOENT/EACCES/EIO, cancelación);
- el worker con 14 CSV (lotes por filas y por bytes, CSV inválido y `appendBatch` fallando), comparando lotes, registros de error y fallos guardados;
- `CatalogImportService.accept` con 7 nombres de archivo y 7 escenarios de fallo;
- `ProjectsService.update` y `requireConfigured`;
- el SQL y los parámetros de los repositorios de proyectos, importaciones y usuarios (espacios normalizados);
- el guard de sesión con 64 combinaciones de cabecera y token;
- `resolveDatabaseConnection` con 14 URL.

Cubre esos casos concretos; no es una prueba formal de equivalencia. La valoración de si se lee mejor corresponde al usuario.

## Continuidad

- El [plan db/03 de eliminación](../../../docs/plans/db/03-plan-eliminacion-de-datos.md) se implementa a continuación sobre este código ([bitácora 05](05-eliminar-proyectos-e-importaciones.md)).
- Pendiente de la bitácora settings/13: probar GraphQL con una sesión real de Descope.
