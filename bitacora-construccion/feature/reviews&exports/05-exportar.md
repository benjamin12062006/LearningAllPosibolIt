# 05 — Exportar una evaluación revisada (E5)

Fecha de creación: 2026-11-01  
Última actualización: 2026-11-02 (etapa cerrada; defectos repetidos uno a uno tras el fallo del primer intento)  
Estado: Implementado y verificado en local. Migración creada y probada con PGlite; aplicada en Neon el 2026-11-02 a petición del usuario (`pnpm db:migrate`; después `pnpm db:status` → «Database schema is up to date!», 10 migraciones). La descarga del TSV y la retirada de archivos al borrar corresponden a E6.  
Ámbito: etapa E5 del [plan 01](../../../docs/plans/feature/reviews&exports/01-plan-reviews-y-exports.md): migración `exports`, repositorio, servicio, `POST /projects/:projectId/exports` y `GET …/exports/:exportId` (D1–D3, D7, D9, D10).  
Relacionada con: [plan 01](../../../docs/plans/feature/reviews&exports/01-plan-reviews-y-exports.md), [bitácora 04](04-modulo-de-artefactos.md), [bitácora 02](02-comprobar-la-aprobacion.md), [bitácora 01](01-serializador-tsv.md), [cursos y reconstrucciones](../../../docs/fonts/feature/reviews&exports/03-cursos-y-reconstrucciones.md) (RC1, RC4, RC5, RC6, C8, C10).  
Revisión de partida: `d5e8f54` con los cambios sin commit de E1–E4.

## Necesidad y punto de partida

El usuario pidió empezar E5. Tras E4: 29 suites y 535 pruebas en verde. Ya existían el serializador (E1), la comprobación de la aprobación (E2), el perfil nuevo (E3) y `writeExport` (E4).

No hizo falta investigación externa: el flujo sale de D7 y los patrones, del módulo de evaluaciones (`lockOwnedProject`, `FOR SHARE`, P2002 con `tx.model.create`).

## Evidencia y decisiones

| Decisión | Evidencia | Aplicación |
| --- | --- | --- |
| Tabla mínima con FK compuesta y cascada (D7, D11) | F2 inv. 1, F6, F7 (índice `evaluations (project_id, id)`), F23 | Migración `20261101000300_create_exports`; nombres de restricciones obtenidos con `prisma migrate diff` desde una copia del esquema; `CHECK` añadidos a mano. |
| Una exportación por evaluación; repetir devuelve la existente (D7) | — (propuesta del plan) | `UNIQUE (evaluation_id)`; el servicio busca la existente antes de generar y, si pierde la carrera, recibe `null` del repositorio (P2002), borra su archivo y devuelve la ganadora. |
| El archivo fuera de la transacción y completo antes de referenciarlo (D7) | F2 inv. 5, C10 | Comprobar → `writeExport` → transacción corta que repite D1–D3 con `FOR SHARE OF e, s` e inserta. Si la fila no se guarda, el archivo se borra. |
| No confiar en lo que manda el cliente (D2) | RC4 (l. 25), RC5 (l. 17) | El repositorio relee la evaluación y `assertCanExport` compara la aprobación dentro de la transacción. |
| La clave del archivo no sale del servidor (D9) | RC1, F3 | `ExportView` no incluye `artifact_key` ni la suma aprobada. |
| Estado `201` o `200` sin salirse del ciclo de vida de Nest (D9) | RC1 (l. 39), F22, C8 | `@Res({ passthrough: true })` solo para fijar el estado; Nest sigue enviando la respuesta. |
| Pruebas con raíz temporal y limpieza (D13) | RC6 (l. 31–39) | La integración y el E2E sobrescriben `ARTIFACT_STORE_OPTIONS` y vacían `exports/` antes de cada prueba. |

### Ajustes al escribir el código

- **`isProductValues` pasa al perfil.** Estaba como función privada en `evaluations.repository.ts`. La exportación también tiene que comprobar la forma de `product_values` al leerla de `jsonb`, así que se movió a [google-merchant.profile.ts](../../../src/evaluations/engine/google-merchant.profile.ts) y los dos repositorios la importan. Es el mismo código, sin cambios.
- **`assertCanExport`.** Envuelve `findExportBlocker` (E2) y lanza el error público, o `EVALUATION_NOT_FOUND` si la evaluación no existe o es de otro proyecto. Lo usan el servicio (antes de escribir el archivo) y el repositorio (dentro de la transacción).
- **`EXPORT_NOT_FOUND`** se creó en esta etapa, con texto es/en, como preveía el ajuste de E2.
- **Límite de los conteos del DTO:** se usa `IMPORT_LIMITS.rows` (5.000), con un comentario, en lugar de repetir la cifra.
- **`downloadUrl`** ya se devuelve (`…/exports/:id/productos.tsv`), aunque la ruta llega en E6.
- **El módulo no depende de `EvaluationsModule`.** Lee las tablas de evaluaciones con su propio repositorio, igual que evaluaciones lee las de importación. Lo explica un comentario en el módulo.
- **`TRUNCATE` deja archivos.** En el E2E, vaciar las tablas entre pruebas dejaba TSV huérfanos en `exports/`. Es la situación que retirará la limpieza de E6. En las pruebas se resuelve vaciando la carpeta en `beforeEach`.

