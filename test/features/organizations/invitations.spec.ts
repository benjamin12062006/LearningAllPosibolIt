import { describe, expect, it } from '@jest/globals';
import {
  createInvitationToken,
  expiresAtFrom,
  hashInvitationToken,
  INVITATION_TOKEN_PATTERN,
  normalizeEmail,
} from '../../../src/organizations/invitations.js';

describe('Token, correo y caducidad de una invitación', () => {
  it('genera tokens distintos de 43 caracteres y guarda solo su SHA-256', () => {
    const first = createInvitationToken();
    const second = createInvitationToken();

    expect(first.token).toMatch(INVITATION_TOKEN_PATTERN);
    expect(first.token).not.toBe(second.token);
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.hash).toBe(hashInvitationToken(first.token));
    expect(first.hash).not.toContain(first.token);
  });

  it('normaliza el correo para que mayúsculas y espacios no creen otra invitación', () => {
    expect(normalizeEmail('  Ana@Example.TEST ')).toBe('ana@example.test');
  });

  it('caduca exactamente 7 días después', () => {
    expect(expiresAtFrom(new Date('2026-11-02T12:00:00.000Z'))).toBe(
      '2026-11-09T12:00:00.000Z',
    );
  });
});
