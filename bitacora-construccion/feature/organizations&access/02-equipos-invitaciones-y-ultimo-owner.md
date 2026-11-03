# 02 — Equipos, invitaciones y último owner (E1.3 de la ampliación)

Fecha de creación: 2026-11-03  
Última actualización: 2026-11-03 (batería completa repetida y en verde)  
Estado: Implementado y verificado en local. Migración sin aplicar en Neon (ver «Migraciones en Neon»).  
Ámbito: [plan 02](../../../docs/plans/feature/organizations&access/02-plan-e1.3-equipos-e-invitaciones.md), incremento E1.3 del [plan 01](../../../docs/plans/feature/organizations&access/01-plan-organizaciones-y-acceso.md).  
Relacionada con: [bitácora 01](01-organizacion-personal-y-contexto-de-acceso.md), [fuentes 02](../../../docs/fonts/feature/organizations&access/02-fuentes-de-equipos-e-invitaciones.md), [fuentes 01](../../../docs/fonts/feature/organizations&access/01-fuentes-de-acceso-y-organizaciones.md), [acta E0](../../../../docs-diagrams/21-acta-e0-adelantar-la-ampliacion.md).  
Revisión de partida: `f6b4bf9` con E1.1 sin commit y trabajo de feeds de otra sesión.

## Necesidad y punto de partida

El usuario pidió continuar con E1.3 y aplicar las migraciones. Orden seguido, como pidió: fuentes ([ficha 02](../../../docs/fonts/feature/organizations&access/02-fuentes-de-equipos-e-invitaciones.md)) → [plan 02](../../../docs/plans/feature/organizations&access/02-plan-e1.3-equipos-e-invitaciones.md) → código.

E1.1 había dejado organizaciones personales, membresías con rol y lecturas. Faltaba que varias personas compartieran una empresa.

## Migraciones en Neon

`pnpm db:status` (solo lectura) mostró 4 migraciones pendientes: `create_feeds`, `add_feed_source` y `create_feed_refreshes` (de la sesión de feeds) y `create_organizations`. Prisma las aplica en orden, así que la de organizaciones no puede ir sola. La sesión de feeds estaba editando sus migraciones en ese momento (22:13 y 22:16). El usuario eligió **esperar a que feeds termine**. A la mañana siguiente el plan de feed-refresh sigue «En curso; E4 no terminada», y `create_feed_refreshes` pertenece a esa etapa: no se aplicó nada. Con E1.3 quedan pendientes 5 en el repositorio, y 6 desde que la sesión de feeds añadió `20261103000300_add_feed_policy`.

## Evidencia y decisiones

| Decisión | Evidencia | Aplicación |
| --- | --- | --- |
| T1 organización de equipo | F34 | `OrganizationsRepository.createTeam`: organización y membresía `owner` en una transacción. |
| T2–T3 invitaciones con hash, una pendiente por correo, reinvitar revoca la anterior | F35, F25 | [migración](../../../prisma/migrations/20261103000200_create_organization_invitations/migration.sql) con índice único parcial; `OrganizationInvitationsRepository.create`. |
| Token de un solo uso con caducidad | C8, C9, F35 | [invitations.ts](../../../src/organizations/invitations.ts): 32 bytes, SHA-256, 7 días. El `UPDATE` que consume la invitación exige pendiente y no caducada. |
| T4 quién gestiona qué rol | Tabla de [11](../../../../docs-diagrams/11-backend-nest-organizaciones-y-transicion.md) | `can` y `canManageRole` en [organization-roles.ts](../../../src/organizations/organization-roles.ts). |
| T5 último owner con filas bloqueadas | F36 | `lockAndCheckChange` en [organizations.repository.ts](../../../src/organizations/organizations.repository.ts): `FOR UPDATE OF m` en orden de usuario sobre owners, actor y destino; decide la función pura `membershipChangeError` ([membership-rules.ts](../../../src/organizations/membership-rules.ts)). |
| T6 dueño de la organización personal | Coherencia con O5 | `isPersonalOwner` en la misma consulta bloqueada → `409 ORGANIZATION_PERSONAL_OWNER`. |
| T7 aceptar con el correo de la sesión | C10, F37 | `OrganizationInvitationsService.accept` toma `identity.email`, nunca el cuerpo. Sin correo o distinto: `403`. |
| C5 (`403`/`404`) | C5 | Ajeno: `ORGANIZATION_NOT_FOUND`. Miembro sin permiso: `FORBIDDEN`. |