## Implementación y funcionamiento

| Decisión | Archivo y símbolo | Detalle |
| --- | --- | --- |
| D7 | [migration.sql](../../../prisma/migrations/20261101000300_create_exports/migration.sql), [schema.prisma](../../../prisma/schema.prisma) `Export` | 11 columnas, `CHECK` de sumas, clave `.tsv`, conteos y total ≤ 5.000; `UNIQUE` en `evaluation_id` y `artifact_key`; FK compuesta en cascada. |
| D1–D3 | [exports.repository.ts](../../../src/exports/exports.repository.ts), `findEvaluationToExport`, `evaluationToExportQuery` | Una consulta para la lectura previa y la bloqueada (con `FOR SHARE OF e, s`). `hasNewerEvaluation` con `EXISTS` sobre `(created_at, id)` y estados `queued`, `running` y `succeeded`. |
| D4 | mismo archivo, `findValidRows` | Solo `outcome = 'valid'`, por `source_row`; forma comprobada con `isProductValues`. |
| D7 | mismo archivo, `insert` → `insertChecked` | Repite la comprobación, inserta con `tx.export.create` y traduce P2002 a `null`. |
| D7 | [exports.service.ts](../../../src/exports/exports.service.ts), `create`, `generateAndSave`, `save`, `discardFile`, `requireExisting` | `create` se lee como lista de pasos. `save` es la única función con `try/catch` sobre el guardado; `discardFile`, la única que traduce un fallo al borrar en un registro. |
| D9 | [exports.controller.ts](../../../src/exports/exports.controller.ts) | `POST` (201/200) y `GET :exportId`. |
| D2 | [exports.dto.ts](../../../src/exports/exports.dto.ts) | UUID, suma `^[a-f0-9]{64}$` y conteos enteros entre 0 y 5.000. |
| D10 | [error-codes.ts](../../../src/common/http/error-codes.ts), [messages.ts](../../../src/common/http/messages.ts) | `EXPORT_NOT_FOUND` (404). |
| Cableado | [exports.module.ts](../../../src/exports/exports.module.ts), [app.module.ts](../../../src/app.module.ts) | Importa `ArtifactsModule`, `AuthModule`, `PrismaModule`, `ProjectsModule` y `UsersModule`. |

Líneas, como dato: los seis archivos nuevos de `src/exports/` de esta etapa y la migración suman 585.

## Comprobación

