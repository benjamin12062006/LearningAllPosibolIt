import type { RowOutcome } from './engine/evaluate-row.js';
import {
  PRODUCT_ATTRIBUTES,
  type ProductAttribute,
  type ProductValues,
  type RowProblem,
} from './engine/google-merchant.profile.js';
import type {
  EvaluationCountsView,
  RowOutcomeKind,
} from './evaluations.types.js';

/** Un valor del producto que cambia. `null` es que con esas reglas no tiene ese atributo. */
export type ValueChange = Readonly<{
  attribute: ProductAttribute;
  before: string | null;
  after: string | null;
}>;

/** Cómo queda un producto con unas reglas. */
export type PreviewedOutcome = Readonly<{
  outcome: RowOutcomeKind;
  problems: readonly RowProblem[];
  excludedByRule: number | null;
}>;

/** Un producto al que las reglas propuestas le cambian algo. */
export type ProductPreview = Readonly<{
  sourceRow: number;
  externalId: string;
  current: PreviewedOutcome;
  proposed: PreviewedOutcome;
  values: readonly ValueChange[];
}>;

export type ProblemCount = RowProblem & Readonly<{ productCount: number }>;

/** Los problemas que traen las reglas propuestas, los que arreglan y los que siguen. */
export type ProblemChanges = Readonly<{
  appeared: readonly ProblemCount[];
  resolved: readonly ProblemCount[];
  persisting: readonly ProblemCount[];
}>;

/** «12 productos pasan de inválidos a válidos». */
export type OutcomeChange = Readonly<{
  from: RowOutcomeKind;
  to: RowOutcomeKind;
  productCount: number;
}>;

export type ChangedAttribute = Readonly<{
  attribute: ProductAttribute;
  productCount: number;
}>;

export type RulesComparison = Readonly<{
  counts: Readonly<{
    current: EvaluationCountsView;
    proposed: EvaluationCountsView;
  }>;
  problems: ProblemChanges;
  outcomeChanges: readonly OutcomeChange[];
  changedValues: readonly ChangedAttribute[];
  /** Solo los productos a los que les cambia algo, en el orden del catálogo. */
  products: readonly ProductPreview[];
}>;

/**
 * Compara el resultado de evaluar el mismo catálogo con las reglas vigentes y
 * con las propuestas (plan 02 de cierre, P6). Las dos listas vienen de las
 * mismas filas y en el mismo orden.
 *
 * A un producto «le cambia algo» si cambia su resultado, sus problemas o algún
 * valor. Que lo excluya otra regla, o la misma en otra posición, no cuenta:
 * insertar una regla movería la posición de todas las siguientes.
 */
export function compareOutcomes(
  current: readonly RowOutcome[],
  proposed: readonly RowOutcome[],
): RulesComparison {
  if (current.length !== proposed.length) {
    throw new Error('Las dos evaluaciones tienen que ser del mismo catálogo.');
  }

  const problems = new ProblemTally();
  const outcomeChanges = new Tally<OutcomeTransition>(
    ({ from, to }) => `${from}>${to}`,
  );
  const changedValues = new Tally<ProductAttribute>((attribute) => attribute);
  const products: ProductPreview[] = [];

  current.forEach((before, index) => {
    const after = proposed[index];
    const problemsChanged = problems.add(before, after);
    const values = valueChanges(before, after);
    const outcomeChanged = before.outcome !== after.outcome;

    if (outcomeChanged) {
      outcomeChanges.add({ from: before.outcome, to: after.outcome });
    }
    for (const { attribute } of values) {
      changedValues.add(attribute);
    }
    if (outcomeChanged || problemsChanged || values.length > 0) {
      products.push({
        sourceRow: before.sourceRow,
        externalId: before.externalId,
        current: previewed(before),
        proposed: previewed(after),
        values,
      });
    }
  });

  return {
    counts: {
      current: countOutcomes(current),
      proposed: countOutcomes(proposed),
    },
    problems: problems.result(),
    outcomeChanges: outcomeChanges
      .entries()
      .map(([transition, productCount]) => ({ ...transition, productCount })),
    changedValues: changedValues
      .entries()
      .map(([attribute, productCount]) => ({ attribute, productCount })),
    products,
  };
}

