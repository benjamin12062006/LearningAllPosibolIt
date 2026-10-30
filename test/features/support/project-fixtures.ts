import type { AuthenticatedIdentity } from '../../../src/auth/authenticated-request.js';
import type { Project } from '../../../src/projects/projects.types.js';
import type { LocalUser } from '../../../src/users/users.repository.js';

export const alice: AuthenticatedIdentity = {
  issuer: 'https://identity.example.test',
  subject: 'alice',
  email: 'alice@example.test',
};
export const bob: AuthenticatedIdentity = {
  ...alice,
  subject: 'bob',
  email: 'bob@example.test',
};
export const projectInput = {
  name: 'Tienda A',
  country: 'US',
  currency: 'USD',
  channelProfile: 'google_merchant' as const,
};

export function userFixture(overrides: Partial<LocalUser> = {}): LocalUser {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    email: alice.email ?? null,
    displayName: null,
    createdAt: '2026-10-25T12:00:00.000Z',
    updatedAt: '2026-10-25T12:00:00.000Z',
    ...overrides,
  };
}

export function projectFixture(overrides: Partial<Project> = {}): Project {
  return {
    id: '00000000-0000-4000-8000-000000000002',
    ...projectInput,
    createdAt: '2026-10-25T12:00:00.000Z',
    configurationStatus: 'ready',
    ...overrides,
  };
}
