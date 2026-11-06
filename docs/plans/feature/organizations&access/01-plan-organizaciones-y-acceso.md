# 01 — Organizaciones, membresías y acceso por empresa (E1 de la ampliación)

Fecha de creación: 2026-11-02  
Última actualización: 2026-11-02 (fuentes C7 y F34 añadidas a O5 y O9 antes de cerrar E1.1); 2026-11-02 (E1.1 cerrada); 2026-11-03 (E1.3 cerrada con su [plan 02](02-plan-e1.3-equipos-e-invitaciones.md); archivado, cuotas y GraphQL pasan a E1.4); 2026-11-03 (E1.4 cerrada con su [plan 03](03-plan-e1.4-archivado-y-cuotas.md)); 2026-11-05 (E1.2 retirada del plan por decisión del usuario; migraciones confirmadas en Neon)  
Estado: E1.1, E1.3 y E1.4 implementadas y verificadas en local ([bitácora 01](../../../../bitacora-construccion/feature/organizations&access/01-organizacion-personal-y-contexto-de-acceso.md), [02](../../../../bitacora-construccion/feature/organizations&access/02-equipos-invitaciones-y-ultimo-owner.md), [03](../../../../bitacora-construccion/feature/organizations&access/03-archivar-organizaciones-y-cuotas.md)); migraciones aplicadas en Neon el 2026-11-03 (`pnpm db:status` del 2026-11-05 las da por aplicadas). **E1.2 retirada por ahora** (decisión del usuario, 2026-11-05): los módulos existentes siguen comprobando el propietario (`owner_id`); `projects.organization_id` sigue admitiendo nulos. Con ello E1 queda cerrada.  
Ámbito: `claudeLearningAllPosibolIt`, solo backend y REST. E1 de la ampliación ([18](../../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md)); no confundir con la E1 del plan de feeds.  
Relacionada con: [acta E0](../../../../../docs-diagrams/21-acta-e0-adelantar-la-ampliacion.md), [transición del backend](../../../../../docs-diagrams/11-backend-nest-organizaciones-y-transicion.md), [fuentes](../../../fonts/feature/organizations&access/01-fuentes-de-acceso-y-organizaciones.md).  
Revisión de referencia: `f6b4bf9` con cambios locales de feeds de otra sesión.

## Objetivo

Una empresa es la dueña de sus proyectos y las personas acceden por su membresía y su rol, no por ser quien creó el proyecto. E1 está completa cuando:

1. Cada propietario heredado conserva sus proyectos con los mismos IDs dentro de su organización personal (T01).
2. Una persona solo ve organizaciones y proyectos donde es miembro; un ID ajeno responde `404` (T02).
3. El rol de la membresía decide los permisos y se lee en cada petición: revocar no espera a que caduque el JWT.
4. El último `owner` no puede salir ni ser degradado sin transferir la propiedad (T03).
5. Las rutas actuales de proyectos, importaciones, reglas, evaluaciones, exportaciones y feeds se comportan igual para su propietario.

## Punto de partida

- No hay organizaciones. El acceso es `owner_id` en unas 60 consultas de seis módulos ([acta E0](../../../../../docs-diagrams/21-acta-e0-adelantar-la-ampliacion.md)).
- `ProjectsRepository.create` inserta desde `app_users`: si el perfil no existe, `404 PROFILE_NOT_FOUND`.
- Las pruebas insertan proyectos con SQL directo sin organización y vacían con `TRUNCATE app_users CASCADE`.
- Feeds está en obras en otra sesión.

## Decisiones

