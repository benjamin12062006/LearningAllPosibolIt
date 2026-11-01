import type { ImportRow } from '../../../../src/catalog-import/import.types.js';
import type {
  AttributeMapping,
  Rule,
  Ruleset,
} from '../../../../src/evaluations/engine/ruleset.js';

export const USD = { currency: 'USD' } as const;

/** Mapeo de todas las columnas de `productRow` a su atributo homónimo. */
export const FULL_MAPPING: readonly AttributeMapping[] = [
  { attribute: 'title', column: 'title' },
  { attribute: 'description', column: 'description' },
  { attribute: 'link', column: 'link' },
  { attribute: 'image_link', column: 'image_link' },
  { attribute: 'price', column: 'price' },
  { attribute: 'availability', column: 'availability' },
  { attribute: 'condition', column: 'condition' },
  { attribute: 'brand', column: 'brand' },
];

/** Fila válida para Google; cada prueba cambia solo lo que comprueba. */
export function productRow(
  values: Record<string, string> = {},
  identity: Partial<Pick<ImportRow, 'sourceRow' | 'externalId'>> = {},
): ImportRow {
  return {
    sourceRow: identity.sourceRow ?? 1,
    externalId: identity.externalId ?? 'SKU-001',
    originalValues: {
      title: 'Mesa de roble',
      description: 'Mesa de comedor para seis personas.',
      link: 'https://tienda.example/mesa',
      image_link: 'https://tienda.example/mesa.jpg',
      price: '149.90',
      availability: 'in_stock',
      condition: 'new',
      brand: 'Acme',
      ...values,
    },
  };
}

export function ruleset(
  rules: readonly Rule[] = [],
  mapping: readonly AttributeMapping[] = FULL_MAPPING,
): Ruleset {
  return { mapping, rules };
}

/**
 * Generador pseudoaleatorio con semilla (mulberry32): las pruebas de mezclas
 * son variadas pero repetibles.
 */
export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
