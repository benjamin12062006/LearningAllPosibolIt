import { describe, expect, it } from '@jest/globals';
import { API_MESSAGES } from '../../../src/common/http/messages.js';
import {
  canOwnAnotherTeam,
  hasFreeSeat,
  ORGANIZATION_LIMITS,
} from '../../../src/organizations/organization-limits.js';

describe('Límites del piloto para organizaciones', () => {
  it('permite hasta el límite y no uno más', () => {
    const { teamOrganizationsPerOwner, seatsPerOrganization } =
      ORGANIZATION_LIMITS;

    expect(canOwnAnotherTeam(teamOrganizationsPerOwner - 1)).toBe(true);
    expect(canOwnAnotherTeam(teamOrganizationsPerOwner)).toBe(false);
    expect(hasFreeSeat(seatsPerOrganization - 1)).toBe(true);
    expect(hasFreeSeat(seatsPerOrganization)).toBe(false);
  });

  it('los mensajes de error citan las mismas cifras que la constante', () => {
    const teams = String(ORGANIZATION_LIMITS.teamOrganizationsPerOwner);
    const seats = String(ORGANIZATION_LIMITS.seatsPerOrganization);

    for (const language of ['es', 'en'] as const) {
      expect(API_MESSAGES.TEAM_ORGANIZATIONS_LIMIT.message[language]).toContain(
        teams,
      );
      expect(API_MESSAGES.ORGANIZATION_SEATS_LIMIT.message[language]).toContain(
        seats,
      );
    }
  });
});
