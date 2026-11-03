import { describe, expect, it } from '@jest/globals';
import {
  membershipChangeError,
  type MembershipChangeContext,
} from '../../../src/organizations/membership-rules.js';
import {
  canManageRole,
  type OrganizationRole,
} from '../../../src/organizations/organization-roles.js';

const ACTOR = 'actor';
const TARGET = 'target';

function context(
  overrides: Partial<{
    actorRole: OrganizationRole;
    targetRole: OrganizationRole;
    isPersonalOwner: boolean;
    ownerCount: number;
    change: MembershipChangeContext['change'];
    self: boolean;
  }>,
): MembershipChangeContext {
  const targetId = overrides.self ? ACTOR : TARGET;
  return {
    actor: { userId: ACTOR, role: overrides.actorRole ?? 'owner' },
    target: {
      userId: targetId,
      role: overrides.targetRole ?? 'editor',
      isPersonalOwner: overrides.isPersonalOwner ?? false,
    },
    ownerCount: overrides.ownerCount ?? 1,
    change: overrides.change ?? { kind: 'remove' },
  };
}

describe('Qué roles puede gestionar cada rol', () => {
  it.each<[OrganizationRole, OrganizationRole, boolean]>([
    ['owner', 'owner', true],
    ['owner', 'viewer', true],
    ['admin', 'admin', true],
    ['admin', 'owner', false],
    ['manager', 'viewer', false],
    ['editor', 'viewer', false],
    ['viewer', 'viewer', false],
  ])('%s gestionando a %s → %s', (actor, role, expected) => {
    expect(canManageRole(actor, role)).toBe(expected);
  });
});

describe('Reglas para cambiar el rol o quitar a un miembro', () => {
  it('un owner quita a un editor y cambia su rol', () => {
    expect(membershipChangeError(context({}))).toBeNull();
    expect(
      membershipChangeError(
        context({ change: { kind: 'change-role', role: 'admin' } }),
      ),
    ).toBeNull();
  });

  it.each<[string, Parameters<typeof context>[0]]>([
    ['un editor no gestiona miembros', { actorRole: 'editor' }],
    [
      'un admin no quita a un owner',
      { actorRole: 'admin', targetRole: 'owner', ownerCount: 2 },
    ],
    [
      'un admin no asciende a owner',
      { actorRole: 'admin', change: { kind: 'change-role', role: 'owner' } },
    ],
    [
      'un admin no se asciende a sí mismo a owner',
      {
        actorRole: 'admin',
        targetRole: 'admin',
        self: true,
        change: { kind: 'change-role', role: 'owner' },
      },
    ],
  ])('403: %s', (_label, overrides) => {
    expect(membershipChangeError(context(overrides))).toBe('FORBIDDEN');
  });

  it('cualquiera puede salir por sí mismo, aunque no gestione miembros', () => {
    expect(
      membershipChangeError(
        context({ actorRole: 'viewer', targetRole: 'viewer', self: true }),
      ),
    ).toBeNull();
  });

  it('el último owner no sale ni se degrada; con dos owners, sí', () => {
    const lastOwner = { targetRole: 'owner' as const, self: true };

    expect(membershipChangeError(context(lastOwner))).toBe(
      'ORGANIZATION_LAST_OWNER',
    );
    expect(
      membershipChangeError(
        context({
          ...lastOwner,
          change: { kind: 'change-role', role: 'admin' },
        }),
      ),
    ).toBe('ORGANIZATION_LAST_OWNER');
    expect(
      membershipChangeError(context({ ...lastOwner, ownerCount: 2 })),
    ).toBeNull();
  });

  it('confirmar el rol owner del último owner no cambia nada y se permite', () => {
    expect(
      membershipChangeError(
        context({
          targetRole: 'owner',
          self: true,
          change: { kind: 'change-role', role: 'owner' },
        }),
      ),
    ).toBeNull();
  });

  it('la persona dueña de su organización personal no sale ni pierde owner, aunque haya más owners', () => {
    const personalOwner = {
      targetRole: 'owner' as const,
      isPersonalOwner: true,
      ownerCount: 2,
    };

    expect(membershipChangeError(context(personalOwner))).toBe(
      'ORGANIZATION_PERSONAL_OWNER',
    );
    expect(
      membershipChangeError(
        context({
          ...personalOwner,
          change: { kind: 'change-role', role: 'viewer' },
        }),
      ),
    ).toBe('ORGANIZATION_PERSONAL_OWNER');
  });

  it('sin permiso responde 403 antes que las reglas de owner', () => {
    expect(
      membershipChangeError(
        context({ actorRole: 'editor', targetRole: 'owner', ownerCount: 1 }),
      ),
    ).toBe('FORBIDDEN');
  });
});
