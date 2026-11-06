# 03 — E1.4: archivar organizaciones y cuotas mínimas

Fecha de creación: 2026-11-03  
Última actualización: 2026-11-03 (implementado)  
Estado: Implementado y verificado en local ([bitácora 03](../../../../bitacora-construccion/feature/organizations&access/03-archivar-organizaciones-y-cuotas.md)); migración sin aplicar en Neon.  
Ámbito: incremento E1.4 del [plan 01](01-plan-organizaciones-y-acceso.md). Solo backend y REST.  
Relacionada con: [fuentes 03](../../../fonts/feature/organizations&access/03-fuentes-de-archivado-y-cuotas.md), [plan 02](02-plan-e1.3-equipos-e-invitaciones.md), [bitácora 02](../../../../bitacora-construccion/feature/organizations&access/02-equipos-invitaciones-y-ultimo-owner.md).  
Revisión de referencia: `37a5d44` en `feature/organizations-access` (E1.1 y E1.3).

## Por qué E1.4 y no E1.2

El orden del plan 01 es E1.1 → E1.2 → E1.3 → E1.4. E1.2 (pasar importaciones, reglas, evaluaciones, exportaciones y feeds a membresía) sigue bloqueada: la sesión de feeds edita esos módulos en este momento y sus migraciones no están en Neon. E1.4 no los toca. GraphQL de organizaciones sale de E1.4 y pasa al [plan GraphQL aplazado](../graphql&rulesets-evaluations-exports/01-plan-aplazado-sincronizacion-graphql.md), por decisión anterior del usuario (R6).

## Objetivo

1. Un owner archiva una organización de equipo y la puede restaurar. Archivada se lee igual, pero no admite cambios de miembros ni invitaciones (R2, R3). No se borra nada.
2. Una organización personal no se archiva: ahí nacen los proyectos nuevos.
3. Cada persona puede ser owner de como mucho 10 organizaciones de equipo, y cada organización tiene como mucho 50 plazas entre miembros e invitaciones pendientes (F38, C11).
4. Ninguna carrera supera una cuota ni cuela un cambio en una organización recién archivada (F39).

## Decisiones

| ID | Decisión | Respaldo |
| --- | --- | --- |
| A1 | Columna `organizations.archived_at` (nula = activa). `Organization` gana `archivedAt` en las respuestas. | R2, R3 |
| A2 | `POST /organizations/:id/archive` y `POST /organizations/:id/restore`, con permiso `organization.own`. Repetirlas no cambia nada y responde `200`. | R4 |
| A3 | Personal → `409 ORGANIZATION_PERSONAL_NOT_ARCHIVABLE`. | Coherencia con O5 |
| A4 | Organización archivada: invitar, revocar, aceptar, cambiar rol y quitar miembros → `409 ORGANIZATION_ARCHIVED`. Las lecturas siguen. | R2 |
| A5 | Toda escritura de membresías empieza bloqueando con `FOR UPDATE` la fila de la organización; ahí se lee `archived_at` y se cuentan plazas. Una sola regla para archivado y cuotas. | F39, C12 |
| Q1 | Límites en una constante con nombre (`ORGANIZATION_LIMITS`), con comentario de que son del piloto. | R5 |
| Q2 | Equipos por persona: al crear, se bloquea la fila del usuario y se cuentan las organizaciones de equipo donde es owner, archivadas incluidas (así restaurar nunca supera el tope). Lleno → `409 TEAM_ORGANIZATIONS_LIMIT`. | F38, F39 |
| Q3 | Plazas: invitar exige miembros + invitaciones pendientes no caducadas < 50, de modo que la invitación reserva su plaza. Aceptar vuelve a comprobar que los miembros sean < 50. Lleno → `409 ORGANIZATION_SEATS_LIMIT`. | F38; reserva antes de consumir ([15](../../../../../docs-diagrams/15-chat-ia-herramientas-y-propuestas.md)) |

## Incrementos

1. Migración `archived_at` y ensayo con PGlite.
2. Reglas puras: `ORGANIZATION_LIMITS` y comprobaciones con nombre.
3. Archivar y restaurar; bloqueo de la organización en las escrituras existentes.
4. Cuotas al crear equipo, invitar y aceptar.
5. Pruebas unitarias, de integración y e2e; regresión completa.

## Comprobación prevista

- Integración: archivar bloquea las cinco escrituras y no las lecturas; restaurar las devuelve; personal no se archiva; tope de equipos con archivados; plazas reservadas por invitaciones; reinvitar el mismo correo no consume otra plaza.
- E2E: archivar y restaurar con owner, `403` con admin, `409` en personal.
- Regresión: suites completas, build, lint y formato.

## Límites y continuidad

- Las rutas de proyectos todavía no miran el archivado: siguen por propietario hasta E1.2, y los proyectos nuevos nacen en la organización personal, que no se archiva.
- Concurrencia real de las cuotas: PGlite no demuestra bloqueos; probar en PostgreSQL real.
- Las cifras se revisan antes del piloto (P07).
