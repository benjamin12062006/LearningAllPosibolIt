# 01 — E4.0–E4.6: núcleo de borradores, aplicación y su batería de pruebas

Fecha de creación: 2026-11-06  
Última actualización: 2026-11-06  
Estado: Implementado y verificado (salvo la concurrencia en PostgreSQL real, ver «Consecuencias»).  
Relacionada con: [plan 01](../../../docs/plans/feature/changesets/01-plan-e4-borradores-y-revisiones.md), [fuentes 01](../../../docs/fonts/feature/changesets/01-fuentes-de-borradores-y-revisiones.md), [bitácora 02](02-cambios-de-esquema.md), [bitácora de hojas 03](../worksheets/03-validadores-y-calculos.md).

## Necesidad

El código de E4.0–E4.6 (recibos, auditoría, operaciones, guardado con `If-Match`, comparación, envío, decisión, aplicación, rebase y reversión) quedó en `main` (`7921f00`) con un solo recorrido HTTP manual. Faltaba la batería propia de E4 que exige el plan (T07–T12 y aislamiento entre propietarios) y corregir lo que esa batería encontrara.

## Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| G2 ([18](../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md), T07–T12) | Una prueba por criterio, por HTTP cuando el criterio habla de lo que ve una persona. | `changesets.e2e-spec.ts`: T07, T09, T10, T12, permisos, archivado y propietaria ajena. |
| G5, C22 (todo en una transacción) | T11 se prueba forzando el fallo en el punto exacto con un disparador de PostgreSQL, no con un mock. | `changesets.int-spec.ts`: fallo en la segunda fila, en la auditoría y en el recibo. |
| G3 (diagrama de estados de [13]) | `approved → draft` no existe: un borrador aprobado solo se cancela. La prueba se ajusta al diagrama, no el código. | T12 reabre desde `rejected` y comprueba que reabrir un aprobado da 409. |
| G4 (tabla B/H/P) | La tabla completa como prueba parametrizada. | `changeset-diff.spec.ts`. |
| F45 (`If-Match`, «lost update») | Enviar con una versión antigua es 409 antes que cualquier otro problema. | Comprobación de versión al principio de `submit` (ver defectos encontrados). |

## Defectos que encontró la batería

1. **Enviar validaba antes de mirar la versión.** Con una `draftVersion` antigua y filas con problemas respondía 400 con esos problemas, en lugar de 409 `CHANGESET_STALE`: la persona veía errores de un contenido que ya no tenía delante. Ahora `submit` compara la versión antes de construir la revisión (el repositorio la vuelve a comprobar bajo bloqueo).
2. **El rebase podía resucitar una fila borrada.** Si otra revisión borraba una fila y el autor elegía `proposed` para su edición de esa fila, el rebase guardaba un `set_cell` sobre una fila inexistente; al aplicar, se cerraba el tombstone y se abría una fila con una sola celda. Ahora las operaciones que sobreviven al rebase se vuelven a normalizar contra el head, igual que al guardar: esa elección da 400 `OPERATION_ROW_UNKNOWN` y la persona elige `head`.
3. **Aviso de Oxlint** en `changeset-diff.ts` (`no-useless-fallback-in-spread`), heredado del avance: se quitó el `?? {}` innecesario.

## Ajustes al escribir el código

- `normalizeOrReject` recibe la revisión contra la que valida (base al guardar, head al hacer rebase) en vez del borrador entero.
- En la E2E, archivar exige convertir antes la organización personal en de equipo (`organizations_personal_not_archived`).

## Comprobaciones realmente ejecutadas

- Batería de E4: 4 archivos unitarios (`changeset-operations`, `changeset-diff`, `changeset-revert`, `changeset-schema`), 1 de integración y 1 E2E. Con E4.7 incluida, **66 pruebas pasan**.
- Antes de E4.7: 50 pruebas; las 13 E2E y las 5 de integración se ejecutaron contra PGlite con migraciones reales.
- **Defectos a propósito** (copia temporal, uno cada vez, script `defects-e4.mjs`): los 14 se detectaron y, restaurado, volvieron a pasar las 50.

| Defecto | Prueba que falla |
| --- | --- |
| D1 guardar sin comprobar la versión | T07 |
| D2 aplicar ignora el recibo | T10 |
| D3 aplicar sin comprobar el head | T09 |
| D4 autoaprobación en un equipo | aprobar |
| D5 decidir sin comprobar la versión | T12 |
| D6 marcar en conflicto cualquier estado | integración |
| D7 cerrar la versión de fila en otra secuencia | intervalos, T09, rebase |
| D8 leer un borrador sin ser miembro | propietaria ajena |
| D9 rebase sin revalidar sobre el head | rebase de fila borrada |
| D10 enviar valida antes de la versión | enviar |
| D11 tabla B/H/P: satisfecho como cambio | tabla B/H/P |
| D12 revertir repite celdas ya revertidas | T12 y unitaria |
| D13 el recibo fuera de la transacción | 11 pruebas |
| D14 normalizar sin fundir ediciones en la inserción | unitaria |

- Verificación final de la etapa: ver la [bitácora 02](02-cambios-de-esquema.md), que cierra E4 con la suite completa.

## Consecuencias

- **T10 por HTTP** se probó con dos peticiones simultáneas con la misma clave; PGlite serializa las conexiones, así que eso demuestra el recibo, **no** el bloqueo entre conexiones.
- **Concurrencia real pendiente** (T07 y T09 con dos conexiones, dos `apply` a la vez): necesita PostgreSQL con varias conexiones. En esta máquina no hay PostgreSQL instalado y Docker (OrbStack) no estaba en marcha.
