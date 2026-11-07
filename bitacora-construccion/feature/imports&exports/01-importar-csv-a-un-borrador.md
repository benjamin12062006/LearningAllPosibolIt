# 01 — E5.1: importar un CSV a un borrador de hoja

Fecha de creación: 2026-11-06  
Última actualización: 2026-11-06  
Estado: Implementado y verificado.  
Relacionada con: [plan 01](../../../docs/plans/feature/imports&exports/01-plan-e5-importar-y-exportar-hojas.md), [fuentes 01](../../../docs/fonts/feature/imports&exports/01-fuentes-de-importar-y-exportar-hojas.md), [bitácora de E4.7](../changesets/02-cambios-de-esquema.md).

## Necesidad

Una hoja solo recibía datos por operaciones sueltas de un borrador. Hacía falta subir un CSV, decidir el mapeo y obtener un borrador revisable con un informe por fila, sin que cambie nada oficial hasta aplicar.

## Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| E1, F60, T13 | Lector propio con las reglas del catálogo, sin columna ID y con `relax_column_count: false`. | `worksheet-csv.ts` |
| H4, E2, [17] | D1: dentro de la petición, en memoria y con 10 MiB como tope; dos rutas (vista previa y crear) y una de lectura. Se adapta el 202 + trabajo de [16]. | `csv-upload.interceptor.ts` (multer en memoria, tras el guard), `worksheet-imports.controller.ts` |
| H2, C30 | D3: mapeo explícito; cada problema de mapeo con su campo antes de leer filas. | `resolveMapping` en `import-plan.ts` |
| H3, T04, E5 | D4: conversión estricta por tipo; coma decimal y etiquetas booleanas explícitas; vacío = sin valor. | `convert` en `import-plan.ts` |
| H2 | D5: `append` y `upsert` por una columna clave; clave vacía, repetida o ambigua es problema de fila; lo ausente no se borra. | `ImportBuilder.matchOf` |
| H2, T15 | D6: sin crear nada mientras haya filas con problemas sin excluir (422 con `rows.<fila>.<cabecera>`); exclusiones guardadas con sus códigos y huella de filas incluidas con su `rowId`. | `planImport`, `includedHashOf` |
| E3, G5 de E4 | D7: importación, borrador (`source = 'import'`) y auditoría en una transacción. | `WorksheetImportsRepository.create` con `insertDraft` de E4 |
| E4 | D8: aplicar por lotes de 250 filas. | `writeRevision` y `closeOpenVersions` |

## Ajustes al escribir el código

- **`insertDraft` y `readChangeset` salen del repositorio de borradores** como funciones que reciben la transacción. `create` de E4 las usa igual que la importación; así hay un solo `INSERT` de borradores.
- **Migración escrita a mano** (`20261106100000_create_worksheet_imports`): amplía el `CHECK` de `source` y crea `worksheet_imports`. No se usó `db:migration:create` porque ejecuta `migrate dev` contra la base configurada. El modelo de Prisma se añadió y la comparación con las migraciones da vacía.
- **El filtro de errores solo deja pasar `issues` de algunos códigos.** Se añadieron `IMPORT_OPTIONS_INVALID`, `IMPORT_MAPPING_INVALID` e `IMPORT_ROWS_INVALID` al final de esa lista; sin eso, el 422 llegaba sin las filas.
- **Las operaciones del plan pasan por `normalizeOperations`** antes de guardarse: si el planificador produjera algo que E4 no acepta, falla al importar y no al aplicar.
- **Una clave con problemas no suma «obligatoria vacía»**: la fila ya es inválida por su clave y el segundo aviso solo confundía.
- Ocho códigos nuevos al final de los archivos compartidos: `WORKSHEET_IMPORT_NOT_FOUND`, `IMPORT_OPTIONS_INVALID`, `IMPORT_MAPPING_INVALID`, `IMPORT_ROWS_INVALID` (422), `IMPORT_KEY_MISSING`, `IMPORT_KEY_DUPLICATE`, `IMPORT_KEY_AMBIGUOUS` e `IMPORT_NOTHING_TO_CHANGE` (409).

## Implementación

