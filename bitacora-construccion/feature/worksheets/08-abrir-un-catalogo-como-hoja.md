# 08 — H5: abrir un catálogo como hoja

Fecha de creación: 2026-11-14  
Estado: Implementado y verificado (2026-11-14). Sin commit. Cierra el Bloque A (H1–H5). La migración 35 está pendiente de aplicar en Cloud SQL (la aplica el usuario).  
Relacionada con: [plan 02 de cierre](../../../docs/plans/feature/cierre-backend/02-plan-terminar-hojas-visor-y-agente.md) (P11), [12, «Puente al catálogo y feed existentes»](../../../../docs-diagrams/12-hojas-modelo-editor-importacion-y-exportacion.md), [bitácora del puente hoja → catálogo (E5.4)](../imports&exports/04-puente-de-una-revision-al-catalogo.md), [bitácora 04, H1](04-renombrar-archivar-y-duplicar.md).  
Revisión de partida: `feature/cierre-backend` `fb32457`.

## Necesidad

E5.4 lleva una hoja al catálogo. El documento 12 pide también el camino contrario: «el vínculo inverso usa un snapshot terminado como origen de una nueva hoja y copia valores; no modifica la entrada antigua». Así un catálogo que llegó por CSV se puede seguir trabajando en el editor.

## Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| 12: «copia valores; no modifica la entrada antigua» | Una hoja nueva con revisión 1 ya llena; el catálogo no se toca | `createFilledWorksheet` en [`worksheets.repository.ts`](../../../src/worksheets/worksheets.repository.ts) |
| Un CSV no dice tipos | Todas las columnas de texto: nada se convierte ni se pierde; después se cambian con un borrador (C5) | `columnsOf` en [`catalog-worksheet.service.ts`](../../../src/worksheet-catalog-snapshots/catalog-worksheet.service.ts) |
| El catálogo garantiza un identificador no vacío | La columna del identificador es obligatoria, lista para volver al catálogo | `required: header === catalog.idColumn` |
| Un CSV no distingue vacío de nulo | Una celda vacía queda sin valor | `rowsOrReject` |
| Una celda de hoja admite 8 KiB de texto (12) y una fila de catálogo, hasta 1 MiB | No se recorta: se rechaza con su fila y su cabecera, como al importar (422 `IMPORT_ROWS_INVALID`) | `rowsOrReject` |
| El módulo puente ya conoce las dos partes; hojas no debe depender del catálogo | El puente lee el catálogo y pide a hojas «una hoja que nace con filas», con las celdas por posición de columna | `CatalogWorksheetService` → `WorksheetsService.createFilledWorksheet` |
| H1 ya guarda la procedencia de las copias | La hoja recuerda su snapshot (`openedFromCatalog`) y su revisión 1 tiene origen `catalog` | Migración 35 |

No se consultaron cursos: es el mismo patrón de creación en una transacción de E3.1 y de la copia de H1.

## Contrato

```http
POST /api/v1/organizations/:organizationId/projects/:projectId/workbooks/:workbookId/worksheets/from-catalog
{ "name": "Catálogo de marzo", "snapshotId": "…" }
```

`201 { worksheet, capabilities }`, como al crear una hoja. La hoja lleva `openedFromCatalog: { snapshotId }`. Pide Editor y un libro activo.

| Caso | Respuesta |
| --- | --- |
| Snapshot que no existe o de otro proyecto (también de la misma organización) | 404 `IMPORT_NOT_FOUND` |
| Snapshot `pending`, `importing` o `failed` | 409 `CATALOG_SNAPSHOT_NOT_READY` |
| Cabeceras que no pueden ser columnas (por ejemplo, `SKU` y `sku`) | 400 `VALIDATION_FAILED` con `columns.N.name` |
| Un texto de más de 8 KiB | 422 `IMPORT_ROWS_INVALID` con `rows.<fila>.<cabecera>` |
| Nombre repetido en el libro, libro archivado o inexistente | 409 / 409 / 404, como al crear una hoja |

## Ajustes al escribir el código

- **No pasa por un borrador.** El plan decía «por el mismo camino que una importación». Abrir un catálogo crea una hoja nueva, como crearla vacía o duplicarla: no hay datos previos que revisar. Toma de la importación los límites (5.000 filas, 200 columnas, 8 KiB por celda) y la forma de los errores. Anotado en el plan (P11).
- **Migración 35** (`20261114120000_open_catalog_as_worksheet`): `source_catalog_snapshot_id`, un `CHECK` de que una hoja sale de otra hoja o de un catálogo, nunca de los dos, y `'catalog'` como origen de una revisión.
- La prueba exacta de la hoja en `worksheets.int-spec.ts` se amplió otra vez con `openedFromCatalog: null`.

