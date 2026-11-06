# 02 — E1.3: equipos, invitaciones, roles y último owner

Fecha de creación: 2026-11-02  
Última actualización: 2026-11-03 (implementado)  
Estado: Implementado y verificado en local ([bitácora 02](../../../../bitacora-construccion/feature/organizations&access/02-equipos-invitaciones-y-ultimo-owner.md)); migración aplicada en Neon el 2026-11-03 (confirmado con `pnpm db:status` el 2026-11-05).  
Ámbito: incremento E1.3 del [plan 01](01-plan-organizaciones-y-acceso.md). Solo backend y REST.  
Relacionada con: [plan 01](01-plan-organizaciones-y-acceso.md) (O1–O10), [fuentes 02](../../../fonts/feature/organizations&access/02-fuentes-de-equipos-e-invitaciones.md), [fuentes 01](../../../fonts/feature/organizations&access/01-fuentes-de-acceso-y-organizaciones.md), [bitácora 01](../../../../bitacora-construccion/feature/organizations&access/01-organizacion-personal-y-contexto-de-acceso.md).  
Revisión de referencia: `f6b4bf9` con E1.1 sin commit y trabajo de feeds de otra sesión.

## Objetivo

Varias personas trabajan en la misma empresa. E1.3 está completa cuando:

1. Cualquiera crea una organización de equipo y queda como `owner`.
2. Quien gestiona miembros invita por correo con un rol. El token se muestra una vez, caduca a los 7 días y solo sirve una vez (C8, C9, F35).
3. La persona invitada acepta con su sesión. Su correo sale de la sesión, no del cuerpo (C10).
4. Se cambia el rol o se quita a un miembro; cada persona puede salir por sí misma.
5. Nunca queda una organización sin `owner`, ni siquiera con dos cambios simultáneos (T03, F36).
6. Sin permiso: `403`. Ajeno: `404` (C5).

## Punto de partida

- E1.1: organización personal, membresías con rol, `permissionsFor`, `requireMembership` y cuatro rutas de lectura.
- No hay envío de correo en el backend ni proveedor elegido.
- El JWT de Descope no garantiza un claim de correo verificado (F37).

## Decisiones

| ID | Decisión | Respaldo |
| --- | --- | --- |
| T1 | `POST /organizations` crea una organización de equipo (`personal_owner_id` nulo) y la membresía `owner` en una transacción. | F34; O1 |
| T2 | Tabla `organization_invitations`: correo normalizado, rol, `token_hash` único, quién invita, caducidad y estados `accepted_at`/`revoked_at`. Índice único parcial: una sola invitación pendiente por organización y correo. | F35; [11](../../../../../docs-diagrams/11-backend-nest-organizaciones-y-transicion.md) |
| T3 | Volver a invitar el mismo correo revoca la pendiente y crea otra con token nuevo, en la misma transacción. Reenviar no da error. | Propuesta propia |
| T4 | Gestionar miembros e invitaciones requiere `members.manage`. Dar, quitar o cambiar el rol `owner` requiere además `organization.own`. Salir de una organización no requiere permiso. | Tabla de [11](../../../../../docs-diagrams/11-backend-nest-organizaciones-y-transicion.md); `permissionsFor` |
| T5 | Último owner: en la transacción se bloquean con `FOR UPDATE`, ordenadas por usuario, las filas de los owners, del actor y del destino. El permiso del actor se vuelve a comprobar sobre su fila bloqueada. Si el cambio dejara cero owners: `409 ORGANIZATION_LAST_OWNER`. | F36; [11](../../../../../docs-diagrams/11-backend-nest-organizaciones-y-transicion.md) |
| T6 | La persona dueña de una organización personal no puede salir ni perder el rol `owner` de ella: `409 ORGANIZATION_PERSONAL_OWNER`. Si no, crear un proyecto la volvería a añadir como `owner` (`ensurePersonalOrganization`). | Coherencia con O5 |
| T7 | Aceptar: el `UPDATE` que consume la invitación exige que no esté aceptada ni revocada y que no haya caducado. Token desconocido, caducado, usado o revocado: `404 INVITATION_NOT_FOUND`, sin distinguir. Correo de la sesión ausente o distinto: `403 INVITATION_EMAIL_MISMATCH`. Ya miembro: `409 MEMBER_ALREADY_EXISTS` y la invitación no se consume. | C9, C10, F35, F37 |
| T8 | Listar miembros: cualquier miembro (`organization.read`), con nombre visible, correo y rol. Listar invitaciones pendientes: `members.manage`. | C6 |
| T9 | Envío del correo fuera de alcance: la API devuelve el token una sola vez y la web construirá el enlace. | Igual que el token de feeds |
| T10 | Tiempos en texto ISO-8601 UTC, como el resto del esquema; comparar `expires_at` con el instante de la petición en texto es correcto porque todos tienen el mismo formato. | Esquema vigente |

## Rutas

| Ruta | Permiso | Respuesta |
| --- | --- | --- |
| `POST /api/v1/organizations` `{ name }` | sesión | `201 { organization, access }` |
| `GET /api/v1/organizations/:id/members` | `organization.read` | `{ members, page }` |
| `PATCH /api/v1/organizations/:id/members/:userId` `{ role }` | `members.manage` (+ `organization.own` si interviene `owner`) | `{ member }` |
| `DELETE /api/v1/organizations/:id/members/:userId` | `members.manage`, o ser uno mismo | `204` |
| `POST /api/v1/organizations/:id/invitations` `{ email, role }` | `members.manage` (+ `organization.own` para invitar `owner`) | `201 { invitation, token }` |
| `GET /api/v1/organizations/:id/invitations` | `members.manage` | `{ invitations, page }` |
| `DELETE /api/v1/organizations/:id/invitations/:invitationId` | `members.manage` | `204` |
| `POST /api/v1/invitations/accept` `{ token }` | sesión | `201 { organization, access }` |

## Incrementos

1. Migración `organization_invitations` y ensayo con PGlite.
2. Crear organización y listar miembros.
3. Cambiar rol y quitar miembro con bloqueo del último owner.
4. Invitar, listar, revocar y aceptar.
5. Pruebas e2e de permisos (`403`/`404`) y regresión completa.

## Comprobación prevista

- Unitarias: reglas de rol asignable (T4) y normalización de correo.
- Integración: último owner (incluido el caso de dos owners que se degradan, en secuencia; PGlite no demuestra el bloqueo concurrente), invitación pendiente única, consumo de un solo uso, caducidad.
- E2E: flujo completo con dos usuarios, `403` para viewer y editor, `404` ajeno.
- Regresión: build, lint, formato y todas las suites.

## Límites y continuidad

- Pasa a E1.4: archivar organizaciones, cuotas mínimas y GraphQL de organizaciones.
- Verificación fuerte del correo (`verifiedEmail` por la API de gestión de Descope) y envío del correo de invitación: pendientes.
- Concurrencia real del último owner: probar en PostgreSQL real con varias conexiones (T03).
