import { describe, expect, it } from '@jest/globals';
import {
  catalogDocuments,
  DOCUMENT_LIMITS,
  evaluationDocuments,
  feedDocuments,
  productDocumentId,
  projectDocuments,
  rulesetDocuments,
} from '../../../src/knowledge/knowledge-documents.js';
import type {
  CatalogFacts,
  CatalogProductRow,
  FeedFacts,
} from '../../../src/knowledge/knowledge.repository.js';

const catalog: CatalogFacts = {
  originalName: 'productos-otono.csv',
  idColumn: 'SKU',
  rowCount: 2,
  importedAt: '2026-11-08T10:00:00.000Z',
  evaluatedAt: '2026-11-08T10:05:00.000Z',
};

function product(
  overrides: Partial<CatalogProductRow> = {},
): CatalogProductRow {
  return {
    sourceRow: 43,
    externalId: 'SKU-0042',
    originalValues: {
      SKU: 'SKU-0042',
      Nombre: 'Zapatillas de running rojas',
      Precio: '59,90',
      Marca: ' ',
    },
    outcome: 'invalid',
    problems: [{ attribute: 'image_link', code: 'FIELD_MISSING' }],
    inFeed: false,
    ...overrides,
  };
}

const feed: FeedFacts = {
  generation: 3,
  publishedRowCount: 120,
  publishedAt: '2026-11-08T11:00:00.000Z',
  publishedBy: 'refresh',
  hasSource: true,
  refreshEnabled: true,
  refreshTime: '06:30',
  timeZone: 'Europe/Madrid',
  policyRulesetRevision: 2,
  lastRefreshStatus: 'succeeded',
  lastRefreshOutcome: 'needs_review',
  lastRefreshError: { code: 'FEED_GENERATION_CONFLICT' },
  lastRefreshAt: '2026-11-09T06:30:00.000Z',
};

describe('documentos de conocimiento', () => {
  it('la ficha de producto junta catálogo, evaluación y feed en español', () => {
    const [summary, card] = catalogDocuments(catalog, [product()]);

    expect(summary.documentId).toBe('catalog');
    expect(summary.text).toContain('Catálogo «productos-otono.csv»');
    expect(card).toEqual({
      documentId: 'product:SKU-0042',
      text: [
        'Producto SKU-0042 (catálogo «productos-otono.csv», fila 43).',
        'Nombre: Zapatillas de running rojas · Precio: 59,90',
        'Evaluación: inválido — image_link: Falta un valor obligatorio para Google..',
        'En el feed publicado: no.',
      ].join('\n'),
      metadata: {
        kind: 'product',
        external_id: 'SKU-0042',
        outcome: 'invalid',
        in_feed: false,
        source_row: 43,
      },
    });
  });

  it('sin evaluación del catálogo lo dice, y un producto en el feed también', () => {
    const [, card] = catalogDocuments(catalog, [
      product({ outcome: null, problems: null, inFeed: true }),
    ]);

    expect(card.text).toContain('Sin evaluar con la última evaluación.');
    expect(card.text).toContain('En el feed publicado: sí.');
    expect(card.metadata.outcome).toBe('not_evaluated');
  });

  it('un id de producto largo usa un hash estable en lugar de recortarse', () => {
    const long = 'X'.repeat(300);

    expect(productDocumentId(long)).toMatch(/^product:sha256:[a-f0-9]{64}$/);
    expect(productDocumentId(long)).toBe(productDocumentId(long));
    expect(productDocumentId(`${long}Y`)).not.toBe(productDocumentId(long));
  });

  it('recorta un texto que pasa el límite del servicio y lo marca', () => {
    const [, card] = catalogDocuments(catalog, [
      product({ originalValues: { Descripción: 'a'.repeat(9_000) } }),
    ]);

    expect(card.text).toHaveLength(DOCUMENT_LIMITS.textLength);
    expect(card.text.endsWith('…')).toBe(true);
  });

  it('el feed no dice la URL de la fuente y traduce el resultado', () => {
    const [document] = feedDocuments(feed);

    expect(document.text).toContain(
      'por la actualización automática, con 120 productos',
    );
    expect(document.text).toContain('a las 06:30 (Europe/Madrid)');
    expect(document.text).toContain('necesita revisión antes de publicar');
    expect(document.text).toContain(
      'Motivo: El feed cambió desde que lo consultaste',
    );
    expect(document.text).not.toMatch(/https?:\/\//);
  });

  it('las reglas se describen una a una', () => {
    const [document] = rulesetDocuments({
      revision: 2,
      createdAt: '2026-11-08T09:00:00.000Z',
      mapping: [{ attribute: 'title', column: 'Nombre' }],
      rules: [
        { type: 'clean_text', attributes: ['title'] },
        {
          type: 'exclude_when',
          attribute: 'brand',
          operator: 'is_empty',
          value: '',
        },
      ],
    });

    expect(document.text).toContain('- title ← columna «Nombre»');
    expect(document.text).toContain('1. Limpiar espacios de: title.');
    expect(document.text).toContain(
      '2. Excluir el producto cuando brand está vacío.',
    );
  });

  it('unas reglas guardadas con otra forma no se inventan', () => {
    const [document] = rulesetDocuments({
      revision: 9,
      createdAt: 'x',
      mapping: 'roto',
      rules: [],
    });

    expect(document.text).toBe('Reglas, revisión 9: no se pudieron leer.');
  });

  it('la evaluación resume recuentos y problemas frecuentes', () => {
    const [document] = evaluationDocuments(
      {
        id: 'e1',
        status: 'succeeded',
        totalCount: 10,
        validCount: 7,
        invalidCount: 2,
        excludedCount: 1,
        createdAt: '2026-11-08T10:00:00.000Z',
        finishedAt: '2026-11-08T10:01:00.000Z',
        catalogName: 'productos.csv',
        error: null,
      },
      [{ attribute: 'image_link', code: 'FIELD_MISSING', count: 2 }],
    );

    expect(document.text).toContain('terminada');
    expect(document.text).toContain(
      '10 productos: 7 válidos, 2 inválidos y 1 excluidos',
    );
    expect(document.text).toContain(
      '- image_link: Falta un valor obligatorio para Google. (2 productos)',
    );
  });

  it('el proyecto dice qué falta configurar y si la organización está archivada', () => {
    const [document] = projectDocuments({
      name: 'Tienda',
      country: null,
      currency: 'EUR',
      channelProfile: null,
      organizationName: 'Acme',
      organizationArchived: true,
    });

    expect(document.text).toContain('País: sin configurar · Moneda: EUR');
    expect(document.text).toContain('archivada');
    expect(document.metadata.configured).toBe(false);
  });
});