| ID | Decisión | Respaldo |
| --- | --- | --- |
| O1 | Tablas `organizations` y `organization_members` (PK compuesta, rol cerrado por `CHECK`). Sin `status` ni `version` todavía: llegan en E1.3 con la revocación, que es su consumidor. | [11](../../../../../docs-diagrams/11-backend-nest-organizaciones-y-transicion.md); [18](../../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md) «no crear tablas anticipadas» |
| O2 | `organizations.personal_owner_id` único: es la correspondencia idempotente «un propietario heredado → una organización personal». No se fusiona por email. | [11](../../../../../docs-diagrams/11-backend-nest-organizaciones-y-transicion.md) paso 3; F32 |
| O3 | `projects.organization_id` nullable con FK `RESTRICT`. `NOT NULL` en E1.2, cuando el backfill esté verificado en Neon. | [11](../../../../../docs-diagrams/11-backend-nest-organizaciones-y-transicion.md) pasos 2 y 6 |
| O4 | Backfill dentro de la migración, con sentencias repetibles (`ON CONFLICT DO NOTHING`, `WHERE organization_id IS NULL`). | F31, F32 |
| O5 | Doble escritura: crear un proyecto asegura en la misma transacción la organización personal y la membresía `owner`. Un proyecto nuevo nunca nace sin organización. | [11](../../../../../docs-diagrams/11-backend-nest-organizaciones-y-transicion.md) paso 4; F33, F34 |
| O6 | Roles y permisos en una función pura (`permissionsFor`). El rol se lee de la base en cada petición, no del JWT. | C3 descartado; [11](../../../../../docs-diagrams/11-backend-nest-organizaciones-y-transicion.md) |
| O7 | Ajeno → `404`; visible sin permiso → `403`. | C5; [11](../../../../../docs-diagrams/11-backend-nest-organizaciones-y-transicion.md) |
| O8 | La membresía va en el `WHERE` de cada consulta, además de la comprobación del servicio. | C6 |
| O9 | `OrganizationsModule` depende solo de usuarios. `ProjectsModule` depende de él (un proyecto pertenece a una empresa). Sin módulo `authorization` aparte hasta que haya un segundo consumidor del contexto. | C7; [18](../../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md) «no empezar por una librería genérica de permisos» |
| O10 | Las respuestas de las rutas antiguas no cambian (no aparece `organizationId` en `Project`). La información nueva va en rutas nuevas. | Contratos REST/GraphQL vigentes |

## Incrementos

1. **E1.1 — Organización personal y contexto de acceso.** Migración aditiva con backfill; doble escritura al crear proyecto; `permissionsFor`; rutas de lectura:
   - `GET /api/v1/organizations`: mis organizaciones con mi rol.
   - `GET /api/v1/organizations/:organizationId`: organización y mi acceso (rol y permisos).
   - `GET /api/v1/organizations/:organizationId/projects`: proyectos por membresía.
   - `GET /api/v1/projects/:id/access`: contexto (actor, empresa, proyecto, rol, permisos) que usarán hojas y revisiones.
2. **E1.2 — Acceso por membresía en los módulos existentes.** *Retirada por ahora (decisión del usuario, 2026-11-05); se conserva la descripción por si se retoma.* Sustituir `owner_id` por la membresía en catalog-import, rulesets, evaluations, exports y feeds, módulo a módulo y con sus pruebas sin cambiar. Requiere que feeds esté estable y el backfill aplicado en Neon. Después, `NOT NULL` y `UNIQUE (organization_id, id)` para las FK compuestas de recursos nuevos.
3. **E1.3 — Equipos** (detalle en el [plan 02](02-plan-e1.3-equipos-e-invitaciones.md); archivado, cuotas y GraphQL se separaron a E1.4). Crear organización, invitaciones con token de un solo uso (solo hash), cambiar rol, revocar y último `owner` protegido con bloqueo de filas.
4. **E1.4 — Archivado y cuotas mínimas** ([plan 03](03-plan-e1.4-archivado-y-cuotas.md)). GraphQL de organizaciones pasa al [plan GraphQL aplazado](../graphql&rulesets-evaluations-exports/01-plan-aplazado-sincronizacion-graphql.md), por la decisión del usuario de construir lo nuevo solo en REST.

## Comprobación prevista

- Migración: PGlite con datos heredados antes de migrar; conteos, IDs conservados, repetir el backfill sin duplicar (T01).
- Integración: dos usuarios, ningún dato cruzado por repositorio (C6, T02).
- E2E: las cuatro rutas con guard real, `401` sin sesión y `404` ajeno.
- Regresión: suites existentes sin cambiar sus aserciones; build y lint.

## Límites y continuidad

- La migración no se aplica en Neon en esta sesión. Antes de aplicarla, copia de seguridad; si un binario antiguo crea proyectos después de migrar, volver a ejecutar las tres sentencias del backfill (son repetibles).
- `403` no se ejerce en E1.1: todas las rutas son de lectura y todos los roles leen. Aparece con la primera escritura (E1.3 o E3).
- RLS queda fuera ([11](../../../../../docs-diagrams/11-backend-nest-organizaciones-y-transicion.md)).
