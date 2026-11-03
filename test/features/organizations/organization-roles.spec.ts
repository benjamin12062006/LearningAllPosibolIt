import { describe, expect, it } from '@jest/globals';
import {
  ORGANIZATION_ROLES,
  permissionsFor,
  type OrganizationRole,
} from '../../../src/organizations/organization-roles.js';

describe('Permisos de cada rol (tabla «Modelo de acceso» de docs-diagrams/11)', () => {
  it.each<[OrganizationRole, string[]]>([
    ['viewer', ['organization.read']],
    ['editor', ['organization.read', 'worksheet.write', 'ai.use']],
    [
      'manager',
      ['organization.read', 'worksheet.write', 'ai.use', 'changeset.approve'],
    ],
    [
      'admin',
      [
        'organization.read',
        'worksheet.write',
        'ai.use',
        'changeset.approve',
        'inventory.adjust',
        'members.manage',
      ],
    ],
    [
      'owner',
      [
        'organization.read',
        'worksheet.write',
        'ai.use',
        'changeset.approve',
        'inventory.adjust',
        'members.manage',
        'organization.own',
      ],
    ],
  ])('%s tiene exactamente sus permisos', (role, expected) => {
    expect([...permissionsFor(role)]).toEqual(expected);
  });

  it('cada rol conserva todo lo que puede el rol inferior', () => {
    const fromLowestToHighest = [...ORGANIZATION_ROLES].reverse();

    for (let index = 1; index < fromLowestToHighest.length; index++) {
      const lower = permissionsFor(fromLowestToHighest[index - 1]);
      const higher = permissionsFor(fromLowestToHighest[index]);
      expect(higher).toEqual(expect.arrayContaining([...lower]));
    }
  });

  it('preparar trabajo no permite aprobarlo y aprobar no permite ajustar stock', () => {
    expect(permissionsFor('editor')).not.toContain('changeset.approve');
    expect(permissionsFor('manager')).not.toContain('inventory.adjust');
    expect(permissionsFor('admin')).not.toContain('organization.own');
  });
});
