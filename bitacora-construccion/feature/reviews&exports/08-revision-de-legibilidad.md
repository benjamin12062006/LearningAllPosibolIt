# 08 — Revisión de legibilidad del código de reviews y exports

Fecha de creación: 2026-11-02  
Estado: Implementado y verificado. Reorganización sin cambio de comportamiento; sin commit (el usuario pidió solo el commit de la feature).  
Ámbito: todo el código de producción creado o tocado por la feature: `src/exports/`, `src/artifacts/` y los cambios en `src/catalog-import/` y `src/evaluations/`. Revisado con la skill `filosofia-codigo-legible-para-humano`, a petición del usuario.  
Relacionada con: [plan 01](../../../docs/plans/feature/reviews&exports/01-plan-reviews-y-exports.md), bitácoras [01](01-serializador-tsv.md)–[07](07-cierre-documental.md).  
Revisión de partida (oráculo): `f6b4bf9` («feat: revisar y exportar el TSV de una evaluación aprobada»), en la rama `feature/reviews-exports`.

## Necesidad y punto de partida

El usuario pidió leer el código creado y asegurar que cumple «milimétricamente» la skill antes de seguir con la siguiente feature. El commit `f6b4bf9`, hecho justo antes, sirve de punto de guardado.

## Revisión archivo por archivo

| Archivo | Resultado | Regla |
| --- | --- | --- |
| `src/exports/products-tsv.ts` | Cumple: la función principal orquesta, `hasValue` estrecha el tipo, `assertFitsInTsv` no copia valores en el mensaje y los comentarios explican el porqué. | 1, 2, 3, 8 |
| `src/exports/export-approval.ts` | Cumple: lista de comprobaciones con nombre, predicado `hasResults` en vez de `as` y orden explicado. | 1, 2, 3, 8 |
| `src/exports/exports.controller.ts`, `exports.dto.ts`, `exports.types.ts`, `exports.module.ts`, `export-cleanup.service.ts` | Cumplen: capa HTTP delgada, constantes con nombre (`PRODUCTS_TSV_TYPE`, `CHECKSUM_PATTERN`), dependencias en una dirección con comentario. | 7, 9 |
| `src/artifacts/remove-orphans.ts`, `artifacts.module.ts`, `artifacts.types.ts` | Cumplen. | — |
| Perfil, motor y textos de `src/evaluations/` (E3) | Cumplen: `findFreeTextProblem` con el orden explicado y constantes comentadas. | 2, 7, 8 |
| `src/exports/exports.service.ts` | **Corregido.** «Usuario actual + proyecto propio» se repetía en tres métodos; `toApproval` copiaba campo a campo un objeto que ya tenía la forma de `ExportApproval`; `create` metía un `await` dentro de los argumentos de `assertCanExport`; la URL de descarga era una plantilla en línea. | 1, 3, 5 |
| `src/exports/exports.repository.ts` | **Corregido.** Los métodos públicos no seguían el orden de uso y mezclaban exportar, consultar y limpiar. La lectura de la evaluación repetía el mismo ternario en dos sitios. `toCounts` tenía una condición de tres partes sin nombre. | 1, 2, 6 |
| `src/artifacts/artifact.store.ts` | **Corregido.** Métodos de importaciones y exportaciones mezclados; privados fuera del orden de uso; comparación de dos partes sin nombre en `verifyExport`. | 2, 6 |
| `src/catalog-import/catalog-import.repository.ts` (cambios de E6) | **Corregido.** `DeletableSnapshotRow` repetía los campos de `DeletedSnapshotRow`; `findExportKeys` agrupaba con un spread anidado. | 3, 5 |

### Cambios

- **`exports.service.ts`:**
  - `ownerOf(identity, projectId)` concentra el paso repetido, con las llamadas en el mismo orden (`findCurrent` y después `findOwned`).
  - `create` lee la evaluación en una variable y pasa el body como aprobación, con un comentario que lo dice; se borra `toApproval`.
  - `downloadUrlOf` da nombre a la URL.
