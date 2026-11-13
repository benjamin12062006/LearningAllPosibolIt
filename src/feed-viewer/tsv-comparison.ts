import { ID_COLUMN, type TsvProduct, type TsvTable } from './tsv-page.js';

export const CHANGE_KINDS = ['added', 'removed', 'modified'] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** Un valor que cambió. `null` es que ese archivo no tiene la columna. */
export type FieldChange = Readonly<{
  field: string;
  before: string | null;
  after: string | null;
}>;

/**
 * Lo que le pasa a un producto si se publica el candidato. `fields` solo se
 * rellena en los modificados: de un añadido o un retirado se ve todo en su
 * ficha.
 */
export type ProductChange = Readonly<{
  id: string;
  change: ChangeKind;
  fields: readonly FieldChange[];
}>;

export type ChangeCounts = Readonly<{
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
}>;

/** «30 productos cambiaron de precio»: un campo y cuántos productos lo cambian. */
export type ChangedField = Readonly<{ field: string; productCount: number }>;

export type TsvComparison = Readonly<{
  counts: ChangeCounts;
  changedFields: readonly ChangedField[];
  changes: readonly ProductChange[];
}>;

/**
 * Compara por `id` lo publicado con lo que se publicaría (plan 02 de cierre,
 * P5). Los cambios van en el orden del candidato y, al final, los retirados en
 * el orden de lo publicado: así la lista se lee como el archivo nuevo.
 */
export function compareProducts(
  published: TsvTable,
  candidate: TsvTable,
): TsvComparison {
  const fields = comparedFields(published, candidate);
  const publishedById = byId(published.products);
  const candidateIds = new Set(candidate.products.map(idOf));

  const changes: ProductChange[] = [];
  let unchanged = 0;
  for (const product of candidate.products) {
    const before = publishedById.get(idOf(product));
    if (!before) {
      changes.push({ id: idOf(product), change: 'added', fields: [] });
      continue;
    }
    const changed = changedFieldsOf(fields, before, product);
    if (changed.length === 0) {
      unchanged += 1;
    } else {
      changes.push({ id: idOf(product), change: 'modified', fields: changed });
    }
  }
  for (const product of published.products) {
    if (!candidateIds.has(idOf(product))) {
      changes.push({ id: idOf(product), change: 'removed', fields: [] });
    }
  }

  return {
    counts: { ...countByKind(changes), unchanged },
    changedFields: countByField(changes),
    changes,
  };
}

/**
 * Las columnas de los dos archivos, sin el `id`: primero las del candidato y
 * después las que solo tenía lo publicado. Cambiar las reglas puede añadir o
 * quitar una columna, y eso también es un cambio en cada producto.
 */
function comparedFields(published: TsvTable, candidate: TsvTable): string[] {
  const fields = new Set([...candidate.columns, ...published.columns]);
  fields.delete(ID_COLUMN);
  return [...fields];
}

function changedFieldsOf(
  fields: readonly string[],
  before: TsvProduct,
  after: TsvProduct,
): FieldChange[] {
  const changed: FieldChange[] = [];
  for (const field of fields) {
    const oldValue = before.values[field] ?? null;
    const newValue = after.values[field] ?? null;
    if (oldValue !== newValue) {
      changed.push({ field, before: oldValue, after: newValue });
    }
  }
  return changed;
}

function countByKind(changes: readonly ProductChange[]) {
  const counts = { added: 0, removed: 0, modified: 0 };
  for (const { change } of changes) {
    counts[change] += 1;
  }
  return counts;
}

/** Del campo que más productos cambia al que menos; a igualdad, por nombre. */
function countByField(changes: readonly ProductChange[]): ChangedField[] {
  const counts = new Map<string, number>();
  for (const { fields } of changes) {
    for (const { field } of fields) {
      counts.set(field, (counts.get(field) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([field, productCount]) => ({ field, productCount }))
    .sort(
      (a, b) =>
        b.productCount - a.productCount || a.field.localeCompare(b.field),
    );
}

function byId(products: readonly TsvProduct[]) {
  return new Map(products.map((product) => [idOf(product), product]));
}

function idOf(product: TsvProduct): string {
  return product.values[ID_COLUMN] ?? '';
}
