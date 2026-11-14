# 06 — H3: plantillas de mapeo de importación

Fecha de creación: 2026-11-14  
Estado: Implementado y verificado (2026-11-14). Sin commit. La migración 33 está pendiente de aplicar en Cloud SQL (la aplica el usuario).  
Relacionada con: [plan 02 de cierre](../../../docs/plans/feature/cierre-backend/02-plan-terminar-hojas-visor-y-agente.md) (P10), [fuentes 04](../../../docs/fonts/feature/cierre-backend/04-fuentes-de-terminar-hojas-visor-y-agente.md) (H9), [visión original, 5.2 paso 3](../../../../docs-diagrams/fuentes/2026-11-01-vision-saas-original.txt), [12, `import_mappings`](../../../../docs-diagrams/12-hojas-modelo-editor-importacion-y-exportacion.md).  
Revisión de partida: `feature/cierre-backend` `fb32457`.

## Necesidad

La visión dice que «el mapeo podrá guardarse como plantilla reutilizable». Un proveedor manda cada mes el mismo archivo con las mismas cabeceras: hoy hay que volver a mandar el mapeo entero en cada importación.

## Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| Las opciones de importación mezclan lo del archivo (título, exclusiones, separador u hoja de Excel) con lo reutilizable (modo, clave, separador decimal, booleanos y columnas) | La plantilla guarda solo lo reutilizable; así sirve igual para CSV y XLSX | `MappingTemplate`, `TEMPLATE_KEYS` en [`import-mapping.ts`](../../../src/worksheet-imports/import-mapping.ts) |
| Ya hay un validador de opciones (`parseImportOptions`) | La plantilla se valida con él, para que no exista una regla distinta | `parseMappingTemplate` |
| Las columnas van por ID y pueden borrarse después | Se comprueban al guardar (que existan y se puedan escribir) y otra vez al importar, con el error del mapeo de siempre | `unknownTemplateColumns`; el planificador de la importación |
| Mezclar en silencio la plantilla con lo que manda la petición confunde | Con `mappingId`, la petición solo puede poner lo del archivo; repetir algo de la plantilla es un error | `withTemplate` |
| Un JSON mal formado se trataba como «sin opciones»; con plantilla eso dejaría importar sin las exclusiones que la persona escribió | Un JSON mal formado es un error, con o sin plantilla | `readJsonField` en [`worksheet-imports.service.ts`](../../../src/worksheet-imports/worksheet-imports.service.ts) |
| La plantilla es de una hoja: sus IDs de columna no sirven en otra | Una plantilla de otra hoja responde como una que no existe | `findTemplate` |

No se consultaron cursos: es configuración guardada sobre el mismo validador que ya usaba la importación.

## Contrato

Bajo `P = /api/v1/organizations/:organizationId/projects/:projectId`:

| Ruta | Permiso | Respuesta |
| --- | --- | --- |
| `POST P/worksheets/:id/import-mappings` `{ name, mapping }` | Editor, hoja activa | `201 { importMapping }` |
| `GET P/worksheets/:id/import-mappings` | Miembro | `{ importMappings, page }` |
| `GET P/import-mappings/:mappingId` | Miembro | `{ importMapping }` |
| `DELETE P/import-mappings/:mappingId` | Editor, hoja activa | `204` |
| `POST P/worksheets/:id/imports` con el campo `mappingId` | Editor | La plantilla pone el mapeo; `options` (opcional) solo lleva título, exclusiones y separador u hoja |
| `POST P/worksheets/:id/imports/preview` con `mappingId` | Editor | La vista previa añade `template: { id, name, columns, missingHeaders }` |

`importMapping` es `{ id, worksheetId, name, mapping: { mode, matchColumnId, decimalSeparator, booleanLabels, columns }, createdBy, createdAt }`. La importación guarda las opciones ya combinadas como procedencia: borrar la plantilla no la cambia.

| Caso | Respuesta |
| --- | --- |
| Opción del archivo en la plantilla, o forma inválida | 400 `IMPORT_OPTIONS_INVALID` con `mapping.<campo>` |
| Columna que la hoja no tiene, calculada, o clave desconocida | 400 `IMPORT_MAPPING_INVALID` con `mapping.columns.N` o `mapping.matchColumnId` |
| Nombre repetido en la hoja (sin distinguir mayúsculas) | 409 `IMPORT_MAPPING_NAME_TAKEN` |
| Plantilla de otra hoja o inexistente | 404 `IMPORT_MAPPING_NOT_FOUND` |
| Repetir en `options` algo de la plantilla | 400 `IMPORT_OPTIONS_INVALID` con el campo |
| La hoja perdió una columna de la plantilla | 400 `IMPORT_MAPPING_INVALID` al importar |

## Ajustes al escribir el código

- **Migración 33** (`20261114100000_create_worksheet_import_mappings`), con nombre único por hoja y la auditoría `import_mapping.created` y `import_mapping.deleted`.
- **El formulario de subida** solo aceptaba sus campos conocidos (`IMPORT_INPUT_INVALID`): se añadió `mappingId` a la lista del interceptor.
- **Orden de comprobaciones de la importación:** ahora se busca a la persona antes de leer las opciones, porque la plantilla se busca con su id. Solo cambia qué error ve alguien sin registrar que además manda opciones inválidas.

## Comprobaciones realmente ejecutadas (2026-11-14)

- **Pruebas:** 24 de 24. 9 unitarias en [`import-mapping.spec.ts`](../../../test/features/worksheet-imports/import-mapping.spec.ts) y 15 E2E en [`import-mappings.e2e-spec.ts`](../../../test/features/worksheet-imports/import-mappings.e2e-spec.ts) (guardar, listar y leer con auditoría; nombre único por hoja; rechazar opciones del archivo y formas inválidas; columnas inexistentes, calculadas y clave; importar solo con el archivo; título y exclusiones propios; repetir un campo; JSON mal formado; plantilla de otra hoja, inexistente o mal formada; columna perdida; vista previa; borrar sin tocar la importación; hoja archivada; roles; otra organización). Las 129 pruebas de importación, también las que ya existían, pasan.
- **Defectos a propósito:** **14 de 14 detectados.**

  | Id | Defecto | Detectado |
  | --- | --- | --- |
  | H3-1 | La plantilla acepta opciones del archivo | Sí |
  | H3-2 | La petición puede repetir el mapeo | Sí |
  | H3-3 | Las columnas calculadas cuentan como escribibles | Sí |
  | H3-4 | La clave no se comprueba | Sí |
  | H3-5 | El servicio no mira las columnas | Sí |
  | H3-6 | Plantilla de otra hoja aceptada | Sí |
  | H3-7 | JSON mal formado tomado por «sin opciones» | Sí |
  | H3-8 | Nombre repetido sin 409 | Sí |
  | H3-9 | Plantilla nueva en una hoja archivada | Sí |
  | H3-10 | Borrar con permiso de lectura | Sí |
  | H3-11 | Leer una plantilla sin ser miembro | Sí |
  | H3-12 | La vista previa no mira las cabeceras | Sí |
  | H3-13 | Borrar no borra | Sí |
  | H3-14 | `mappingId` sin validar | Sí |

- La verificación completa se hizo con H5: ver [bitácora 08](08-abrir-un-catalogo-como-hoja.md#verificación-completa-de-h1h5-2026-11-14).

## Consecuencias

- La web puede ofrecer «usar la plantilla del mes pasado» y el agente, proponer una importación con una plantilla conocida.
