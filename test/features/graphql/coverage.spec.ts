import { describe, expect, it } from '@jest/globals';
import { buildSchema, isObjectType, type GraphQLSchema } from 'graphql';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MATRIX = resolve(
  'docs/fonts/feature/graphql&rulesets-evaluations-exports/05-inventario-y-alcance-de-c7.md',
);
const SCHEMA = resolve('test/features/graphql/schema.expected.graphql');
const METHODS = ['Get', 'Post', 'Put', 'Patch', 'Delete'] as const;

type MatrixRow = Readonly<{
  route: string;
  equivalent: string | null;
  decision: string;
}>;

/** `METHOD ruta` de cada ruta montada, escrita como en la matriz. */
function mountedRoutes(): string[] {
  const routes: string[] = [];
  for (const file of controllerFiles(resolve('src'))) {
    const source = readFileSync(file, 'utf8');
    const prefix =
      // Admite el prefijo en otra línea, como lo deja Prettier si es largo.
      /@Controller\(\s*(?:'([^']*)'|\{\s*path:\s*'([^']*)'[^)]*)?\s*,?\s*\)/.exec(
        source,
      );
    const base = prefix?.[1] ?? prefix?.[2] ?? '';
    const decorator = new RegExp(
      `@(${METHODS.join('|')})\\((?:'([^']*)')?\\)`,
      'g',
    );
    for (const [, method, path] of source.matchAll(decorator)) {
      const full = `/${[base, path].filter(Boolean).join('/')}`;
      routes.push(`${method.toUpperCase()} ${abbreviate(full)}`);
    }
  }
  return routes.sort();
}

function controllerFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return controllerFiles(path);
    return entry.name.endsWith('.controller.ts') ? [path] : [];
  });
}

/** La matriz abrevia los dos prefijos largos (ficha 05, «Matriz»). */
function abbreviate(path: string) {
  return path
    .replace(
      /^\/organizations\/:organizationId\/projects\/:projectId/,
      '…/org/proyecto',
    )
    .replace(/^\/projects\/:projectId/, '…/proyecto');
}

/** Las filas de la tabla «Matriz»: ruta, equivalente y decisión. */
function matrixRows(): MatrixRow[] {
  const text = readFileSync(MATRIX, 'utf8');
  const table = text.slice(text.indexOf('## Matriz'));
  return table
    .split('\n')
    .filter((line) => line.startsWith('| `'))
    .map((line) => {
      const cells = line.split('|').map((cell) => cell.trim());
      const [, , route, , equivalent, , decision] = cells;
      return {
        route: route.replaceAll('`', ''),
        equivalent: /`([^`]+)`/.exec(equivalent)?.[1] ?? null,
        decision,
      };
    });
}

/** `Tipo.campo` o una operación raíz de `Query` o `Mutation`. */
function existsInSchema(schema: GraphQLSchema, coordinate: string) {
  const [first, second] = coordinate.split('.');
  if (second) {
    const type = schema.getType(first);
    return isObjectType(type) && second in type.getFields();
  }
  return [schema.getQueryType(), schema.getMutationType()].some(
    (root) => root !== null && root !== undefined && first in root.getFields(),
  );
}

const hasEquivalent = (row: MatrixRow) =>
  row.decision.startsWith('Existe') || row.decision.startsWith('Añadir');

/**
 * La cobertura de C7 medida, no supuesta: la matriz de la ficha 05 tiene que
 * coincidir con las rutas montadas, y cada equivalente previsto tiene que
 * existir en el esquema.
 */
describe('cobertura GraphQL de la API REST (C7)', () => {
  const rows = matrixRows();
  const schema = buildSchema(readFileSync(SCHEMA, 'utf8'));

  it('la matriz tiene exactamente las rutas montadas, sin repetidas', () => {
    const inMatrix = rows.map((row) => row.route).sort();
    expect(new Set(inMatrix).size).toBe(inMatrix.length);
    expect(inMatrix).toEqual(mountedRoutes());
  });

  it('cada equivalente previsto existe en el esquema', () => {
    const missing = rows
      .filter(hasEquivalent)
      .filter(
        (row) => !row.equivalent || !existsInSchema(schema, row.equivalent),
      )
      .map((row) => `${row.route} → ${row.equivalent}`);
    expect(missing).toEqual([]);
  });

  it('101 de 146 rutas tienen equivalente; 15 son solo HTTP y 30 se quedan en REST', () => {
    const count = (predicate: (row: MatrixRow) => boolean) =>
      rows.filter(predicate).length;
    expect({
      total: rows.length,
      withEquivalent: count(hasEquivalent),
      httpOnly: count((row) => row.decision === 'HTTP'),
      restOnly: count((row) => row.decision === 'REST'),
    }).toEqual({ total: 146, withEquivalent: 101, httpOnly: 15, restOnly: 30 });
  });
});
