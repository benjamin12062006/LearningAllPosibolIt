import { describe, expect, it } from '@jest/globals';

import { aiAutoConfirmFrom } from '../../../src/agent-runs/auto-confirm.js';

describe('aiAutoConfirmFrom (plan 05 de cli)', () => {
  it('aplica siempre fuera de las pruebas, aunque la variable diga false', () => {
    expect(aiAutoConfirmFrom({})).toBe(true);
    expect(aiAutoConfirmFrom({ NODE_ENV: 'production' })).toBe(true);
    expect(
      aiAutoConfirmFrom({ NODE_ENV: 'production', AI_AUTO_CONFIRM: 'false' }),
    ).toBe(true);
  });

  it('solo la suite puede pedir el flujo con propuesta pendiente', () => {
    expect(aiAutoConfirmFrom({ NODE_ENV: 'test' })).toBe(true);
    expect(
      aiAutoConfirmFrom({ NODE_ENV: 'test', AI_AUTO_CONFIRM: ' False ' }),
    ).toBe(false);
  });
});
