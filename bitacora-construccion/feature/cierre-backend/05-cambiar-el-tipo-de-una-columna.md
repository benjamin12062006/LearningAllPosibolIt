# 05 — C5: cambiar el tipo de una columna (E4.8)

Fecha de creación: 2026-11-08  
Última actualización: 2026-11-08  
Estado: Implementado y verificado.  
Relacionada con: [plan 01 de cierre](../../../docs/plans/feature/cierre-backend/01-plan-cierre-de-pendientes.md) (P5), [fuentes 02, cambiar el tipo](../../../docs/fonts/feature/cierre-backend/02-fuentes-de-cambiar-el-tipo-de-columna.md), [bitácora 02 de changesets (E4.7)](../changesets/02-cambios-de-esquema.md), [plan de E4](../../../docs/plans/feature/changesets/01-plan-e4-borradores-y-revisiones.md) (D12).  
Revisión de partida: `main` `c280506` más C1–C4 sin commit.

## Necesidad

E4.7 añade, renombra y borra columnas, pero no cambia su tipo: se aplazó porque [12] exige previsualizar cada valor incompatible y no borrar ni redondear nada sin avisar.

## Decisiones concretas (sobre P5 y la ficha 02)

- **Operación de esquema** `{ type: 'change_column_type', columnId, columnType, options? }`:
  - solo sobre una columna de la revisión base que no sea calculada, una vez por borrador y hacia un tipo distinto;
  - `options` es obligatorio hacia selección (las mismas reglas que al añadir) y no se admite hacia otro tipo;
  - de selección a selección no se cambia;
  - se conserva `required`;
  - si una calculada lee la columna, el tipo nuevo tiene que ser entero o decimal (`COLUMN_IN_USE`);
  - después de borrar la columna en el mismo borrador, o borrarla después, es `OPERATION_INVALID`.
- **La conversión no se guarda en el borrador.** Se calcula a partir de la revisión base, con la tabla de la ficha 02 (`worksheets/cell-conversion.ts`), como un `set_cell` por cada celda con valor. Se saltan las filas que el borrador borra y las celdas que el borrador ya fija con su propio `set_cell` (así se corrige un incompatible). Un valor incompatible no produce `set_cell`: se queda como estaba y, con el tipo nuevo, deja de ser válido.
- **Vista previa:** la revisión lee todas las filas con valor en las columnas que cambian de tipo, aplica las operaciones y la conversión, y cada incompatible sale como problema que bloquea (`CELL_VALUE_INVALID` en `rows.<rowId>.<columnId>`), igual que cualquier celda inválida. Se añade `columnConversions` a la revisión: columna, tipo de antes y de después, celdas convertidas e incompatibles. Es un campo nuevo; los demás no cambian.
- **Aplicar** repite el mismo cálculo con la cabecera bloqueada (que es la base): mismo resultado que la vista previa. Si quedara un incompatible (no debería: enviar ya lo comprueba y el contenido aprobado no cambia), no se aplica nada.
- **Rebasar** vuelve a validar la operación contra la cabecera nueva y la vista previa se recalcula sobre ella: una edición posterior de esa columna se convierte o aparece como incompatible, nunca se pierde.

## Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| H3, E9, E10 (ficha 02) | Tabla de conversión: texto visible y lectura estricta del tipo nuevo | [`convertValue`](../../../src/worksheets/cell-conversion.ts) |
| E8, E15 | Operación de esquema con sus reglas | `ChangeColumnType`, `SchemaPlanner.changeColumnType`, `withType` y la comprobación numérica de `checkResult` ([`changeset-schema.ts`](../../../src/changesets/changeset-schema.ts)); forma canónica y propuesta en `changeset-diff.ts` |
| E11, E12, H8 | La conversión no se guarda: se calcula desde la base | [`planConversion`](../../../src/changesets/changeset-conversion.ts), `retypedColumnIds` |
| H3, E11 | Vista previa con cada incompatible | `previewConversion` y `rowsToCheck` en `ChangesetsService`; campo `columnConversions` en la revisión; `findRowsWithValuesAt` |
| E13 | Aplicar con la cabecera bloqueada, mismo cálculo | `withConversion` y `findRowsWithValuesIn` en `changesets.repository.ts` |
| H4, E14 | Rebase revalida; un esquema cambiado en la cabecera es conflicto | Ya lo hacían `rebase` (normaliza contra la cabecera) y `compareSchema` (`schema_changed`) |

## Ajustes al escribir el código

