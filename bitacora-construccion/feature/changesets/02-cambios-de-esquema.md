# 02 — E4.7: cambios de esquema en un borrador y cierre de E4

Fecha de creación: 2026-11-06  
Última actualización: 2026-11-06  
Estado: Implementado y verificado.  
Relacionada con: [plan 01](../../../docs/plans/feature/changesets/01-plan-e4-borradores-y-revisiones.md) (D12), [fuentes 02](../../../docs/fonts/feature/changesets/02-fuentes-de-cambios-de-esquema.md), [bitácora 01](01-nucleo-de-borradores-y-pruebas.md).

## Necesidad

Una hoja no podía cambiar sus columnas después de crearse (E5 de las fuentes 02). T06 exige que renombrar conserve referencias y que borrar detecte dependencias; [12] pide que el borrado de columnas sea revisable con diff. E5 (importar) también lo necesita: un archivo puede traer columnas nuevas.

## Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| H1 (IDs estables), E1 (esquema por versión) | Operaciones `add_column`, `rename_column`, `delete_column` por `columnId`, en la misma lista que las de filas. El cliente genera el ID de una columna nueva, igual que el de una fila. | `changeset-schema.ts` |
| H5, E1, E4 | Aplicar guarda el esquema resultante completo como `schema_version + 1` y lo apunta en la revisión y en la hoja. Las filas no se reescriben: una columna borrada deja de leerse y su ID no se reutiliza. | `writeSchemaVersion` en el repositorio |
| H4, E3 | Borrar una columna que usa una fórmula restante → `COLUMN_IN_USE` en la operación que la borra. Si la fórmula también se borra, se permite. Renombrar no toca las fórmulas porque van por ID. | `SchemaPlanner.checkResult` |
| H3, C21 | Un cambio de esquema hecho sobre un esquema que otra revisión ya cambió es conflicto `schema_changed`. Escribir en una columna que otra revisión borró es `column_deleted`, no una celda vacía. En el rebase se resuelve por columna (`rowId: null`). | `compareOperations` con `SchemaDrift`; `ConflictResolutionDto.rowId` admite `null` |
| H2 | Cambiar el tipo queda **aplazado**: exige previsualizar cada valor incompatible. Una columna nueva es siempre opcional y no puede ser calculada. | Tipos admitidos: `ADDABLE_COLUMN_TYPES` |

## Ajustes al escribir el código

- **Normalizar en dos pasos.** Primero los cambios de columnas, después las filas contra el esquema que resulta. Así una celda puede escribir en una columna añadida en el mismo borrador, aunque la operación llegue antes que la alta. En la lista guardada, los cambios de esquema van siempre primero.
- **Las mismas reglas de fusión que las filas:** alta + renombre se funde en la alta; alta + borrado se anula; renombrar o borrar una columna ya borrada es `OPERATION_INVALID`; un renombre al mismo nombre se descarta.
- **Opciones de selección.** El servidor crea el ID de cada opción nueva, pero conserva el que ya trae: el cliente reenvía la lista guardada en cada `PUT` y esos IDs no deben cambiar.
- **Versión de esquema siguiente desde la hoja**, no desde el máximo de `worksheet_column_versions`. Un esquema puede quedar sin columnas y el máximo repetiría su número.
- Dos códigos nuevos al final de los archivos compartidos: `OPERATION_COLUMN_EXISTS` y `COLUMN_IN_USE` (400).
- Sin migración: el modelo de E3 ya guardaba el esquema por versión.

## Comprobaciones realmente ejecutadas

- Unitarias nuevas (`changeset-schema.spec.ts`, 13): alta y escritura en el mismo borrador, renombre con fórmula intacta, `COLUMN_IN_USE`, borrado conjunto, fusiones, nombres únicos (también al intercambiarlos), opciones, formas inválidas, conflictos `schema_changed` y `column_deleted`, y huella.
- E2E nuevas (3): publicar alta, renombre y borrado leyendo la revisión anterior con su esquema; conflicto de esquema resuelto por columna; `COLUMN_IN_USE` al guardar por HTTP.
- Batería de E4: **66 pruebas pasan**.
- **Defectos a propósito** (copia temporal): los 7 se detectaron y, restaurado, volvieron a pasar las 66.

| Defecto | Prueba que falla |
| --- | --- |
| S1 borrar sin mirar las fórmulas | unitaria y E2E de `COLUMN_IN_USE` |
| S2 aplicar sin publicar el esquema nuevo | las dos E2E de esquema |
| S3 no detectar que el esquema cambió | E2E de conflicto de esquema |
| S4 el esquema resultante ignora los renombres | 3 pruebas |
| S5 la huella ignora las opciones | huella |
| S6 las filas se validan contra el esquema base | 3 pruebas |
| S7 no actualizar la versión de esquema de la hoja | las dos E2E de esquema |

- Verificación del cierre de E4: ver la sección siguiente.

## Verificación del cierre de E4

Ejecutado el 2026-11-06 sobre el árbol de trabajo (sin commit):

- `tsc --noEmit`, `pnpm lint` (Oxlint sin avisos) y `prettier --check src test/features`: limpios.
- Esquema frente a migraciones: `prisma migrate diff --from-migrations … --to-schema …` con PGlite como base sombra devuelve «This is an empty migration» (25 migraciones; E4 no añade ninguna).
- Suite completa: **75 suites y 1.244 pruebas** pasan (antes de E4: 69 y 1.176).
- **Arranque real**: `AppModule` completo escuchando en un puerto local, con PGlite y migraciones reales, sesión simulada y sin `.env`, en una copia temporal. Recorrido por `fetch`: salud con `X-Request-Id`, aprovisionar usuarios, proyecto, libro, hoja, borrador con `add_column` e `insert_row`, envío, aprobación `single_member`, aplicación, reintento con la misma clave, lectura de la fila con la columna nueva (`schemaVersion` 2) y 404 para un usuario ajeno.

### Defecto que encontró el arranque real

**El reintento con la misma `Idempotency-Key` devolvía los mismos datos con otro orden de claves.** El recibo se guarda en JSONB y PostgreSQL reordena las claves, así que el cuerpo del reintento no era idéntico al de la primera respuesta. La E2E no lo veía porque comparaba objetos. Ahora `storedResult` rehace el objeto en el orden de la respuesta original y T10 compara el texto del cuerpo. Defecto a propósito D15 (devolver el JSONB tal cual): detectado por T10.

## Consecuencias

- **Revertir una revisión de esquema** no genera operaciones inversas de columnas: la propuesta de reversión solo mira filas y responde `REVERT_NOTHING_TO_UNDO`. Queda para cuando se pida.
- **Cambiar el tipo de una columna** queda para un incremento propio con previsualización de valores incompatibles.
- Los valores de una columna borrada siguen dentro de `cell_values` de las filas que no se tocaron. No se leen, pero ocupan espacio hasta que la fila cambie.
