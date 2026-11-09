# 03 — Fuentes del acceso por membresía en los módulos antiguos (C6, E1.2)

Fecha de creación: 2026-11-08  
Última actualización: 2026-11-08  
Estado: Investigación (aplicada en C6, 2026-11-08). Concreta P6 del [plan 01 de cierre](../../../plans/feature/cierre-backend/01-plan-cierre-de-pendientes.md).  
Relacionada con: [fuentes 01](01-estado-de-los-pendientes.md) (E2), [plan de organizaciones](../../../plans/feature/organizations&access/01-plan-organizaciones-y-acceso.md) (E1.2, O3, O8), [roles y permisos](../../../../src/organizations/organization-roles.ts).  
Revisión de partida: `feature/cierre-backend` `5c276ca` más el cambio a Cloud SQL sin commit.

## Pregunta

¿Qué permiso de la organización pide cada ruta antigua de `/projects/:projectId/…`, y cómo se cambia el filtro por `owner_id` por la membresía sin cambiar rutas, cuerpos ni respuestas?

## Estado real del código

| ID | Hallazgo | Consecuencia |
| --- | --- | --- |
| E16 | Siete repositorios filtran por `p.owner_id` (proyectos, importaciones de catálogo, reglas, evaluaciones, exportaciones, feeds y actualizaciones): unas 150 referencias en 31 rutas. | Cambio módulo a módulo, con las pruebas existentes como red. |
| E17 | `ProjectsRepository.findMemberAccess(userId, projectId)` ya devuelve la organización del proyecto y el rol del usuario; `can(role, permiso)` decide. Hojas y borradores usan `lockProjectFor` (bloquea la organización, comprueba miembro, archivada y permiso). | Una sola pieza de acceso para todos: leer comprueba la membresía en el `WHERE` (O8); escribir, además el permiso y que la organización no esté archivada. |
| E18 | Los workers (importación, evaluación, actualización del feed) trabajan por id de trabajo, sin actor. La actualización programada del feed acepta la importación como su `ownerId`. La URL pública del feed usa un token. | Los workers no cambian. La actualización programada tiene que comprobar, al aceptar, que quien la configuró sigue pudiendo (H2: «revalidar autorización al aceptar un trabajo»). El token público no cambia. |
| E19 | Bloqueos: `CatalogImportRepository.accept` y `deleteProject` bloquean el proyecto; las escrituras de hojas bloquean antes la organización. | Si una escritura antigua bloquea la organización, lo hace **antes** que el proyecto, en el mismo orden que las hojas, para no crear interbloqueos. |
| E20 | E5.4 añadió el 403 `WORKSHEET_CATALOG_OWNER_REQUIRED` solo porque el catálogo era del propietario. | Se retira: pasa a ser el permiso de la organización. |
| E21 | Cloud SQL nuevo: base vacía (2026-11-08). | Antes de `projects.organization_id NOT NULL` no hay nulos que corregir; la migración igualmente comprueba y falla si los hubiera. |

## Requisitos

H1 y H2 de la [ficha 01](01-estado-de-los-pendientes.md): leer, cualquier miembro; preparar (borrador, importar), Editor; aprobar y aplicar datos, Manager; gestionar miembros, Admin. Ajeno → 404; visible sin permiso → 403. `owner_id` queda como procedencia, «sin convertirlo en un bypass permanente».

## Permiso propuesto por ruta

| Rutas | Permiso | Por qué |
| --- | --- | --- |
| Toda lectura (`GET`): proyecto, importaciones, trabajos, reglas, evaluaciones y sus filas y `errors.csv`, exportaciones y `productos.tsv`, feeds, versiones, actualizaciones | `organization.read` (cualquier miembro, también con la organización archivada) | Leer y exportar son lecturas ([17]). |
| `POST imports`, `DELETE imports/:id`, `POST rulesets`, `POST evaluations`, `POST feeds/:id/refreshes` | `worksheet.write` (Editor o más) | Preparan trabajo, igual que un borrador o una importación de hoja. |
| `POST exports` (aprobar el TSV), `POST feeds`, `POST feeds/:id/publications`, `PUT feeds/:id/source`, `schedule`, `policy`, `POST`/`DELETE feeds/:id/delivery-token`, `PATCH projects/:id` (configuración del canal) | `changeset.approve` (Manager o más) | Aprueban lo que sale al canal o cambian su política: equivale a aprobar datos. |
| `DELETE projects/:id` | `members.manage` (Admin o Owner) | Borra todo el proyecto y sus archivos. |
| `POST /projects` | — (sin cambio) | Crea el proyecto en la organización personal de quien lo crea. |
| `GET /projects` | Ver la decisión del usuario | Hoy lista los que creó la persona. |

Cualquier escritura con la organización archivada: 409 `ORGANIZATION_ARCHIVED` (como en hojas).

## Mapa

| Necesidad | Hallazgos | Subetapa |
| --- | --- | --- |
| Pieza común de acceso | E17, E19 | C6.1 |
| Proyectos | E16 | C6.1 |
| Importaciones de catálogo y puente de E5.4 | E16, E19, E20 | C6.2 |
| Reglas y evaluaciones | E16 | C6.3 |
| Exportaciones, feeds y actualizaciones | E16, E18 | C6.4 |
| `organization_id NOT NULL` y `owner_id` como procedencia | E21 | C6.5 |
