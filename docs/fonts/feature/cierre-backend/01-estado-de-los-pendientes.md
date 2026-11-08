# 01 — Estado real de los pendientes del backend

Fecha de creación: 2026-11-07  
Última actualización: 2026-11-07  
Estado: Investigación del código. Respalda el [plan 01 de cierre del backend](../../../plans/feature/cierre-backend/01-plan-cierre-de-pendientes.md).  
Relacionada con: [plan de organizaciones (E1.2)](../../../plans/feature/organizations&access/01-plan-organizaciones-y-acceso.md), [plan de E4](../../../plans/feature/changesets/01-plan-e4-borradores-y-revisiones.md), [plan de E5](../../../plans/feature/imports&exports/01-plan-e5-importar-y-exportar-hojas.md), [plan aplazado de GraphQL](../../../plans/feature/graphql&rulesets-evaluations-exports/01-plan-aplazado-sincronizacion-graphql.md), [plan de jobs&files (recibos)](../../../plans/feature/jobs&files/01-plan-ejecucion-y-archivos.md).  
Revisión de partida: `main` `c280506` (E4 y E5 cerradas).

## Pregunta

Antes de seguir con E6, ¿qué hace falta para cerrar los siete pendientes que dejaron E1–E5, y qué ofrece ya el código para cada uno?

## Estado real del código

| ID | Pendiente | Archivo y símbolo | Hallazgo | Consecuencia |
| --- | --- | --- | --- | --- |
| E1 | Plazo de la importación | [`WorksheetImportsRepository.create`](../../../../src/worksheet-imports/worksheet-imports.repository.ts), `insertDraft` ([`changesets.repository.ts`](../../../../src/changesets/changesets.repository.ts)) | `this.prisma.$transaction(async (tx) => …)` sin opciones: usa el plazo por defecto de Prisma (5 s). Guarda todas las operaciones del borrador en un solo `jsonb` y después relee el borrador entero para responder. Con 5.000 × 200 (un millón de celdas) en PGlite tardó 6,8 s con un plazo de 30 s y respondió 500 con el de 5 s (bitácora 04 de imports&exports). Enviar (2,5 s) y aplicar (2,1 s) tampoco quedan lejos. Ninguna transacción del repositorio declara un plazo. | Medir dónde se va el tiempo antes de decidir: un plazo con nombre por operación larga, menos trabajo dentro de la transacción, o las dos cosas. Medir también en PostgreSQL real (E4). |
| E2 | E1.2 | Repositorios de `catalog-import`, `rulesets`, `evaluations`, `exports`, `feeds`, `feed-refreshes` y `projects` | Todos filtran por `p.owner_id = ${ownerId}`. `projects.organization_id` admite nulos (O3). El plan de organizaciones describe E1.2 («sustituir `owner_id` por la membresía… módulo a módulo y con sus pruebas sin cambiar») y la retiró el usuario el 2026-11-05. E5.4 añadió un 403 `WORKSHEET_CATALOG_OWNER_REQUIRED` que existe solo por esa retirada. | Retomarla es la etapa más grande. El orden y las aserciones sin cambiar ya están decididos; faltan qué permiso pide cada acción del catálogo y el feed, y los recursos que hoy dependen del propietario (rutas `/projects/:projectId/…`, workers, URL pública del feed). |
| E3 | Concurrencia de E4 | [`changesets.int-spec.ts`](../../../../test/features/changesets/changesets.int-spec.ts), [`test-database.ts`](../../../../test/features/support/test-database.ts) | Toda la batería usa PGlite detrás de un socket con 5 conexiones, pero PGlite ejecuta una consulta cada vez: dos `apply` a la vez nunca compiten de verdad. La bitácora 01 de changesets deja T07 y T09 «con dos conexiones» pendientes. `docker` (OrbStack) está instalado; el usuario lo arrancó el 2026-11-07 (servidor 29.8.2) y ya tiene la imagen `postgres:15.2` en local, así que no hace falta descargar nada. No hay `postgres` ni `psql` fuera de Docker. | Hace falta un PostgreSQL real y local para esa prueba: un contenedor de OrbStack, arrancado por el usuario, y una prueba que solo se ejecute cuando se le da la URL de ese contenedor. |
| E4 | Cambiar el tipo de una columna | [`changeset-schema.ts`](../../../../src/changesets/changeset-schema.ts), [`cell-values.ts`](../../../../src/worksheets/cell-values.ts), [`import-plan.ts`](../../../../src/worksheet-imports/import-plan.ts) | E4.7 hace añadir, renombrar y borrar columnas con detección de fórmulas; cambiar el tipo se aplazó (D12 del plan de E4) porque exige previsualizar los valores incompatibles. E5.1 ya tiene una conversión estricta de texto a cada tipo (D4) que se puede reutilizar. | Una operación nueva de borrador que convierta cada celda guardada con reglas estrictas, informe de cada valor incompatible y compruebe las fórmulas que dependen de la columna. |
| E5 | Proyecto duplicado con doble clic | [`ProjectsController.create`](../../../../src/projects/projects.controller.ts), [`audit-trail.ts`](../../../../src/audit/audit-trail.ts) (`findReceipt`, `saveReceipt`) | `POST /projects` no admite `Idempotency-Key`. Los recibos de operación ya existen: los creó E4 para `apply` (por organización, actor, operación, recurso y clave, con el hash del cuerpo). El plan de jobs&files los dejó pendientes para esta sola ruta porque «una segunda infraestructura de recibos para una sola ruta sería estructura de más»; ahora la infraestructura ya existe. | Reutilizar `operation_receipts` con una clave opcional: sin cabecera, la ruta se comporta igual que hoy. |
| E6 | E2E inestable | [`ImportUploadInterceptor`](../../../../src/catalog-import/import-upload.interceptor.ts) (`_handleFile`, `_removeFile`), prueba «multipart incompleto devuelve 400 y limpia cualquier temporal» | El almacenamiento de multer guarda la subida con `void this.store.receive(…).then(…)` y la borra con `void this.store.removeTemporary(…).then(…)`. Cuando el multipart está cortado, la respuesta 400 puede salir antes de que termine ese borrado, y la prueba ve el temporal en `tmp/`. Falla a veces con la batería completa. | Reproducirlo con repeticiones antes de tocarlo y hacer que la respuesta espere a la limpieza. La prueba no cambia. |
| E7 | GraphQL | [`src/graphql/`](../../../../src/graphql/), plan aplazado | Expone `me`, proyectos e importaciones de catálogo (consultas y mutaciones) con límite de profundidad. Reglas, evaluaciones, exportaciones, feeds, organizaciones, hojas, borradores, importaciones y exportaciones de hojas solo existen en REST. El plan aplazado pide inventario, las necesidades N1–N13, el experimento de `@InputType({ isOneOf: true })` y la paridad de validación entre REST y GraphQL. | Es la última etapa: la autorización por membresía (E1.2) debe estar resuelta antes, para no hacerla dos veces. |

