# 06 — C6: acceso por membresía en los módulos antiguos (E1.2)

Fecha de creación: 2026-11-08  
Última actualización: 2026-11-08  
Estado: Implementado y verificado (2026-11-08). La migración de C6.5 está aplicada en Cloud SQL (el usuario, con `db:status` y después `db:migrate`).  
Relacionada con: [plan 01 de cierre](../../../docs/plans/feature/cierre-backend/01-plan-cierre-de-pendientes.md) (P6), [fuentes 03, acceso por membresía](../../../docs/fonts/feature/cierre-backend/03-fuentes-de-acceso-por-membresia.md), [plan de organizaciones](../../../docs/plans/feature/organizations&access/01-plan-organizaciones-y-acceso.md) (E1.2), [bitácora de Cloud SQL](../../google-cloud/db/01-cloud-sql-propio.md).  
Revisión de partida: `feature/cierre-backend` `5c276ca` más el cambio a Cloud SQL sin commit.

## Necesidad

Las 31 rutas de `/projects/:projectId/…` (proyectos, importaciones de catálogo, reglas, evaluaciones, exportaciones TSV, feeds y actualizaciones) solo las puede usar quien creó el proyecto. Con organizaciones, decide la membresía y el rol.

## Decisiones del usuario (2026-11-08)

El usuario pidió hacer C6 «con esos detalles», refiriéndose a las dos propuestas de la ficha 03, que no cambió:

- **Permisos:** leer, cualquier miembro (también con la organización archivada); importar, crear reglas, evaluar y lanzar una actualización, `worksheet.write`; aprobar la exportación TSV, crear, publicar y configurar el feed, y cambiar la configuración del canal, `changeset.approve`; borrar el proyecto, `members.manage` (Admin u Owner).
- **`GET /projects`** lista los proyectos de todas las organizaciones de la persona.

Las pruebas siguen en PGlite y en el contenedor local; la migración de C6.5 en Cloud SQL la aplica el usuario.

## Pausa y reanudación (2026-11-08)

Al empezar C6.1, el usuario había entendido «membresía» como un pago o una suscripción y pidió dejar el código como estaba; se deshizo con `git checkout`. Tras explicarle que es ser miembro de una organización (y que, como Owner de su organización personal, su flujo no cambia), pidió implementarlo completo para cerrar la API.

## Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| E17 (ficha 03): `findMemberAccess` y `can` ya existían | Una sola pieza de acceso | [`project-access.ts`](../../../src/projects/project-access.ts): `isProjectMember` (predicado del `WHERE`, O8), `PROJECT_ACCESS_COLUMNS` y `joinProjectAccess` (acceso en la misma consulta que bloquea el proyecto) y `assertProjectPermission` (404 → 409 → 403) |
| H1, H2 | La puerta de las rutas: `ProjectsService.requireAccess(identity, projectId, permiso)` y `findVisible` | `projects.service.ts`; `ProjectsRepository.findAccess`, `findVisible`, `findAllForMember` |
| E18, E19, H2: revalidar al aceptar un trabajo y bloquear en el mismo orden | Las escrituras que ya bloqueaban el proyecto comprueban el permiso **dentro** de su transacción, con `FOR UPDATE OF p` | `CatalogImportRepository.accept`, `deleteSnapshot` y `deleteProject`; `lockConfiguredProject` (reglas); `lockProjectForEvaluation` (evaluaciones) |
| E16 | Las lecturas filtran por membresía en SQL | Exportaciones, feeds y actualizaciones: `isProjectMember` en lugar de `p.owner_id` |
| E20 | Se retira el requisito de propietario del puente de E5.4 | `assertCanSendToCatalog` sin el 403 `WORKSHEET_CATALOG_OWNER_REQUIRED`; el paso extra de `accept` ya no recomprueba (lo hace `accept`) |
| E21 | `organization_id` obligatorio | Migración `20261108100000_require_project_organization`: se para si quedara algún proyecto sin organización y después `SET NOT NULL`; `schema.prisma` |

## Permisos aplicados

| Rutas | Permiso |
| --- | --- |
| Todas las lecturas (proyecto, importaciones, trabajos, reglas, evaluaciones y sus filas y `errors.csv`, exportaciones y `productos.tsv`, feeds, versiones, actualizaciones) y `GET /projects` | Cualquier miembro (`organization.read`), también con la organización archivada |
| Importar (guard y `accept`), borrar una importación, crear reglas, evaluar, lanzar una actualización | `worksheet.write` |
| Aprobar la exportación TSV, crear, publicar y configurar el feed (fuente, programación, política, token), `PATCH` del proyecto | `changeset.approve` |
| `DELETE /projects/:id` | `members.manage` |
| Cualquier escritura con la organización archivada | 409 `ORGANIZATION_ARCHIVED` |

## Ajustes al escribir el código