- `POST P/worksheets/:worksheetId/imports/preview` → 200 `{ preview }`: cabeceras, 20 filas, recuento, hash y mapeo sugerido por nombre normalizado. No guarda nada; basta con ser miembro.
- `POST P/worksheets/:worksheetId/imports` → 201 `{ import, changeset }` con `ETag`. Campo `options` (JSON): `mode`, `matchColumnId`, `columns`, `excludeRows`, `delimiter`, `decimalSeparator`, `booleanLabels`, `title`. Exige `worksheet.write`.
- `GET P/worksheet-imports/:importId` → `{ import }`.

## Comprobaciones realmente ejecutadas

Ejecutado el 2026-11-06 sobre el árbol de trabajo (sin commit):

- Pruebas nuevas: `worksheet-csv.spec.ts` (12), `import-plan.spec.ts` (18) y `worksheet-imports.e2e-spec.ts` (8): vista previa sin guardar nada; archivo → borrador → revisión con ceros iniciales, decimales exactos, booleanos por etiqueta y vacíos (T04, T13); 422 sin crear nada y exclusiones exactas con su huella recalculada desde el `rowId` del borrador (T15); `upsert` con columna nueva; opciones, mapeo, cabeceras, archivo ausente y 413; rollback si falla el registro de la importación; un lector no importa (403); un propietario ajeno recibe 404.
- **Defectos a propósito** (copia temporal, 13 casos): 11 detectados a la primera. **I6** (recortar espacios) no se detectaba: las pruebas solo tenían espacios dentro de comillas. Se añadió una prueba con espacios fuera de comillas y ahora falla con el defecto. **I5** (no quitar el BOM en `csv-parse`) es equivalente: `TextDecoder` ya quita el BOM al decodificar, así que el comportamiento no cambia.

| Defecto | Prueba que falla |
| --- | --- |
| I1 ignorar las exclusiones | T15 (E2E y unitaria) |
| I2 texto vacío como cadena vacía | 4 pruebas |
| I3 upsert reescribe celdas sin cambios | upsert |
| I4 aceptar filas con otro número de campos | lector |
| I6 recortar espacios | lector (prueba añadida) |
| I7 leer una importación sin ser miembro | propietario ajeno |
| I8 importar sin permiso de escritura | lector no importa |
| I9 la huella ignora los `rowId` | T15 |
| I10 sin comprobar obligatorias | T15 |
| I11 aplicar por lotes sin cerrar versiones | 6 pruebas de E4 y E5 |
| I12 el filtro descarta los problemas de filas | T15 |

- `tsc --noEmit`, `pnpm lint` y `prettier --check src test/features`: limpios.
- Esquema frente a migraciones (26, con PGlite como base sombra): «This is an empty migration».
- Suite completa: **78 suites y 1.290 pruebas** pasan. La primera vuelta falló solo en el recuento fijo de migraciones de `projects.repository.int-spec.ts` (25 → 26), que se actualiza con cada migración.
- **Arranque real** (`AppModule` en un puerto, PGlite, sin `.env`): además del recorrido de E4, importar un CSV de 5.000 filas → 201 en 72 ms y aplicarlo → 200 en 227 ms; la revisión queda con 5.001 filas. Son tiempos en PGlite local, sin la latencia de Neon; por lotes, aplicar 5.000 filas son unas 40 consultas en vez de 10.000.

## Consecuencias

- El original no se guarda: si hace falta repetir la importación, se vuelve a subir el archivo.
- Un borrador de importación puede superar las 1.000 operaciones de un `PUT`; se revisa, se aprueba o se cancela, pero no se reescribe entero.
- **Falta un límite de filas por hoja.** [12] propone 5.000 filas por hoja, pero ni E4 ni E5.1 lo comprueban al aplicar: el arranque real dejó una hoja con 5.001 filas. Hay que decidir dónde se comprueba (al enviar o al aplicar) antes de E5.2.
- **Migración aplicada en Neon el 2026-11-06** por el usuario (`pnpm db:status` → `pnpm db:migrate`): 26 migraciones. Añadida a la lista de `test/prisma-migrations.test.mjs`.
- XLSX (E5.2), exportar (E5.3) y el puente al feed (E5.4) siguen pendientes.
