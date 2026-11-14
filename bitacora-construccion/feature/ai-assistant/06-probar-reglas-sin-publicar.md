# 06 — V5: probar reglas sin publicar (vista previa)

Fecha de creación: 2026-11-13  
Estado: Implementado y verificado (2026-11-13). Sin commit.  
Relacionada con: [plan 02 de cierre](../../../docs/plans/feature/cierre-backend/02-plan-terminar-hojas-visor-y-agente.md) (P6), [fuentes 04](../../../docs/fonts/feature/cierre-backend/04-fuentes-de-terminar-hojas-visor-y-agente.md) (E4, H6), [bitácora 05, V4](05-comparar-con-la-version-vigente.md), [22, visor y diagnóstico](../../../../docs-diagrams/22-visor-y-diagnostico-del-feed.md).  
Revisión de partida: `feature/cierre-backend` `3733be4`.

## Necesidad

Hasta ahora, para saber qué hace un cambio de reglas había que guardarlas como revisión nueva, pedir una evaluación y comparar a ojo con la anterior. El documento 22 pide probar reglas propuestas sobre el mismo catálogo y ver, antes de guardar nada, qué valores cambian, qué productos quedan fuera y qué problemas aparecen, se resuelven o siguen.

## Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| `evaluateRow` es una función sin efectos: misma entrada, mismo resultado (RC7 de evaluaciones) | Pasar el **mismo motor** dos veces por las filas, con las reglas guardadas y con las propuestas, sin persistir | `EvaluationsService.previewRules` en [`evaluations.service.ts`](../../../src/evaluations/evaluations.service.ts) |
| H6: valor anterior y nuevo por atributo, problemas que aparecen, se resuelven o siguen | Comparación pura de dos listas de resultados | `compareOutcomes` en [`rules-preview.ts`](../../../src/evaluations/rules-preview.ts) |
| Una importación tiene como mucho 5.000 filas | Síncrono y en memoria; el catálogo se lee por lotes de 250, como el worker | `readCatalog`, `EvaluationsRepository.readCatalogRows` |
| Guardar unas reglas ya valida su forma y su coherencia | El body es el mismo que al guardarlas y pasa por las mismas funciones | `PreviewRulesDto extends CreateRulesetDto`; `toRuleset` y `assertRulesetIsConsistent`, ahora exportadas de [`rulesets.service.ts`](../../../src/rulesets/rulesets.service.ts) |
| Pedir una evaluación comprueba que el catálogo está listo y que las columnas del mapeo existen | Mismos errores: `IMPORT_NOT_FOUND`, `EVALUATION_SNAPSHOT_NOT_READY`, `RULESET_NOT_FOUND`, `EVALUATION_COLUMN_MISSING` | `findPreviewSource`, `assertColumnsExist` en [`evaluations.repository.ts`](../../../src/evaluations/evaluations.repository.ts) |

## Contrato

```http
POST /api/v1/projects/:projectId/evaluations/preview?limit=20&offset=0
```

```json
{
  "snapshotId": "…",
  "baseRevision": 1,
  "mapping": [{ "attribute": "title", "column": "Nombre" }],
  "rules": [{ "type": "build_title", "template": "{title} - {brand}" }]
}
```

`mapping` y `rules` son los de `POST …/rulesets`. Sin `baseRevision` se compara con la última revisión guardada. Responde `200`:

```json
{
  "preview": {
    "snapshotId": "…",
    "baseRevision": 1,
    "counts": {
      "current": { "total": 7, "valid": 3, "invalid": 2, "excluded": 2 },
      "proposed": { "total": 7, "valid": 2, "invalid": 2, "excluded": 3 }
    },
    "problems": {
      "appeared": [{ "attribute": "title", "code": "TEXT_TOO_LONG", "productCount": 1, "problem": { "es": "…", "en": "…" }, "suggestion": { "es": "…", "en": "…" } }],
      "resolved": [{ "attribute": "description", "code": "TEXT_HAS_LINE_BREAK", "productCount": 1 }],
      "persisting": [{ "attribute": "price", "code": "…", "productCount": 1 }]
    },
    "outcomeChanges": [{ "from": "invalid", "to": "valid", "productCount": 1 }],
    "changedValues": [{ "attribute": "title", "productCount": 4 }],
    "changedProducts": 5,
    "products": [
      {
        "sourceRow": 1, "externalId": "SKU-1",
        "current": { "outcome": "valid", "problems": [], "excludedByRule": null },
        "proposed": { "outcome": "valid", "problems": [], "excludedByRule": null },
        "values": [{ "attribute": "title", "before": "Acme Mesa SKU-1", "after": "Mesa SKU-1 - Acme - oferta" }]
      }
    ],
    "page": { "limit": 20, "offset": 0, "hasMore": false }
  }
}
```

- Todo es del catálogo entero menos `products`, que es la página pedida de los productos a los que les cambia algo, en el orden del catálogo.
- A un producto «le cambia algo» si cambia su resultado, sus problemas o algún valor.
- En `values`, `null` es que con esas reglas el producto no tiene ese atributo; no es lo mismo que vacío.

| Caso | Respuesta |
| --- | --- |
| Viewer | 403 `FORBIDDEN` |
| Editor o más | 200 |
| Otra organización | 404 `PROJECT_NOT_FOUND` |
| Catálogo inexistente o de otro proyecto | 404 `IMPORT_NOT_FOUND` |
| `baseRevision` inexistente, o proyecto sin reglas guardadas | 404 `RULESET_NOT_FOUND` |
| Reglas mal formadas o incoherentes | 400 (`VALIDATION_FAILED`) |
| Mapeo a una columna que el catálogo no tiene | `EVALUATION_COLUMN_MISSING`, como al pedir una evaluación |