| Comando o prueba ejecutada | Resultado observado |
| --- | --- |
| [exports.int-spec.ts](../../../test/features/exports/exports.int-spec.ts) (PGlite, Nest con `ExportsModule`) | 19 pruebas: lectura con versiones, conteos y suma; `null` desde otro proyecto u otro propietario; evaluación posterior en cola la reemplaza y fallida no; solo filas válidas en orden; TSV escrito con suma igual a los bytes; segunda petición sin volver a escribir (`writeExport` no se llama); fallo al guardar borra el archivo; carrera ganada por otra petición devuelve la existente y deja un solo archivo; la transacción repite la comprobación; FK compuesta (`23503`); siete `CHECK` (`23514`); unicidad por evaluación; cascada al borrar el snapshot. |
| [exports.e2e-spec.ts](../../../test/features/exports/exports.e2e-spec.ts) (Supertest, dos propietarios) | 13 pruebas: recorrido evaluar → leer → exportar `201` → consultar; la respuesta no contiene el nombre del archivo; el TSV solo tiene SKU-1 y SKU-4 (válidos); repetir → `200` con la misma exportación; `400` con los cuatro campos inválidos y con body vacío; `409` por aprobación distinta (sin dejar archivo), sin válidos, reemplazada, perfil antiguo y sin terminar; `404` para Bob en el proyecto de Alice (`PROJECT_NOT_FOUND`) y desde su proyecto (`EVALUATION_NOT_FOUND`, `EXPORT_NOT_FOUND`); evaluación y exportación inexistentes; `400` con id no UUID; `401` sin sesión. |
| Defectos introducidos a propósito, uno por uno, con un script de Python que guarda cada archivo en memoria, aplica un cambio, ejecuta integración y E2E de exportaciones, restaura y comprueba que el archivo queda idéntico byte a byte | Una evaluación posterior terminada no reemplaza → 1 fallo. Sin repetir la comprobación en la transacción → 1. No borrar el archivo si falla el guardado → 1. No buscar la existente antes de generar → 2. Responder siempre 201 → 1. FK con `RESTRICT` → 1. Leer las filas inválidas → 3. DTO sin patrón de la suma → 1. Antes y después: 32 de 32 en verde. |
| Comprobación esquema-migraciones (base PGlite con todas las migraciones y `prisma migrate diff --from-config-datasource --to-schema`, con `execFile` asíncrono) | «This is an empty migration». Control: sin `@unique` en `evaluationId`, el diff propone `DROP INDEX "exports_evaluation_id_key"`; esquema restaurado e idéntico. |
| Arranque real de `AppModule` (PGlite, Descope simulado, trabajos detenidos, raíz temporal) | `POST …/exports` y `GET …/exports/:id` → `401` sin sesión, igual que las rutas existentes; carpetas `artifacts`, `exports` y `tmp`. `.data/catalog-import` sin cambios (fechas del 26 de octubre). |
| Cobertura de `src/exports/` con sus suites | 95 % de líneas y 96 % de ramas. Sin cubrir: `toExportableRow` con forma inválida, el `catch` de `discardFile` y el error de `requireExisting`. |
| `./node_modules/.bin/tsc -p tsconfig.json --noEmit` | Sin errores. |
| `pnpm lint` (`oxlint --type-aware src/`) | Sin avisos, salida 0. |
| `./node_modules/.bin/prettier --check src test/features` | Todo con el estilo de Prettier. |
| `pnpm test:features` | 31 suites y 568 pruebas en verde (535 previas, 32 nuevas y 1 de `messages.spec.ts` por el código nuevo). |
| `pnpm db:verify` | 3 de 3, con la migración nueva en la lista de `test/prisma-migrations.test.mjs`. El conteo de `projects.repository.int-spec.ts` pasó de 9 a 10. |

**Incidencias:**

1. **Primer intento de los defectos, inválido.** Las rutas iban en una sola variable de zsh (`$FILES`), que no se separa en palabras (trampa 1 del traspaso). No se guardó ninguna copia y ningún defecto se deshizo: los ocho se acumularon en el código y sus recuentos no valen. El usuario pidió repetirlo. Se comprobó cada punto con `grep`, se restauraron los ocho a mano (32 de 32 en verde) y se repitió todo con el script de Python descrito arriba.
2. **El defecto «no buscar la existente» no compilaba.** Las variantes `null ?? …` y `(null as …) ?? …` dan `TS2871` (expresión siempre nula). Se usó `await Promise.resolve<…>(null) ?? …`. El script informa «no compila» en lugar de detenerse.
3. **Integración sin Descope.** `ExportsModule` importa `AuthModule`; la prueba de integración necesitó un doble vacío de `DescopeService`.
4. **Prueba E2E mal planteada.** La primera versión buscaba `.tsv"` en la respuesta para comprobar que no salía la clave interna, y chocaba con `downloadUrl`. Ahora se busca el nombre real del archivo guardado.

**No verificado:**

- **Concurrencia real.** El bloqueo `FOR SHARE` frente a los borrados y la carrera de dos POST simultáneos contra PostgreSQL. PGlite ejecuta las transacciones una tras otra; la carrera se simuló con un espía.
- **La migración en Neon:** pendiente de que el usuario ejecute `pnpm db:status` y `pnpm db:migrate`.
- **La descarga del TSV y la retirada de archivos** al borrar proyectos o importaciones (E6).

## Consecuencias y continuidad

- La API ya exporta: el operador aprueba lo que leyó y recibe la exportación y su `downloadUrl`.
- Hasta E6, un TSV de una evaluación borrada en cascada queda en `exports/` sin referencia (no hay limpieza de esa carpeta).
- E6: ruta de descarga con apertura previa, retirada de archivos en `deleteSnapshot` y `deleteProject`, y limpieza de huérfanos de `exports/` al arrancar.
- Cambios de esta etapa, sin commit: `src/exports/` (repositorio, servicio, controlador, DTO, tipos, módulo y `assertCanExport`), `prisma/schema.prisma`, la migración nueva, `src/app.module.ts`, `isProductValues` movido al perfil, `EXPORT_NOT_FOUND`, las dos pruebas nuevas, la lista de migraciones y el conteo de migraciones.
