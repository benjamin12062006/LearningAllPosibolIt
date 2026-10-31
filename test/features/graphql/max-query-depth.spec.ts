import { describe, expect, it } from '@jest/globals';
import { buildSchema, parse, validate } from 'graphql';
import { maxQueryDepth } from '../../../src/graphql/common/max-query-depth.rule.js';

const schema = buildSchema(`
  type Node { id: ID!, child: Node, name: String }
  type Query { node: Node }
`);
const errors = (query: string, max: number) =>
  validate(schema, parse(query), [maxQueryDepth(max)]).map((e) => e.message);

describe('maxQueryDepth', () => {
  it('acepta consultas dentro del límite', () => {
    expect(errors('{ node { id child { id } } }', 3)).toEqual([]);
  });

  it('rechaza consultas más profundas', () => {
    expect(errors('{ node { child { child { id } } } }', 3)).toHaveLength(1);
  });

  it('cuenta la profundidad a través de fragmentos', () => {
    const query = `
      query { node { ...A } }
      fragment A on Node { child { ...B } }
      fragment B on Node { child { id } }`;
    expect(errors(query, 3)).toHaveLength(1);
    expect(errors(query, 4)).toEqual([]);
  });

  it('no se cicla con fragmentos recursivos e ignora la introspección', () => {
    const recursive = `
      query { node { ...A } }
      fragment A on Node { child { ...A } }`;
    expect(() => errors(recursive, 5)).not.toThrow();
    expect(
      errors('{ __schema { types { fields { type { name } } } } }', 1),
    ).toEqual([]);
  });
});
