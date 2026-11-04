import { describe, expect, it } from '@jest/globals';
import { checkRefreshPolicy } from '../../../src/feed-refreshes/refresh-policy.js';
import type { FeedPolicy } from '../../../src/feeds/feeds.types.js';

const POLICY: FeedPolicy = {
  rulesetRevision: 1,
  maxInvalid: 2,
  maxExcluded: 3,
  maxDropPercent: 10,
  engineVersion: '2',
  profileVersion: 'google_merchant@2026-11-01',
  approvedAt: '2026-11-03T00:00:00.000Z',
};

const evaluation = (
  overrides: Partial<Parameters<typeof checkRefreshPolicy>[1]> = {},
) => ({
  engineVersion: '2',
  profileVersion: 'google_merchant@2026-11-01',
  valid: 100,
  invalid: 2,
  excluded: 3,
  ...overrides,
});

describe('Política de la actualización automática (D11)', () => {
  it('dentro de los límites, sin versión publicada: se puede publicar', () => {
    expect(checkRefreshPolicy(POLICY, evaluation(), null)).toBeNull();
  });

  it('si cambió el motor o el perfil, hay que reaprobar', () => {
    expect(
      checkRefreshPolicy(POLICY, evaluation({ engineVersion: '3' }), null),
    ).toBe('REFRESH_POLICY_VERSIONS_CHANGED');
    expect(
      checkRefreshPolicy(
        POLICY,
        evaluation({ profileVersion: 'google_merchant@2027-01-01' }),
        null,
      ),
    ).toBe('REFRESH_POLICY_VERSIONS_CHANGED');
  });

  it('sin productos válidos no se publica', () => {
    expect(checkRefreshPolicy(POLICY, evaluation({ valid: 0 }), null)).toBe(
      'REFRESH_POLICY_NO_VALID_PRODUCTS',
    );
  });

  it('el límite de inválidos y de excluidos es inclusivo', () => {
    expect(
      checkRefreshPolicy(POLICY, evaluation({ invalid: 2 }), null),
    ).toBeNull();
    expect(checkRefreshPolicy(POLICY, evaluation({ invalid: 3 }), null)).toBe(
      'REFRESH_POLICY_TOO_MANY_INVALID',
    );
    expect(
      checkRefreshPolicy(POLICY, evaluation({ excluded: 3 }), null),
    ).toBeNull();
    expect(checkRefreshPolicy(POLICY, evaluation({ excluded: 4 }), null)).toBe(
      'REFRESH_POLICY_TOO_MANY_EXCLUDED',
    );
  });

  it('caída: exactamente el porcentaje permitido pasa; uno menos, no', () => {
    // 10 % de 100 publicados: 90 válidos es el mínimo.
    expect(
      checkRefreshPolicy(POLICY, evaluation({ valid: 90 }), 100),
    ).toBeNull();
    expect(checkRefreshPolicy(POLICY, evaluation({ valid: 89 }), 100)).toBe(
      'REFRESH_POLICY_PRODUCT_DROP',
    );
  });

  it('caída en enteros: 10 % de 30 publicados exige 27 válidos', () => {
    expect(
      checkRefreshPolicy(POLICY, evaluation({ valid: 27 }), 30),
    ).toBeNull();
    expect(checkRefreshPolicy(POLICY, evaluation({ valid: 26 }), 30)).toBe(
      'REFRESH_POLICY_PRODUCT_DROP',
    );
  });

  it('más productos que los publicados nunca es una caída', () => {
    expect(
      checkRefreshPolicy(POLICY, evaluation({ valid: 500 }), 100),
    ).toBeNull();
  });

  it('caída permitida 0 %: no puede bajar ni uno; 100 %: cualquier caída vale', () => {
    const strict = { ...POLICY, maxDropPercent: 0 };
    const loose = { ...POLICY, maxDropPercent: 100 };
    expect(checkRefreshPolicy(strict, evaluation({ valid: 99 }), 100)).toBe(
      'REFRESH_POLICY_PRODUCT_DROP',
    );
    expect(checkRefreshPolicy(loose, evaluation({ valid: 1 }), 100)).toBeNull();
  });

  it('el orden de las comprobaciones es el del plan', () => {
    expect(
      checkRefreshPolicy(
        POLICY,
        evaluation({ engineVersion: '9', valid: 0, invalid: 99 }),
        1000,
      ),
    ).toBe('REFRESH_POLICY_VERSIONS_CHANGED');
    expect(
      checkRefreshPolicy(POLICY, evaluation({ valid: 0, invalid: 99 }), 1000),
    ).toBe('REFRESH_POLICY_NO_VALID_PRODUCTS');
    expect(
      checkRefreshPolicy(
        POLICY,
        evaluation({ invalid: 99, excluded: 99 }),
        1000,
      ),
    ).toBe('REFRESH_POLICY_TOO_MANY_INVALID');
  });
});
