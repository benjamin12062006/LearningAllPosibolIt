# 09 — H6.1: selecciones y vistas previas de hoja

Fecha de creación: 2026-11-14  
Estado: Implementado y verificado (2026-11-14). Código iniciado por otra sesión y terminado en esta.  
Relacionada con: [fuentes 06](../../../docs/fonts/feature/ai-assistant/06-fuentes-de-herramientas-de-hoja.md), [plan H6](../../../docs/plans/feature/ai-assistant/04-plan-herramientas-de-hoja-del-agente.md).  
Revisión de partida: Nest `7be788b` más E6.1b.2 y E6.2 en el árbol de trabajo.

## Necesidad

Nest fija las filas seleccionadas y su revisión. Una transformación de prueba genera un diff verificable antes de permitir la creación de un borrador.

## Cierre (2026-11-14)

Otra sesión dejó escritos la selección, la vista previa y la propuesta (punto de control `b6aada9`), sin pruebas. Esta sesión los probó, corrigió un fallo y cerró la etapa.

### Fallo encontrado por las pruebas

**Todo nacía caducado.** La caducidad se guardaba en `TIMESTAMPTZ` y se leía como `Date` por el adaptador de Prisma, que ignora la zona de la sesión. En una máquina en UTC−5 la fecha volvía desplazada cinco horas, y cualquier selección recién creada respondía `AI_SHEET_SELECTION_EXPIRED`. Ahora la caducidad se lee como texto ISO en UTC desde SQL (`isoUtc` en [`worksheet-tools.repository.ts`](../../../src/worksheet-tools/worksheet-tools.repository.ts)), como ya hacían las invitaciones. Las tablas nuevas de IA guardan sus fechas como texto ISO.

### Ajuste al plan

**`propose_sheet_layout` no tiene ruta propia ni flujo de revisión aparte** (H6.3 del plan 04). Pasa a ser una operación de escritura del catálogo de E6.3a: el agente la prepara, y la confirmación de la persona crea la hoja vacía con el mismo servicio que `POST …/workbooks/:id/worksheets`. Así no hay reserva de ID ni un segundo ciclo de borrador para una hoja sin datos. La confirmación ya es el acto humano que exige el plan E6 (D9).

### Comprobaciones realmente ejecutadas

- **Pruebas:** 7 E2E en [`worksheet-tools.e2e-spec.ts`](../../../test/features/worksheet-tools/worksheet-tools.e2e-spec.ts). Cubren:
  - 5 % exacto (`10.50 → 11.03`, `12.00 → 12.60`, `1.5 → 1.58`) y la propuesta como borrador `ai` sin tocar la hoja;
  - reintento con la misma clave, la clave reutilizada (422) y la vista previa ya usada (409);
  - el diff paginado;
  - selección por filtro, `map_values` y celdas con problemas;
  - la validación: filas borradas, sin filtro, límites y transformaciones mal formadas;
  - una revisión que cambia y la caducidad;
  - los permisos: sin sesión, otra organización, Viewer, la selección de otra persona y la hoja archivada;
  - la paridad con GraphQL.
- **Matriz de C7:** las 4 rutas entran como «Existe». Quedan 95 de 119 con equivalente (79,8 %). El esquema esperado está regenerado.
- **Esquema frente a las 37 migraciones:** «This is an empty migration».
- **Defectos a propósito: 12 de 12 detectados.** H6-3 no compilaba en su primera forma; se reescribió y se repitió.

  | Id | Defecto | Detectado |
  | --- | --- | --- |
  | H6-1 | El porcentaje sustituye en vez de sumar | Sí |
  | H6-2 | Sin redondear | Sí |
  | H6-3 | Recortar texto también en decimales | Sí |
  | H6-4 | Filas borradas aceptadas | Sí |
  | H6-5 | Columnas fuera de la selección | Sí |
  | H6-6 | Propuesta con la clave reutilizada | Sí |
  | H6-7 | Un Viewer transforma | Sí |
  | H6-8 | No se mira la revisión vigente | Sí |
  | H6-9 | Vista previa reutilizable | Sí |
  | H6-10 | Vista previa caducada aceptada | Sí |
  | H6-11 | Propuesta con celdas con problemas | Sí, tras añadir el caso con una celda válida y otra con problema |
  | H6-12 | Selecciones de otra persona | Sí |

- La migración 37 (`create_worksheet_transform_previews`) la aplica el usuario en Cloud SQL.
- La limpieza de selecciones y vistas previas caducadas (`deleteExpired`) la llama el worker de E6.3a en cada pasada.