## Requisitos

| ID | Documento y pasaje | Qué exige |
| --- | --- | --- |
| H1 | [11], «Modelo de acceso», líneas 73–80 | Roles y operaciones: leer todos; crear borrador e importar desde Editor; aprobar y aplicar desde Manager; gestionar miembros desde Admin. `owner_id` queda como procedencia, «sin convertirlo en un bypass permanente». |
| H2 | [11], línea 84 | Recurso ajeno → 404; visible sin permiso → 403; revalidar la autorización al aceptar un trabajo. |
| H3 | [12], «Identidad y tipos de celda» | «Una conversión de tipo previsualiza cada valor incompatible; nunca trunca, redondea o borra silenciosamente.» |
| H4 | [13], línea 73 | Un tipo cambiado frente a una edición es un conflicto estructural, no una celda vacía. |
| H5 | [16], línea 117, y [11], línea 114 | GraphQL añade lecturas sobre los mismos servicios cuando la UI las necesite; multipart, descargas y SSE siguen en REST; límite de coste y de cantidad además de profundidad; DataLoader por petición; pruebas de autorización equivalentes en los dos transportes. |
| H6 | [18], T02 | «ID ajeno por REST, GraphQL, job, archivo y conversación no devuelve datos». |
| H7 | [12], línea 60 | Límites de lanzamiento: 5.000 filas, 200 columnas y un millón de celdas; la importación del máximo tiene que funcionar. |

## Fuentes ya registradas que se reutilizan

- **Recibos e idempotencia:** fichas de changesets (D8 del plan de E4) y de jobs&files (D11).
- **Membresía en cada consulta:** C6 y O8 del plan de organizaciones.
- **GraphQL:** fichas 01–04 de `graphql&rulesets-evaluations-exports` y sus cuatro reconstrucciones.
- **Conversión estricta de valores:** D4 de E5.1 (fuentes 01 de imports&exports).

Cada etapa abre su propia ficha solo si necesita fuentes nuevas, por ejemplo para medir con PostgreSQL real o para el permiso de cada acción del feed.

## Mapa

| Necesidad | Requisito | Hallazgo | Decisión del plan |
| --- | --- | --- | --- |
| Importar el máximo sin 500 | H7 | E1 | P1 |
| Crear un proyecto una sola vez | — | E5 | P2 |
| Batería estable | — | E6 | P3 |
| Concurrencia probada de verdad | — | E3 | P4 |
| Cambiar el tipo sin perder datos | H3, H4 | E4 | P5 |
| Acceso por membresía | H1, H2, H6 | E2 | P6 |
| GraphQL al día | H5, H6 | E7 | P7 |
