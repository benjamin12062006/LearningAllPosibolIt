# 03 — Archivar organizaciones y cuotas mínimas (E1.4 de la ampliación)

Fecha de creación: 2026-11-03  
Estado: Implementado y verificado en local. Migración sin aplicar en Neon.  
Ámbito: [plan 03](../../../docs/plans/feature/organizations&access/03-plan-e1.4-archivado-y-cuotas.md), incremento E1.4 del [plan 01](../../../docs/plans/feature/organizations&access/01-plan-organizaciones-y-acceso.md).  
Relacionada con: [bitácora 02](02-equipos-invitaciones-y-ultimo-owner.md), [fuentes 03](../../../docs/fonts/feature/organizations&access/03-fuentes-de-archivado-y-cuotas.md).  
Revisión de partida: `37a5d44` en `feature/organizations-access` (E1.1 y E1.3).

## Necesidad y punto de partida

El usuario pidió confirmar el trabajo anterior y seguir con la siguiente etapa en el orden indicado.

- **Commit.** `37a5d44` en la rama nueva `feature/organizations-access`, creado con un índice temporal. Así no se tocaron la rama `feature/reviews-exports`, el índice ni el árbol de trabajo, donde la sesión de feeds tiene cambios sin confirmar. Solo entran los archivos de organizaciones y, de los compartidos (`schema.prisma`, códigos y mensajes de error, `app.module.ts`, lista y recuento de migraciones), únicamente sus trozos. Verificado por separado sobre una copia de esa rama: 39 suites y 655 pruebas, build, lint, formato, `db:verify`, `users:verify` y esquema igual a las migraciones.
- **Siguiente etapa.** E1.2 sigue bloqueada (la sesión de feeds edita esos módulos y sus migraciones no están en Neon). La [secuencia de la ampliación](../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md) pone en E1 «archivado; cuotas mínimas»: eso es E1.4. GraphQL pasa al plan aplazado por la decisión anterior del usuario (R6 de la ficha 03).

Orden seguido: [fuentes 03](../../../docs/fonts/feature/organizations&access/03-fuentes-de-archivado-y-cuotas.md) → [plan 03](../../../docs/plans/feature/organizations&access/03-plan-e1.4-archivado-y-cuotas.md) → código.

## Evidencia y decisiones

| Decisión | Evidencia | Aplicación |
| --- | --- | --- |
| A1 `archived_at`, sin borrar nada | R2, R3 | [migración](../../../prisma/migrations/20261103090000_add_organization_archived_at/migration.sql), con `CHECK` de que una personal nunca está archivada; `Organization.archivedAt`. |
| A2–A3 archivar y restaurar solo el owner; la personal no | R4 | `OrganizationsRepository.setArchived`; rutas `POST …/archive` y `POST …/restore`. |
| A4–A5 archivada se lee pero no cambia; toda escritura bloquea antes la organización | R2, F39 | [organization-lock.ts](../../../src/organizations/organization-lock.ts): `lockOrganization` y `assertNotArchived`, usados en cambiar rol, quitar, invitar, revocar y aceptar. |
| Q1 límites con nombre | R5 | [organization-limits.ts](../../../src/organizations/organization-limits.ts): `ORGANIZATION_LIMITS`, `canOwnAnotherTeam` y `hasFreeSeat`. |
| Q2 10 equipos por owner, archivados incluidos | F38, F39 | `lockUserAndCountOwnedTeams`: bloquea la fila del usuario y cuenta. |
| Q3 50 plazas; la invitación reserva la suya | F38, C11, C12 | `assertSeatForInvitation` (sin contar la del mismo correo) y `assertSeatForMember` al aceptar. |

### Ajustes al escribir el código

- **Orden de bloqueo al aceptar.** Primero se lee, sin bloquear, a qué organización pertenece el token; después se bloquea la organización y solo entonces la invitación. Invitar bloquea en el mismo orden (organización y luego invitaciones), así que dos transacciones no pueden quedarse esperando la una a la otra.
- **`lockWritableOrganization`**: paso con nombre que bloquea organización y actor y comprueba, por este orden, «no eres miembro» (404) y «archivada» (409). A quien no es miembro no se le dice si está archivada.
- **Las respuestas de organizaciones ganan `archivedAt`.** Se ajustaron las tres aserciones de forma exacta de las pruebas de E1.1 y E1.3; son rutas propias sin publicar todavía.

## Implementación y funcionamiento

| Ruta | Permiso | Respuesta |
| --- | --- | --- |
| `POST /api/v1/organizations/:id/archive` | `organization.own` | `200 { organization, access }` |
| `POST /api/v1/organizations/:id/restore` | `organization.own` | `200 { organization, access }` |

Códigos nuevos (es/en): `ORGANIZATION_ARCHIVED`, `ORGANIZATION_PERSONAL_NOT_ARCHIVABLE`, `TEAM_ORGANIZATIONS_LIMIT` y `ORGANIZATION_SEATS_LIMIT` (409). Los mensajes citan las cifras de `ORGANIZATION_LIMITS`, y una prueba comprueba que coinciden.

## Comprobación

En una copia aislada del backend.

| Comprobación | Resultado |
| --- | --- |
| `pnpm build`, `pnpm lint`, `pnpm format:check` | Correctos. |
| `pnpm test:features` completo | 54 suites y 966 pruebas en verde (incluye el trabajo de feeds presente en la copia). |
| `pnpm db:verify` y `pnpm users:verify` | Correctos. |
| `prisma migrate diff` frente a `schema.prisma` | Migración vacía: coinciden. |
| Suites de organizaciones | 75 pruebas en verde. |
| Defecto forzado M6: archivada se puede cambiar | 2 pruebas fallan. |
| Defecto forzado M7: invitar sin comprobar plazas | 1 prueba falla. |
| Defecto forzado M8: reinvitar ocupa otra plaza | 1 prueba falla. Restaurado: 75/75. |

Pruebas existentes que cambiaron: la lista de migraciones y el recuento de `projects.repository.int-spec.ts` (de 17 a 18; la sesión de feeds ya había sumado las suyas), además de las tres aserciones de forma descritas arriba.

No verificado: concurrencia real de cuotas y archivado (PGlite no demuestra bloqueos) y la migración en Neon.

## Consecuencias y continuidad

- Una empresa puede archivarse sin perder nada y restaurarse. Ninguna persona ni organización supera los topes del piloto.
- Las rutas de proyectos todavía no miran el archivado; lo harán con E1.2.
- Con E1.4, E1 queda completa salvo E1.2. Siguiente en la secuencia: E1.2 cuando feeds cierre, o E3.1 (hoja vacía), que según [18](../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md) depende solo de E1.