## Ajustes al escribir el código

- **La ruta es `POST …/evaluations/preview`, no `…/rulesets/preview`.** El plan la ponía en reglas. Vive en evaluaciones porque es una evaluación que no se guarda: ese módulo es el dueño del motor y ya lee el catálogo y las revisiones; reglas es el módulo de abajo y no debe depender de él. Anotado en el plan (P6).
- **Pide Editor, aunque no escribe.** Probar reglas es parte de prepararlas, que ya pide Editor; un Viewer no las edita.
- **La posición de la regla que excluye no cuenta como cambio.** Insertar una regla mueve la posición de todas las siguientes; marcar por eso todos los excluidos como cambiados sería ruido. La posición se devuelve igualmente en `excludedByRule`.
- **De un producto excluido no se comparan valores:** el motor no los calcula. Su cambio lo dice el resultado.
- `CURRENCY_PATTERN` pasó del worker a `evaluations.types.ts` para que la vista previa compruebe la moneda con la misma expresión. El worker no cambia de comportamiento.
- El caso de prueba «problema nuevo» iba a ser un tabulador en el nombre; no sirve, porque montar el título ya normaliza los espacios. Se cambió por un título que con la plantilla propuesta supera los 150 caracteres.

## Comprobaciones realmente ejecutadas (2026-11-13)

- **Pruebas de la vista previa:** 30 de 30.
  - 10 unitarias de `compareOutcomes` ([`rules-preview.spec.ts`](../../../test/features/evaluations/rules-preview.spec.ts)): sin cambios; reparto de problemas en nuevos, resueltos y los que siguen; el orden de los problemas no cuenta; cambios de resultado por origen y destino; valor anterior y nuevo; vacío frente a ausente; excluidos sin valores; otra posición de regla no cuenta; orden del catálogo; catálogos distintos.
  - 20 E2E ([`rules-preview.e2e-spec.ts`](../../../test/features/evaluations/rules-preview.e2e-spec.ts)) con el motor real y un catálogo de siete productos: recuentos con unas reglas y con otras; un problema que aparece, uno que se resuelve y uno que sigue, con sus textos; atributos que cambian; el antes y el después de cada producto; las mismas reglas no cambian nada; **los recuentos «vigentes» coinciden con una evaluación real**; **no crea reglas, evaluaciones ni filas**; con qué revisión se compara, también cuando otro proyecto tiene una posterior; catálogo de otro proyecto 404; un catálogo de 260 filas (más de un lote); paginación con recuentos del catálogo entero; validación; reglas incoherentes; columna inexistente; Viewer 403, Editor 200, otra organización 404, sin sesión 401.
- **Defectos a propósito:** **20 de 20 detectados** (19 por las pruebas y 1 por el compilador).

  | Id | Defecto | Resultado |
  | --- | --- | --- |
  | V5-1 | Las dos evaluaciones usan las reglas vigentes | Detectado |
  | V5-2 | Vigentes y propuestas intercambiadas | Detectado |
  | V5-3 | Probar reglas con permiso de lectura | Detectado |
  | V5-4 | Reglas incoherentes aceptadas | Detectado |
  | V5-5 | Columnas de las propuestas sin comprobar | Detectado |
  | V5-6 | Leer solo el primer lote del catálogo | Detectado, tras añadir la prueba de 260 filas |
  | V5-7 | Página sin la fila de más (`hasMore`) | Detectado |
  | V5-8 | Productos cambiados = los de la página | Detectado |
  | V5-9 | Problemas sin textos en los productos | Detectado |
  | V5-10 | Catálogo de otro proyecto aceptado | Detectado |
  | V5-11 | `baseRevision` ignorada | Detectado |
  | V5-12 | Sin `baseRevision` usa la primera revisión | Detectado |
  | V5-13 | La revisión base sale de otro proyecto | Detectado, tras añadir la prueba con dos proyectos |
  | V5-14 | Otra posición de regla cuenta como cambio | Detectado |
  | V5-15 | Los problemas que siguen cuentan como nuevos | Detectado |
  | V5-16 | No anotar los problemas resueltos | Detectado |
  | V5-17 | Comparar valores de un excluido | Detectado por el compilador (un excluido no tiene `values`) |
  | V5-18 | Atributo ausente tratado como vacío | Detectado |
  | V5-19 | Recuentos sin orden por frecuencia | Detectado |
  | V5-20 | `baseRevision` 0 aceptada | Detectado |

  V5-6 y V5-13 no se detectaban al principio: faltaban un catálogo de más de un lote y un segundo proyecto con una revisión posterior. El V5-13 era una fuga entre organizaciones.
- **`tsc`, `pnpm lint` y Prettier:** limpios.
- **Batería completa:** 102 suites pasan (1 saltada) y 1.662 pruebas (5 saltadas).
- **Arranque real:** `POST …/evaluations/preview` responde 401 sin sesión y 404 `IMPORT_NOT_FOUND` con sesión y un catálogo inexistente; el reconciliador manda proyecto, feed y reglas; apagado limpio y sin errores registrados.
- Sin migraciones: el esquema no cambia.

## No medido

El tiempo con un catálogo de 5.000 filas. La vista previa evalúa dos veces en memoria; queda para medir junto con la importación máxima contra Cloud SQL.

## Consecuencias

- **El Bloque B (después del TSV) queda completo en Nest:** ficha, entrega, «Requiere atención», comparación de archivos y vista previa de reglas. Faltan las pantallas, que son de Nuxt.
- El agente podrá proponer reglas y enseñar su efecto antes de guardarlas, cuando exista el catálogo de operaciones.
