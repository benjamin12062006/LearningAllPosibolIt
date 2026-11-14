# 01 — E4: borradores, revisión, aplicación atómica y reversión de hojas

Fecha de creación: 2026-11-05  
Última actualización: 2026-11-06 (batería de E4, E4.7 y cierre)  
Estado: **Plan cerrado** el 2026-11-06, salvo la concurrencia en PostgreSQL real (ver «Límites y continuidad»).
Ámbito: `LearningAllPosibolIt`, solo backend y REST. E4 de la ampliación ([18](../../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md)), con la parte de E2 que E4 necesita.  
Relacionada con: [fuentes 01](../../../fonts/feature/changesets/01-fuentes-de-borradores-y-revisiones.md), [plan de hojas 03](../worksheets/03-plan-e3.3-validadores-y-calculos.md), [bitácora de hojas 03](../../../../bitacora-construccion/feature/worksheets/03-validadores-y-calculos.md).  
Revisión de referencia: `23fd7ef` en `feature/worksheets`, con E3.3 sin commit.

## Qué parte de E2

E4 depende de «los recibos de E2» (G1). Se construyen aquí los **recibos de operación** y la **auditoría**, que se escriben en la misma transacción que la revisión (G5, C22). El resto de E2 (colas Redis/BullMQ, outbox con relay, migrar los workers actuales, fencing) no tiene consumidor en E4 y se solapa con el trabajo de trabajos programados de otra sesión: queda para su propio plan.

## Objetivo

Un editor prepara un borrador sobre la revisión actual de una hoja, lo guarda sin perder cambios entre pestañas, ve la comparación y los problemas, lo envía a revisión; otra persona con permiso lo aprueba y lo aplica. Aplicar crea una revisión nueva de forma atómica e idempotente. Si la hoja cambió, hay conflicto y se resuelve explícitamente. Restaurar crea un borrador inverso. E4 está completa cuando pasan T07–T12 (G2) con PostgreSQL temporal, salvo la concurrencia real, que exige PostgreSQL con varias conexiones.

## Decisiones

| ID | Decisión | Respaldo |
| --- | --- | --- |
| D1 | Tablas `worksheet_changesets` (operaciones en JSONB normalizado, estado, `draft_version`, revisión base, hash), `worksheet_changeset_decisions` (solo se añaden filas), `operation_receipts` y `audit_events`. `worksheet_revisions.changeset_id` único: un borrador produce como mucho una revisión (T10). | G3, G5, F47 |
| D2 | Operaciones `set_cell`, `insert_row` y `delete_row`, con IDs de fila y columna. Como mucho 1.000 operaciones. Se normalizan al guardar: una sola escritura por celda; `set_cell` sobre una fila insertada se funde en su inserción; borrar una fila insertada anula la inserción; editar una fila borrada en el mismo borrador es un error. | G1, [12](../../../../../docs-diagrams/12-hojas-modelo-editor-importacion-y-exportacion.md) |
| D3 | `PUT …/operations` sustituye la lista entera con `If-Match: "<draftVersion>"`: sin cabecera 428, otra versión 412; éxito aumenta `draftVersion` y devuelve el nuevo `ETag`. Solo el autor y solo en `draft`. | F45, F46, G7, T07 |
| D4 | `GET …/diff`: comparación B/H/P de cada operación (`change`, `noop`, `satisfied`, `conflict`), conteos, problemas de las filas resultantes y `contentHash` (SHA-256 de base, esquema y operaciones canónicas). | G4, C21, T08 |
| D5 | Enviar exige la `draftVersion` vigente, que el head siga siendo la base y que no haya problemas; si no, 409 o 400 con `issues`. Un borrador enviado siempre está sobre el head actual. **Ajustado en la batería de E4:** la versión se comprueba antes que los problemas. | G3, G4 |
| D6 | Decidir (`accept`/`reject`) exige `changeset.approve`, el hash, la versión y el head revisados. No se aprueba un borrador propio salvo si la organización tiene un solo miembro (política `single_member`, registrada en la decisión). | G8 |
| D7 | `reopen` vuelve a `draft` desde enviado, rechazado o en conflicto, y aumenta `draftVersion`: las decisiones anteriores dejan de valer (T12). `cancel` lo cierra. | G3 |
| D8 | `apply` con `Idempotency-Key` (sin ella 400; misma clave con otro cuerpo 422): bloquea organización → borrador → hoja; revalida permiso, aprobación, hash y head; cierra e inserta versiones de fila, crea la revisión, mueve el head y guarda auditoría y recibo, todo en una transacción. Head distinto → 409 y el borrador pasa a `conflicted` en otra transacción condicionada. | G5, F47, F39, C22, T09–T11 |
| D9 | `rebase` mueve la base al head actual: lo ya satisfecho o sin cambio se descarta y cada conflicto necesita una elección (`proposed` o `head`); sin resolver → 409 con la lista. **Ajustado en la batería de E4:** lo que queda se vuelve a validar contra el head, así elegir `proposed` sobre una fila borrada da 400 en vez de resucitarla. | G4, C21 |
| D10 | `POST P/revisions/:revisionId/revert-proposal` crea un borrador nuevo sobre el head con las operaciones inversas de las filas que cambió esa revisión. | G6, T12 |
| D11 | Organización archivada: ninguna escritura (como en E1.4). Lecturas por membresía. | E1.4 |
| D12 | Cambios de esquema (renombrar, añadir o borrar columnas con detección de dependencias, T06) son un incremento propio, E4.7, después del núcleo. **Ajustado en E4.7:** cambiar el tipo de una columna queda aplazado (exige previsualizar valores incompatibles, [12]). **Hecho en C5 del plan de cierre (2026-11-08)**, como E4.8: [bitácora C5](../../../../bitacora-construccion/feature/cierre-backend/05-cambiar-el-tipo-de-una-columna.md). | G1, [fuentes 02](../../../fonts/feature/changesets/02-fuentes-de-cambios-de-esquema.md) |