## Comprobaciones realmente ejecutadas (2026-11-14)

- **Pruebas:** 13 E2E en [`catalog-as-worksheet.e2e-spec.ts`](../../../test/features/worksheet-catalog-snapshots/catalog-as-worksheet.e2e-spec.ts): columnas, obligatoriedad, procedencia, auditoría y origen de la revisión; filas en su orden con el vacío como «sin valor»; **exportada a CSV dice lo mismo que el catálogo**; **ida y vuelta**: la hoja llevada otra vez al catálogo da las mismas filas; no toca el catálogo y se abre más de una vez; catálogo sin terminar o fallido; de otro proyecto, de un proyecto de la misma organización o inexistente; cabeceras que chocan; texto demasiado largo sin crear nada; nombre, libro archivado e inexistente; validación; roles, otra organización y sin sesión.
- **Defectos a propósito:** **12 de 12 detectados.** (La primera tanda no llegó a correr: la carpeta temporal se vació y el script no existía; se recreó y se repitió entera.)

  | Id | Defecto | Detectado |
  | --- | --- | --- |
  | H5-1 | La columna del id no es obligatoria | Sí |
  | H5-2 | Se abre un catálogo sin terminar | Sí |
  | H5-3 | Vacío se guarda como texto vacío | Sí |
  | H5-4 | Texto demasiado largo aceptado | Sí |
  | H5-5 | Catálogo de otro proyecto aceptado | Sí, tras añadir el caso del proyecto de la misma organización |
  | H5-6 | Sin procedencia | Sí |
  | H5-7 | Revisión con otro origen | Sí |
  | H5-8 | Abrir con permiso de lectura | Sí |
  | H5-9 | La revisión dice cero filas | Sí |
  | H5-10 | Las filas no se guardan | Sí |
  | H5-11 | Celdas en la columna equivocada | Sí |
  | H5-12 | Libro archivado aceptado | Sí |

## Verificación completa de H1–H5 (2026-11-14)

| Comprobación | Resultado |
| --- | --- |
| `tsc`, `pnpm lint`, Prettier | Limpios |
| Esquema frente a las **35** migraciones (PGlite y `prisma migrate diff`) | «This is an empty migration» |
| Batería completa | **110 suites pasan (1 saltada) y 1.769 pruebas (5 saltadas)** |
| Defectos a propósito del bloque | H1 20/20, H2 14/14, H3 14/14, H4 12/12, H5 12/12 |
| Arranque real (módulo raíz, procesos de fondo y un servicio de IA de mentira) | Salud 200; 11 rutas nuevas responden 401 sin sesión; con sesión: historial, vista guardada y filas con la vista, duplicar, archivar, plantilla y catálogo inexistente 404; el reconciliador habla con su token; apagado limpio y sin errores registrados |

Una ejecución intermedia de la batería (con H1 y H2) dio un fallo en la prueba que cuenta las migraciones: la causó crear la migración 33 mientras la batería corría. Con el estado completo pasa.

**No ejecutado entonces:** `pnpm db:verify` y `pnpm test:features:postgres`.

*Corrección del 2026-11-14:* `pnpm db:verify` no usa Cloud SQL ni el proxy. Crea una PGlite y le pasa `DATABASE_URL` por el entorno, que gana al `.env`. Se ejecutó al cerrar C7: 3 de 3, con las 35 migraciones. El usuario aplicó las migraciones 32–35 en Cloud SQL; `pnpm db:status` dice «Database schema is up to date!» ([bitácora 06 de C7](../graphql&rulesets-evaluations-exports/06-cliente-python-contrato-y-cobertura.md)).

## Consecuencias

- **El Bloque A queda completo en Nest.** Con el Bloque B (V2–V5), el backend cubre lo de antes del CSV y lo de después del TSV.
- Las 21 rutas de H1–H5 están en la [matriz de C7](../../../docs/fonts/feature/graphql&rulesets-evaluations-exports/05-inventario-y-alcance-de-c7.md): 85 de 109 con equivalente previsto (78,0 %).
- Las migraciones 32, 33, 34 y 35 ya están aplicadas en Cloud SQL (2026-11-14).