- **`exports.repository.ts`:**
  - Secciones «Exportar», «Consultar y descargar» y «Limpieza», con los métodos en el orden en que los usa el servicio.
  - `readEvaluationToExport(client, target, lock)` sirve para la lectura previa y para la bloqueada, con el tipo `EvaluationTarget`.
  - `hasCounts` es ahora un predicado `row is CountedEvaluationRow`.
  - El SQL es el mismo: solo cambia de sitio un bloque y los parámetros se leen de `target`, con los mismos valores.
- **`artifact.store.ts`:**
  - Secciones «Importaciones», «Temporales» y «Exportaciones».
  - Privados en orden de uso (`linkInto`, `list`, `writeTemporary`, `moveToExports`, `verifyExport`…).
  - `isSameContent` da nombre a la comparación.
  - Comprobado con el recuento de líneas: además de los comentarios de sección y la condición con nombre, el código es el mismo, en otro orden.
- **`catalog-import.repository.ts`:**
  - `DeletableSnapshotRow = DeletedSnapshotRow & { jobStatus }`.
  - El `Map` de claves se llena con una variable con nombre y `push`, conservando el orden de las filas.

### Descartado

- **Corregir el `as` de `isMissingFile`.** Viene del código anterior; `(error as X).code` lanza con `null`, y un predicado sin cast cambiaría ese caso (la skill lo marca como trampa). Se deja igual.
- **Unificar `findByOwner` y `findFileByOwner`.** Comparten el `JOIN` y el `WHERE`, pero cada consulta se lee entera de un vistazo; una proyección compartida para dos usos añade un salto sin ganar claridad.
- **Extraer el `data` de `tx.export.create` a otra función.** Mapea once columnas en un solo sitio y se lee bien donde está.
- **Tocar las pruebas.** No se cambió ninguna.

## Comprobación

| Comprobación ejecutada | Resultado |
| --- | --- |
| `tsc --noEmit` y `oxlint` tras cada archivo | Sin errores ni avisos. |
| Comparación diferencial con `preparar_comparacion.py` (oráculo `f6b4bf9`, cada copia compilada con `pnpm test:features:compile`) y un comparador propio de 43 pasos sobre PGlite. Recorre lecturas del repositorio, exportación nueva y repetida, consulta y descarga, errores `404`/`409`/`503`, carrera de unicidad, limpieza de huérfanos, `deleteSnapshot`/`deleteProject` con las claves de los TSV y operaciones del almacén con claves de cada tipo; normaliza UUID, fechas y la carpeta temporal | 0 diferencias en los 43 pasos, con resultados reales en cada uno (no errores de preparación). |
| Control de la comparación | Quitar la búsqueda de la exportación existente en la copia nueva compilada **no** produjo diferencias: el resultado observable es el mismo, porque el índice único devuelve la existente; por eso la prueba de integración lo vigila con un espía. Quitar `succeeded` de las evaluaciones que reemplazan a otra produjo 34 líneas de diferencia (desaparece el `409 EXPORT_EVALUATION_SUPERSEDED`). Restaurado: 0 diferencias. |
| `pnpm test:features`, sin cambiar ninguna prueba | 31 suites y 585 pruebas en verde. |
| `pnpm db:verify` | 3 de 3. |
| `prettier --check src test/features` | Todo con el estilo de Prettier. |
| Arranque real de `AppModule` (script de E6) | Las 5 rutas probadas responden `401` sin sesión. |

Cambio de líneas, solo como dato: `artifact.store.ts` +50/−34, `exports.repository.ts` +93/−58, `exports.service.ts` +27/−26, `catalog-import.repository.ts` +5/−10.

**No verificado:** la comparación cubre los casos escritos; no es una prueba formal de equivalencia. Que el código se lea mejor lo valora el usuario.