## Incrementos

0. ✅ Recibos de operación y auditoría (parte de E2).
1. ✅ Operaciones: formato, normalización y validación contra el esquema (puras).
2. ✅ Crear, leer y guardar borradores con `If-Match`.
3. ✅ Comparación de tres versiones, problemas y hash.
4. ✅ Enviar, decidir, reabrir y cancelar.
5. ✅ Aplicar en una transacción con recibo.
6. ✅ Rebase de conflictos y propuesta de reversión.
7. ✅ Cambios de esquema: añadir, renombrar y borrar columnas. Cambiar el tipo, aplazado.

Bitácoras: [01 núcleo y batería](../../../../bitacora-construccion/feature/changesets/01-nucleo-de-borradores-y-pruebas.md) (E4.0–E4.6) y [02 cambios de esquema](../../../../bitacora-construccion/feature/changesets/02-cambios-de-esquema.md) (E4.7 y cierre).

## Comprobación prevista

Unitarias de operaciones y comparación; integración con PostgreSQL temporal de cada transición y del apply (incluido el rollback ante un fallo a mitad); e2e del recorrido completo y de T07, T09, T10 y T12; defectos forzados; regresión completa.

### Comprobación del avance

El código del avance compiló y pasó Prettier. Oxlint señaló un aviso en `changeset-diff.ts`. Pasaron las 69 suites de regresión (1.176 pruebas).

En una copia temporal con PGlite y autenticación simulada se arrancó `AppModule` y se comprobó por HTTP la salud de la API, las cabeceras CORS, el aislamiento de un usuario ajeno, la creación y el guardado de un borrador con `ETag`, el rechazo de versiones antiguas, la comparación, la aprobación por un miembro único y la aplicación repetida con la misma clave. La nueva fila se pudo leer y solo se creó una revisión adicional.

Esta comprobación cubre un recorrido. La batería específica de E4 y E4.7 se hicieron el 2026-11-06 (bitácoras 01 y 02).

## Límites y continuidad

- **Pendiente:** concurrencia real (dos pestañas a la vez, dos applies simultáneos). El diseño se apoya en bloqueos de fila (F39) y en la restricción única; PGlite serializa las conexiones y no lo demuestra. Necesita PostgreSQL con varias conexiones.
- Aplazado: revertir una revisión de esquema. (Cambiar el tipo de una columna se hizo en C5 del plan de cierre, 2026-11-08.)
- Sin trabajos en segundo plano: con el límite de 5.000 filas el apply cabe en una transacción acotada.
- Siguiente: E5 (importar y exportar hojas).
