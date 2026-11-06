# 01 — Organización personal y contexto de acceso (E1.1 de la ampliación)

Fecha de creación: 2026-11-02  
Estado: Implementado y verificado en local. Migración creada y ensayada con PGlite; **sin aplicar en Neon** (la aplica el usuario con `pnpm db:status` y `pnpm db:migrate`, después de guardar una copia).  
Ámbito: incremento E1.1 del [plan 01](../../../docs/plans/feature/organizations&access/01-plan-organizaciones-y-acceso.md).  
Relacionada con: [acta E0](../../../../docs-diagrams/21-acta-e0-adelantar-la-ampliacion.md), [fuentes](../../../docs/fonts/feature/organizations&access/01-fuentes-de-acceso-y-organizaciones.md), [transición del backend](../../../../docs-diagrams/11-backend-nest-organizaciones-y-transicion.md).  
Revisión de partida: `f6b4bf9` con cambios locales de feeds de otra sesión. Línea base: build y lint correctos; 40 suites y 793 pruebas en verde.

## Necesidad y punto de partida

El usuario pidió ejecutar la ampliación (documentos 10–19) y explicó que, aunque va numerada al final, es la base sobre la que empieza el proyecto. La decisión y sus límites están en el [acta E0](../../../../docs-diagrams/21-acta-e0-adelantar-la-ampliacion.md). El orden de trabajo fue: fuentes ([ficha 01](../../../docs/fonts/feature/organizations&access/01-fuentes-de-acceso-y-organizaciones.md)) → [plan 01](../../../docs/plans/feature/organizations&access/01-plan-organizaciones-y-acceso.md) → código.

No había organizaciones. El acceso era `owner_id` en unas 60 consultas de seis módulos, y otra sesión editaba feeds en el mismo árbol. Por eso E1.1 es aditivo: no toca el SQL de importaciones, reglas, evaluaciones, exportaciones ni feeds.

## Evidencia y decisiones

| Decisión del plan | Evidencia | Aplicación |
| --- | --- | --- |
| O1–O3: tablas nuevas, organización personal única por usuario, `projects.organization_id` nulo admitido | [11](../../../../docs-diagrams/11-backend-nest-organizaciones-y-transicion.md), F32 | [migración](../../../prisma/migrations/20261103000100_create_organizations/migration.sql); modelos `Organization`, `OrganizationMember` y `Project.organizationId` en [schema.prisma](../../../prisma/schema.prisma). |
| O4: backfill repetible en la migración | F31, F32 | Tres sentencias con `gen_random_uuid()`, `ON CONFLICT DO NOTHING` y `WHERE organization_id IS NULL`. |
| O5: doble escritura al crear proyecto | F33, F34 | `ensurePersonalOrganization` en [organizations.repository.ts](../../../src/organizations/organizations.repository.ts); `ProjectsRepository.create` la llama dentro de `$transaction` antes del `INSERT`. |
| O6: rol leído de la base en cada petición, permisos derivados | C3 descartado | `permissionsFor` en [organization-roles.ts](../../../src/organizations/organization-roles.ts); ningún claim del JWT interviene. |
| O7: ajeno → 404 | C5 | `ORGANIZATION_NOT_FOUND` (404, es/en); un proyecto ajeno responde `PROJECT_NOT_FOUND`. |
| O8: membresía en el `WHERE` | C6 | `EXISTS` sobre `organization_members` en `findAllInOrganization`; `JOIN` con el usuario en `findMemberAccess` y en las consultas de organizaciones. |
| O9: dependencias en una dirección | C7 | `OrganizationsModule` solo importa usuarios; `ProjectsModule` importa organizaciones. |
| O10: rutas antiguas sin cambios | Contratos vigentes | `Project` no gana campos. Lo nuevo va en rutas nuevas. |

### Ajustes al escribir el código

- **Servicio aparte en proyectos.** `projects.service.spec` crea `ProjectsService` con inyección de Nest; añadirle una dependencia rompía esa prueba. Las lecturas por membresía están en `ProjectMembershipService` y `ProjectMembershipController`. Se unirán con `ProjectsService` en E1.2, cuando las rutas antiguas pasen a membresía.
- **`ensurePersonalOrganization` es una función, no un método.** Así `new ProjectsRepository(prisma)`, que usan cinco pruebas, no cambia de firma.
- **Sin columnas `status` ni `version`.** Las pide la revocación de E1.3; añadirlas ahora sería una tabla anticipada.