/**
 * Los valores que cambian entre dos resultados. Un producto excluido no tiene
 * valores: su cambio lo cuenta el resultado, no una lista de atributos vacíos.
 */
function valueChanges(before: RowOutcome, after: RowOutcome): ValueChange[] {
  if (before.outcome === 'excluded' || after.outcome === 'excluded') {
    return [];
  }
  const changes: ValueChange[] = [];
  for (const attribute of PRODUCT_ATTRIBUTES) {
    const oldValue = valueOf(before.values, attribute);
    const newValue = valueOf(after.values, attribute);
    if (oldValue !== newValue) {
      changes.push({ attribute, before: oldValue, after: newValue });
    }
  }
  return changes;
}

function valueOf(values: ProductValues, attribute: ProductAttribute) {
  return values[attribute] ?? null;
}

function previewed(row: RowOutcome): PreviewedOutcome {
  return {
    outcome: row.outcome,
    problems: problemsOf(row),
    excludedByRule: row.outcome === 'excluded' ? row.excludedByRule : null,
  };
}

function problemsOf(row: RowOutcome): readonly RowProblem[] {
  return row.outcome === 'invalid' ? row.problems : [];
}

function countOutcomes(rows: readonly RowOutcome[]): EvaluationCountsView {
  const counts = { total: rows.length, valid: 0, invalid: 0, excluded: 0 };
  for (const row of rows) {
    counts[row.outcome] += 1;
  }
  return counts;
}

type OutcomeTransition = Readonly<{ from: RowOutcomeKind; to: RowOutcomeKind }>;

/** Los problemas de cada producto, repartidos en nuevos, resueltos y los que siguen. */
class ProblemTally {
  private readonly appeared = new Tally<RowProblem>(problemKey);
  private readonly resolved = new Tally<RowProblem>(problemKey);
  private readonly persisting = new Tally<RowProblem>(problemKey);

  /** Anota un producto y dice si sus problemas cambiaron. */
  add(before: RowOutcome, after: RowOutcome): boolean {
    const oldKeys = new Set(problemsOf(before).map(problemKey));
    const newKeys = new Set(problemsOf(after).map(problemKey));
    let changed = false;
    for (const problem of problemsOf(after)) {
      const isNew = !oldKeys.has(problemKey(problem));
      (isNew ? this.appeared : this.persisting).add(problem);
      changed ||= isNew;
    }
    for (const problem of problemsOf(before)) {
      if (!newKeys.has(problemKey(problem))) {
        this.resolved.add(problem);
        changed = true;
      }
    }
    return changed;
  }

  result(): ProblemChanges {
    return {
      appeared: toProblemCounts(this.appeared),
      resolved: toProblemCounts(this.resolved),
      persisting: toProblemCounts(this.persisting),
    };
  }
}

function problemKey(problem: RowProblem) {
  return `${problem.attribute}/${problem.code}`;
}

function toProblemCounts(tally: Tally<RowProblem>): ProblemCount[] {
  return tally.entries().map(([{ attribute, code }, productCount]) => ({
    attribute,
    code,
    productCount,
  }));
}

/**
 * Cuenta cuántas veces aparece cada elemento (dos son el mismo si `keyOf` da la
 * misma clave) y los devuelve del más frecuente al menos; a igualdad, por orden
 * alfabético de la clave.
 */
class Tally<Item> {
  private readonly counts = new Map<string, { item: Item; count: number }>();

  constructor(private readonly keyOf: (item: Item) => string) {}

  add(item: Item) {
    const key = this.keyOf(item);
    const entry = this.counts.get(key) ?? { item, count: 0 };
    entry.count += 1;
    this.counts.set(key, entry);
  }

  entries(): [Item, number][] {
    return [...this.counts.entries()]
      .sort(
        ([leftKey, left], [rightKey, right]) =>
          right.count - left.count || compareText(leftKey, rightKey),
      )
      .map(([, { item, count }]) => [item, count]);
  }
}

/** Orden por código de carácter: no depende del idioma del servidor. */
function compareText(a: string, b: string) {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