### Ajustes al escribir el código

- **Reglas en una función pura.** El repositorio bloquea y lee; `membershipChangeError` decide y devuelve el código. Así las reglas se prueban sin base de datos y la función no recibe Prisma ([11](../../../../docs-diagrams/11-backend-nest-organizaciones-y-transicion.md)).
- **El permiso se comprueba dentro de la transacción**, sobre la fila bloqueada del actor, no antes en el servicio. Si alguien degrada al actor justo antes, la operación ya lo ve.
- **Repositorio, servicio y controlador propios para invitaciones**: tienen otro actor (la persona invitada) y su propio ciclo de vida.
- **Token replicado, no importado de feeds**: organizaciones no puede depender de feeds (C7). Candidato a `common` cuando feeds cierre.

## Implementación y funcionamiento

| Ruta | Permiso | Respuesta |
| --- | --- | --- |
| `POST /api/v1/organizations` | sesión | `201 { organization, access }` |
| `GET /api/v1/organizations/:id/members` | miembro | `{ members, page }` |
| `PATCH /api/v1/organizations/:id/members/:userId` | `members.manage` (+ `organization.own` con owners) | `{ member }` |
| `DELETE /api/v1/organizations/:id/members/:userId` | `members.manage`, o uno mismo | `204` |
| `POST /api/v1/organizations/:id/invitations` | `members.manage` (+ `organization.own` para owner) | `201 { invitation, token }` |
| `GET /api/v1/organizations/:id/invitations` | `members.manage` | `{ invitations, page }` |
| `DELETE /api/v1/organizations/:id/invitations/:invitationId` | `members.manage` | `204` |
| `POST /api/v1/invitations/accept` | sesión | `201 { organization, access }` |

Códigos nuevos (es/en): `ORGANIZATION_LAST_OWNER` y `ORGANIZATION_PERSONAL_OWNER` (409), `MEMBER_NOT_FOUND` (404), `MEMBER_ALREADY_EXISTS` (409), `INVITATION_NOT_FOUND` (404), `INVITATION_EMAIL_MISMATCH` (403).

## Comprobación

Ejecutada en copias aisladas del backend, porque otra sesión puede lanzar pruebas en el mismo árbol. La copia probada no incluye `20261103000300_add_feed_policy`, que la sesión de feeds añadió después.

| Comprobación | Resultado |
| --- | --- |
| `pnpm build`, `pnpm lint`, `pnpm format:check` | Correctos. |
| Suites de organizaciones | 63 pruebas en verde (E1.1 y E1.3). |
| `pnpm db:verify` y `pnpm users:verify` | 3/3 y 8/8 (incluye la lista de migraciones con las 15). |
| `pnpm test:features` completo, primer intento | Sin resultado: el proceso terminó con señal (código 143) antes del resumen, mientras la sesión de feeds ejecutaba sus pruebas a la vez. |
| `pnpm test:features` completo, repetido sin otras pruebas en marcha (copia del 2026-11-03 15:15) | 50 suites y 899 pruebas en verde. |
| `prisma migrate diff` (migraciones frente a `schema.prisma`, PGlite como base sombra) | Migración vacía: coinciden. |
| Defecto forzado M3: sin protección del último owner | 4 pruebas fallan. |
| Defecto forzado M4: sin comprobar el correo al aceptar | 2 pruebas fallan. |
| Defecto forzado M5: sin caducidad | 9 pruebas fallan. Restaurado: 63/63. |

Pruebas existentes que cambiaron: la lista de migraciones de `test/prisma-migrations.test.mjs` y el recuento de `projects.repository.int-spec.ts` (de 14 a 15), el mismo ajuste que hace cada migración nueva.

No verificado: concurrencia real del último owner y de dos aceptaciones del mismo token (PGlite no demuestra bloqueos; el diseño se apoya en F36), la migración en Neon y el envío de correos.

## Consecuencias y continuidad

- Una empresa puede tener varias personas con roles; nunca se queda sin owner.
- Pendiente: verificación fuerte del correo con `verifiedEmail` (API de gestión de Descope), envío del correo de invitación, concurrencia en PostgreSQL real.
- Siguiente: E1.4 (archivar organizaciones, cuotas mínimas, GraphQL) y E1.2 cuando feeds cierre. Aplicar las migraciones pendientes en Neon cuando la sesión de feeds termine E4.
