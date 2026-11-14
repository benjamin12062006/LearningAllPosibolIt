import { describe, expect, it } from '@jest/globals';
import { buildSchema, Kind, parse, type FragmentDefinitionNode } from 'graphql';
import {
  MAX_QUERY_COST,
  operationCost,
} from '../../../src/graphql/common/query-cost.js';

const schema = buildSchema(`
  type Change { id: ID!, fields: [String!]! }
  type Counts { added: Int!, removed: Int! }
  type Comparison { counts: Counts!, changes: [Change!]! }
  type Feed { id: ID!, comparison(limit: Int = 50): Comparison! }
  type Project { id: ID!, name: String!, feeds: [Feed!]!, children(limit: Int): [Project!]! }
  type Query { projects(limit: Int = 20): [Project!]!, project: Project }
`);

function cost(query: string, variables: Record<string, unknown> = {}) {
  const document = parse(query);
  const fragments = new Map<string, FragmentDefinitionNode>();
  let operation;
  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) {
      fragments.set(definition.name.value, definition);
    } else if (definition.kind === Kind.OPERATION_DEFINITION) {
      operation = definition;
    }
  }
  return operationCost(schema, operation!, fragments, variables);
}

describe('operationCost', () => {
  it('cada campo cuesta 1 y una lista multiplica por su límite por defecto', () => {
    expect(cost('{ project { id name } }')).toBe(3);
    // 1 + 20 × (id + name)
    expect(cost('{ projects { id name } }')).toBe(41);
  });

  it('usa el límite escrito o el de las variables', () => {
    expect(cost('{ projects(limit: 5) { id } }')).toBe(6);
    expect(
      cost('query($n: Int) { projects(limit: $n) { id } }', { n: 3 }),
    ).toBe(4);
    // Sin la variable, el de por defecto del argumento.
    expect(cost('query($n: Int) { projects(limit: $n) { id } }')).toBe(21);
  });

  it('una página pasa su límite solo a sus listas, no a los recuentos', () => {
    // project + feeds + comparison (pesa 10) + counts (1 + 2) + changes (1 + 50 × 2)
    expect(
      cost(
        '{ project { feeds { comparison { counts { added removed } changes { id fields } } } } }',
      ),
    ).toBe(1 + 1 + (10 + 3 + (1 + 50 * 2)));
  });

  it('las listas anidadas con límite se multiplican entre sí', () => {
    const nested = '{ projects(limit: 100) { children(limit: 100) { id } } }';
    expect(cost(nested)).toBe(1 + 100 * (1 + 100 * 1));
    expect(cost(nested)).toBeGreaterThan(MAX_QUERY_COST);
  });

  it('cuenta lo que piden los fragmentos e ignora la introspección', () => {
    const query = `
      query { projects(limit: 2) { ...P ... on Project { name } } }
      fragment P on Project { id }`;
    expect(cost(query)).toBe(1 + 2 * 2);
    expect(cost('{ __typename __schema { types { name } } }')).toBe(0);
  });
});
