import { describe, expect, it } from '@jest/globals';
import { ErrorCodes } from '../../../src/common/http/error-codes.js';
import { API_MESSAGES } from '../../../src/common/http/messages.js';
import { ENGINE_VERSION } from '../../../src/evaluations/engine/evaluate-row.js';
import { PROFILE_VERSION } from '../../../src/evaluations/engine/google-merchant.profile.js';
import {
  findExportBlocker,
  type EvaluationToExport,
  type ExportApproval,
} from '../../../src/exports/export-approval.js';

const CHECKSUM = 'a'.repeat(64);

const EXPORTABLE: EvaluationToExport = {
  status: 'succeeded',
  engineVersion: ENGINE_VERSION,
  profileVersion: PROFILE_VERSION,
  counts: { valid: 3, invalid: 1, excluded: 1 },
  resultChecksum: CHECKSUM,
  hasNewerEvaluation: false,
};

const APPROVAL: ExportApproval = {
  resultChecksum: CHECKSUM,
  acceptedInvalidCount: 1,
  acceptedExcludedCount: 1,
};

const WITHOUT_RESULTS = {
  counts: null,
  resultChecksum: null,
} as const;

describe('findExportBlocker', () => {
  it('permite exportar una evaluación terminada, vigente y aprobada tal como está', () => {
    expect(findExportBlocker(EXPORTABLE, APPROVAL)).toBeNull();
  });

  it('acepta confirmar cero inválidas y cero excluidas', () => {
    const allValid = {
      ...EXPORTABLE,
      counts: { valid: 5, invalid: 0, excluded: 0 },
    };

    expect(
      findExportBlocker(allValid, {
        ...APPROVAL,
        acceptedInvalidCount: 0,
        acceptedExcludedCount: 0,
      }),
    ).toBeNull();
  });

  describe('D1 — solo una evaluación terminada y con productos válidos', () => {
    it.each(['queued', 'running', 'failed'] as const)(
      'una evaluación %s no tiene resultados',
      (status) => {
        expect(
          findExportBlocker(
            { ...EXPORTABLE, ...WITHOUT_RESULTS, status },
            APPROVAL,
          ),
        ).toBe(ErrorCodes.EVALUATION_RESULTS_UNAVAILABLE);
      },
    );

    // La base no permite conteos fuera de `succeeded` (CHECK de evaluaciones);
    // el caso comprueba que la función no se apoya solo en los conteos.
    it.each(['queued', 'running', 'failed'] as const)(
      'una evaluación %s no se exporta aunque traiga conteos y suma',
      (status) => {
        expect(findExportBlocker({ ...EXPORTABLE, status }, APPROVAL)).toBe(
          ErrorCodes.EVALUATION_RESULTS_UNAVAILABLE,
        );
      },
    );

    it('tampoco si figura como terminada pero le faltan conteos o suma', () => {
      expect(findExportBlocker({ ...EXPORTABLE, counts: null }, APPROVAL)).toBe(
        ErrorCodes.EVALUATION_RESULTS_UNAVAILABLE,
      );
      expect(
        findExportBlocker({ ...EXPORTABLE, resultChecksum: null }, APPROVAL),
      ).toBe(ErrorCodes.EVALUATION_RESULTS_UNAVAILABLE);
    });

    it('sin productos válidos se bloquea el feed vacío', () => {
      const noneValid = {
        ...EXPORTABLE,
        counts: { valid: 0, invalid: 4, excluded: 1 },
      };

      expect(
        findExportBlocker(noneValid, { ...APPROVAL, acceptedInvalidCount: 4 }),
      ).toBe(ErrorCodes.EXPORT_NO_VALID_PRODUCTS);
    });
  });

  describe('D3 — la evaluación debe seguir vigente', () => {
    it('con otra versión del perfil está desactualizada', () => {
      expect(
        findExportBlocker(
          { ...EXPORTABLE, profileVersion: 'google_merchant@2026-10-31-antes' },
          APPROVAL,
        ),
      ).toBe(ErrorCodes.EXPORT_EVALUATION_OUTDATED);
    });

    it('con otra versión del motor está desactualizada', () => {
      expect(
        findExportBlocker(
          { ...EXPORTABLE, engineVersion: `${ENGINE_VERSION}-antes` },
          APPROVAL,
        ),
      ).toBe(ErrorCodes.EXPORT_EVALUATION_OUTDATED);
    });

    it('una evaluación posterior del proyecto la reemplaza', () => {
      expect(
        findExportBlocker(
          { ...EXPORTABLE, hasNewerEvaluation: true },
          APPROVAL,
        ),
      ).toBe(ErrorCodes.EXPORT_EVALUATION_SUPERSEDED);
    });
  });

  describe('D2 — la aprobación debe coincidir con lo guardado', () => {
    it.each([
      ['otra suma', { resultChecksum: 'b'.repeat(64) }],
      ['la suma en mayúsculas', { resultChecksum: CHECKSUM.toUpperCase() }],
      ['otro número de inválidas', { acceptedInvalidCount: 0 }],
      ['otro número de excluidas', { acceptedExcludedCount: 2 }],
    ])('%s no coincide', (_case, change) => {
      expect(findExportBlocker(EXPORTABLE, { ...APPROVAL, ...change })).toBe(
        ErrorCodes.EXPORT_APPROVAL_MISMATCH,
      );
    });

    it('intercambiar inválidas y excluidas no coincide', () => {
      const evaluation = {
        ...EXPORTABLE,
        counts: { valid: 3, invalid: 2, excluded: 1 },
      };

      expect(
        findExportBlocker(evaluation, {
          ...APPROVAL,
          acceptedInvalidCount: 1,
          acceptedExcludedCount: 2,
        }),
      ).toBe(ErrorCodes.EXPORT_APPROVAL_MISMATCH);
    });
  });

  describe('cuando fallan varias, devuelve el primer motivo', () => {
    const wrongApproval = { ...APPROVAL, resultChecksum: 'b'.repeat(64) };

    it('sin resultados antes que todo lo demás', () => {
      expect(
        findExportBlocker(
          {
            ...EXPORTABLE,
            ...WITHOUT_RESULTS,
            status: 'failed',
            profileVersion: 'antigua',
            hasNewerEvaluation: true,
          },
          wrongApproval,
        ),
      ).toBe(ErrorCodes.EVALUATION_RESULTS_UNAVAILABLE);
    });

    it('desactualizada antes que reemplazada, sin válidos o aprobación distinta', () => {
      expect(
        findExportBlocker(
          {
            ...EXPORTABLE,
            profileVersion: 'antigua',
            hasNewerEvaluation: true,
            counts: { valid: 0, invalid: 1, excluded: 1 },
          },
          wrongApproval,
        ),
      ).toBe(ErrorCodes.EXPORT_EVALUATION_OUTDATED);
    });

    it('reemplazada antes que sin válidos o aprobación distinta', () => {
      expect(
        findExportBlocker(
          {
            ...EXPORTABLE,
            hasNewerEvaluation: true,
            counts: { valid: 0, invalid: 1, excluded: 1 },
          },
          wrongApproval,
        ),
      ).toBe(ErrorCodes.EXPORT_EVALUATION_SUPERSEDED);
    });

    it('sin válidos antes que aprobación distinta', () => {
      expect(
        findExportBlocker(
          { ...EXPORTABLE, counts: { valid: 0, invalid: 1, excluded: 1 } },
          wrongApproval,
        ),
      ).toBe(ErrorCodes.EXPORT_NO_VALID_PRODUCTS);
    });
  });

  it.each([
    ErrorCodes.EXPORT_NO_VALID_PRODUCTS,
    ErrorCodes.EXPORT_APPROVAL_MISMATCH,
    ErrorCodes.EXPORT_EVALUATION_OUTDATED,
    ErrorCodes.EXPORT_EVALUATION_SUPERSEDED,
  ])('%s responde 409', (code) => {
    expect(API_MESSAGES[code].status).toBe(409);
  });
});
