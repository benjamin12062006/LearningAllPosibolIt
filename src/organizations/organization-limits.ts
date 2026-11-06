/**
 * Límites del piloto (plan organizations&access 03, Q1). Son propuesta propia
 * para que una empresa no agote recursos compartidos (F38, C11); las cifras
 * definitivas se fijan antes del piloto (P07). Los mensajes de error
 * `TEAM_ORGANIZATIONS_LIMIT` y `ORGANIZATION_SEATS_LIMIT` citan estos números.
 */
export const ORGANIZATION_LIMITS = {
  /** Organizaciones de equipo donde una persona es owner, archivadas incluidas. */
  teamOrganizationsPerOwner: 10,
  /** Miembros más invitaciones pendientes de una organización. */
  seatsPerOrganization: 50,
} as const;

/**
 * Las archivadas cuentan: así restaurar una nunca deja a nadie por encima del
 * límite.
 */
export function canOwnAnotherTeam(ownedTeams: number) {
  return ownedTeams < ORGANIZATION_LIMITS.teamOrganizationsPerOwner;
}

/** Una invitación pendiente ocupa plaza: la reserva al invitar, no al aceptar. */
export function hasFreeSeat(occupiedSeats: number) {
  return occupiedSeats < ORGANIZATION_LIMITS.seatsPerOrganization;
}