## Implementación y funcionamiento

Rutas nuevas, todas con `DescopeSessionGuard`:

| Ruta | Respuesta |
| --- | --- |
| `GET /api/v1/organizations` | `{ organizations: [{ id, name, kind, role, createdAt }], page }` |
| `GET /api/v1/organizations/:organizationId` | `{ organization: { id, name, kind, createdAt }, access: { role, permissions } }` |
| `GET /api/v1/organizations/:organizationId/projects` | `{ projects, page }`, con la misma forma de `Project` que las rutas existentes |
| `GET /api/v1/projects/:id/access` | `{ access: { actorId, organizationId, projectId, role, permissions } }`: el contexto que usarán hojas, revisiones e IA |

Archivos:

- [src/organizations/](../../../src/organizations/): roles y permisos, tipos, repositorio, servicio, controlador y módulo.
- [project-membership.service.ts](../../../src/projects/project-membership.service.ts) y [project-membership.controller.ts](../../../src/projects/project-membership.controller.ts).
- [projects.repository.ts](../../../src/projects/projects.repository.ts): `create` en transacción con organización; `findAllInOrganization` y `findMemberAccess`.
- [projects.types.ts](../../../src/projects/projects.types.ts): `ProjectAccess`. [Nota SQL](../../../src/projects/sql/projects.md) actualizada.
- Compartidos, solo añadiendo al final: `error-codes.ts`, `messages.ts`, `app.module.ts`, `schema.prisma`.

## Comprobación

Las pruebas se ejecutaron en una copia aislada del backend (con el mismo `node_modules`), porque otra sesión lanzó pruebas a la vez y borró `.test-build` a mitad de una ejecución en el árbol original.

| Comprobación | Resultado |
| --- | --- |
| `pnpm build`, `pnpm lint`, `pnpm format:check` | Correctos. |
| `pnpm test:features` | 44 suites y 817 pruebas en verde (793 previas + 24 nuevas). |
| `pnpm db:verify` y `pnpm users:verify` | 3/3 y 8/8. |
| `prisma migrate diff --from-migrations … --to-schema …` con PGlite como base sombra | Migración vacía: las migraciones y el esquema coinciden. |
| Ensayo T01 ([organizations-migration.int-spec.ts](../../../test/features/organizations/organizations-migration.int-spec.ts)) | Se aplican las 12 migraciones anteriores, se insertan 3 usuarios y 3 proyectos heredados y después la nueva. IDs y propietarios iguales; 2 organizaciones personales con su `owner`; ningún proyecto sin asignar; repetir el backfill dos veces no duplica y completa un proyecto creado después por un binario antiguo. |
| Defecto forzado M1: quitar el `EXISTS` de membresía | 1 prueba falla (lectura directa del repositorio con organización ajena). |
| Defecto forzado M2: no crear la organización al crear proyecto | 6 pruebas fallan. Restaurado: 23/23. |

Pruebas que cambiaron: la lista de migraciones de `test/prisma-migrations.test.mjs` y el recuento de `projects.repository.int-spec.ts` (de 12 a 13). Son el mismo ajuste que hizo la sesión de feeds al añadir sus migraciones; ninguna otra aserción cambió.

No verificado: concurrencia real de dos primeras creaciones simultáneas (PGlite no demuestra bloqueos; el razonamiento se apoya en F33 y queda para PostgreSQL real), la migración en Neon y el arranque de la aplicación contra Neon.

## Consecuencias y continuidad

- Cada proyecto nuevo nace en la organización personal de quien lo crea. Las rutas antiguas se comportan igual.
- `403` todavía no se usa: todas las rutas son de lectura y todos los roles leen.
- Un proyecto con `organization_id` nulo (creado por un binario antiguo después de migrar) no aparece en las rutas nuevas hasta repetir el backfill.
- Siguiente: E1.2, pasar importaciones, reglas, evaluaciones, exportaciones y feeds a membresía cuando feeds estabilice su contrato y la migración esté aplicada en Neon. Después E1.3 (equipos, invitaciones, revocación, último `owner`).