- **`findMemberAccess` no cambia** (una prueba de E1 espera exactamente `{ organizationId, role }`); la puerta usa un método aparte, `findAccess`, que añade si la organización está archivada.
- **`requireConfigured` sigue devolviendo el proyecto** y su permiso es un parámetro (`worksheet.write` por defecto): las aserciones de proyectos no cambian.
- **El campo `ownerId` de `Acceptance` y de las evaluaciones conserva su nombre** (lo comprueban pruebas existentes), pero ahora es «quien acepta»; un comentario lo dice donde se declara.
- **Los borrados del catálogo comprueban el permiso en su transacción** en lugar de en el servicio: así no hace falta otra dependencia y se revalida con el proyecto bloqueado.
- **La actualización automática del feed sigue corriendo en nombre de quien creó el proyecto** (el feed no guarda quién aprobó su política). Como `accept` y la evaluación revalidan ahora el acceso, si esa persona deja la organización o pierde el permiso, la actualización falla en lugar de importar. Mejora pendiente: guardar `policy_approved_by` al aprobar la política y actuar en su nombre.
- **Se quitó `UsersService` de los servicios de exportaciones, feeds y actualizaciones**: ya no lo usaban.

## Pruebas existentes que cambiaron, y por qué

- **Nombres** (sin cambiar lo que comprueban): `findOwned` → `findVisible`; `findByOwner` y `findAllByOwner` de proyectos → `findVisible` y `findAllForMember`; los dobles de `projects.service.spec.ts` simulan además `findAccess` (Alice es Owner).
- **Preparación:** las filas de proyecto «heredadas» de `projects.e2e-spec.ts` y `projects.repository.int-spec.ts` se crean ahora dentro de la organización personal (ayudante nuevo [`legacy-project.ts`](../../../test/features/support/legacy-project.ts)), como quedaron tras el backfill de E1: desde C6.5 un proyecto sin organización no se puede insertar. La prueba del proyecto huérfano lleva una organización real, para seguir probando la clave foránea del propietario.
- **Comportamiento, a propósito:**
  - `organizations.int-spec.ts` «un proyecto heredado sin organización todavía no es visible» pasa a «un proyecto ya no puede existir sin organización (NOT NULL)»;
  - la E2E de acceso de E5.4: un Editor que no creó el proyecto ya puede llevar la hoja al catálogo (antes 403 `WORKSHEET_CATALOG_OWNER_REQUIRED`).

## Comprobaciones realmente ejecutadas

2026-11-08.

- **E2E nueva** [`project-roles.e2e-spec.ts`](../../../test/features/projects/project-roles.e2e-spec.ts) (6), con Alice creadora, Bob con cada rol y Carol de otra organización:
  - Carol, 404 en las 9 lecturas y en las escrituras, y no ve el proyecto en `GET /projects`;
  - un lector ve todo y recibe 403 al escribir, y el guard rechaza la subida antes de recibir el archivo;
  - un Editor crea reglas y evalúa, pero no exporta, publica, cambia ni borra;
  - un Manager exporta y cambia el proyecto, pero no lo borra;
  - un Admin lo borra;
  - con la organización archivada se lee y se recibe 409 al escribir.
- **Módulos afectados** (proyectos, catálogo, reglas, evaluaciones, exportaciones, feeds, actualizaciones, GraphQL, puente y organizaciones): 809 pruebas, todas pasan antes de la E2E nueva.
- **Suite completa** (PGlite): 92 suites y 1.520 pruebas, 5 saltadas. **`pnpm test:features:postgres`**: 5 de 5. **`pnpm db:verify`**: 3 de 3. **Esquema frente a 30 migraciones**: «This is an empty migration». `tsc`, `pnpm lint` y Prettier, limpios.
- **Defectos a propósito** (copia limpia; pruebas de roles, proyectos, catálogo y puente):

  | Defecto | Resultado |
  | --- | --- |
  | Membresía sin filtrar por persona; sin comprobar el permiso; archivada admite escrituras | Detectados |
  | `PATCH` con permiso de lectura; exportar como Editor; reglas, evaluar o borrar una importación sin permiso; borrar el proyecto como Editor; publicar con permiso de lectura | Detectados |
  | Listado sin membresía; `accept` sin permiso | Detectados |
  | Guard de subida sin permiso | **No detectado** al principio (`accept` responde igualmente 403); detectado tras añadir a la E2E que con un lector el archivo no se llega a recibir |

  13 de 13 detectados al final.

## Consecuencias

- **La API ya no depende de quién creó un proyecto**: decide la organización. Para el usuario (Owner de su organización personal) nada cambia.
- **Migración aplicada en Cloud SQL** (2026-11-08, el usuario): `pnpm db:status` mostró pendiente solo `20261108100000_require_project_organization`; `pnpm db:migrate` (`prisma migrate deploy`) la aplicó: «All migrations have been successfully applied». La base tiene ya las 30.
- **Pendiente:** `policy_approved_by` para la actualización automática del feed; GraphQL (C7) expone por ahora proyectos e importaciones con las mismas reglas, porque usa los mismos servicios.