- **Un incompatible no necesita un código nuevo.** La conversión no produce `set_cell` para él, así que conserva su valor de antes, que con el tipo nuevo no es válido: la validación que ya existía lo marca como `CELL_VALUE_INVALID` en `rows.<rowId>.<columnId>`. Solo hizo falta que la revisión validara también esas filas, aunque el borrador no las mencione (`rowsToCheck`).
- **Se quitó una comprobación sin efecto.** La primera versión rechazaba el texto vacío de forma explícita; un `""` ya falla en todos los tipos que no son texto (ninguna etiqueta puede estar vacía), así que la regla queda en el comentario y no en una rama que nunca cambia nada.
- **El esquema ya protegía H4.** `compareSchema` marca como conflicto cualquier operación de esquema cuando la cabecera publicó otro esquema, y `rebase` revalida contra ella: no hizo falta código nuevo, solo la propuesta visible (el tipo nuevo) en `proposedSchema`.
- **La prueba de integración usa texto → booleano**, porque de texto a entero el valor `'7'` se escribe igual y no demostraría que `apply` convierte.
- **El normalizador ya informa una celda inválida** como `OPERATION_VALUE_INVALID` sobre la operación; la prueba nueva se ajustó a ese comportamiento existente.

## Implementación

- `src/worksheets/cell-conversion.ts` (nuevo): `convertValue`, `ConvertedValue`.
- `src/changesets/changeset-conversion.ts` (nuevo): `planConversion`, `retypedColumnIds`, `ColumnConversion`, `ConversionPlan`; clases pequeñas `DraftCells` y `ConversionBuilder`.
- `src/changesets/changeset-schema.ts`: operación `change_column_type` (forma, planificador, esquema resultante y entradas numéricas de las calculadas); comentario de cabecera actualizado.
- `src/changesets/changeset-diff.ts`: forma canónica (tipo y opciones entran en la huella) y `proposedSchema`.
- `src/changesets/changesets.service.ts`: `previewConversion`, `rowsToCheck` y `columnConversions` en `ChangesetReview`.
- `src/changesets/changesets.repository.ts`: `findRowsWithValuesAt` / `findRowsWithValuesIn` (filtro `jsonb_exists_any`) y `withConversion` en `apply`.
- Sin migración: las operaciones se guardan en `jsonb` y las versiones de columna ya guardan tipo y opciones.

## Comprobaciones realmente ejecutadas

2026-11-08.

- **Pruebas nuevas:**
  - `cell-conversion.spec.ts` (30): la tabla de la ficha, caso por caso, incluido `10.00` → `10`, `10.50` sin redondear, espacios y valores guardados que ya eran inválidos;
  - `changeset-conversion.spec.ts` (4): recuentos, celdas vacías, filas borradas, celdas fijadas por el borrador y selección;
  - `changeset-retype.spec.ts` (15): forma de la operación, esquema resultante, celdas validadas contra el tipo nuevo, diez rechazos y huella;
  - `column-type.e2e-spec.ts` (5, por HTTP): vista previa con cada incompatible y envío bloqueado, corrección en el mismo borrador y aplicar sin perder nada, selección por etiqueta, entrada de una calculada, rebase que recalcula y conflicto de esquema (H4);
  - `changesets.int-spec.ts` (1 más): `apply` convierte con la cabecera bloqueada y, con un incompatible aprobado desde el repositorio, no escribe nada.
- **Suite completa** (PGlite): 91 suites y 1.514 pruebas pasan, 5 saltadas (las de PostgreSQL). **`pnpm test:features:postgres`**: 5 de 5.
- `tsc`, `pnpm lint` y `prettier --check src test/features scripts/testing`: limpios; ningún carácter invisible.
- **Defectos a propósito** (copia limpia; pruebas de conversión, borradores y la E2E): decimal a entero que redondea; recortar espacios; ignorar los `set_cell` del borrador; convertir filas borradas; no revisar los incompatibles; vista previa sin leer todas las filas; aplicar sin convertir; aplicar con incompatibles; entrada no numérica de una calculada; conservar las opciones viejas; huella sin opciones. **Los once, detectados.**

## Consecuencias

- **E4 ya no tiene el cambio de tipo aplazado.** Sigue aplazado revertir una revisión de esquema: una reversión de una revisión con cambio de tipo propone los valores de antes, que con el tipo nuevo salen como celdas inválidas en la revisión y no se pueden enviar sin corregirlos.
- **La revisión de un borrador con cambio de tipo lee todas las filas con valor en esa columna** (hasta 5.000); sin cambio de tipo, nada cambia.
- **El campo `columnConversions` es nuevo** en la respuesta de la revisión (`GET …/diff`); los demás campos no cambian. Hay que añadirlo al contrato de la web (doc [16]) cuando se escriba E7.
