import { describe, expect, it } from '@jest/globals';
import {
  buildSchema,
  Kind,
  parse,
  specifiedRules,
  TypeInfo,
  validate,
  visit,
  visitWithTypeInfo,
  type DocumentNode,
  type FragmentDefinitionNode,
  type GraphQLSchema,
  type OperationDefinitionNode,
} from 'graphql';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { maxQueryDepth } from '../../../src/graphql/common/max-query-depth.rule.js';
import {
  MAX_QUERY_COST,
  operationCost,
} from '../../../src/graphql/common/query-cost.js';
import { GRAPHQL_MAX_DEPTH } from '../../../src/graphql/graphql-config.js';

/**
 * Lo que el agente no puede hacer por GraphQL (ficha 05): borrar, aprobar,
 * aplicar, publicar, configurar el feed, gastar cuota y lo que es de la persona.
 */
const FORBIDDEN_FOR_AGENT = new Set([
  'Mutation.deleteProject',
  'Mutation.deleteImport',
  'Mutation.approveExport',
  'Mutation.decideChangeset',
  'Mutation.applyChangeset',
  'Mutation.approveFeedPolicy',
  'Mutation.publishFeed',
  'Mutation.requestFeedRefresh',
  'Mutation.createFeed',
  'Mutation.setFeedSource',
  'Mutation.setFeedSchedule',
  'Mutation.reindexKnowledge',
  'Mutation.updateMe',
  'Mutation.createProject',
  'Mutation.updateProject',
  'Mutation.reopenChangeset',
  'Mutation.cancelChangeset',
  'Mutation.archiveWorkbook',
  'Mutation.restoreWorkbook',
  'Mutation.archiveWorksheet',
  'Mutation.restoreWorksheet',
  'Mutation.deleteImportMapping',
  'Mutation.deleteSavedView',
  'Project.knowledge',
]);

const CONTRACTS = resolve('contracts/graphql');
const schema = buildSchema(
  readFileSync(
    resolve('test/features/graphql/schema.expected.graphql'),
    'utf8',
  ),
);

type Contract = Readonly<{ file: string; document: DocumentNode }>;

function contractsIn(folder: string): Contract[] {
  const path = join(CONTRACTS, folder);
  return readdirSync(path)
    .filter((name) => name.endsWith('.graphql'))
    .sort()
    .map((name) => ({
      file: `${folder}/${name}`,
      document: parse(readFileSync(join(path, name), 'utf8')),
    }));
}

function operationsOf(document: DocumentNode) {
  return document.definitions.filter(
    (definition): definition is OperationDefinitionNode =>
      definition.kind === Kind.OPERATION_DEFINITION,
  );
}

function fragmentsOf(document: DocumentNode) {
  const fragments = new Map<string, FragmentDefinitionNode>();
  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) {
      fragments.set(definition.name.value, definition);
    }
  }
  return fragments;
}

/** Cada campo que pide el documento, como `Tipo.campo`. */
function fieldsUsed(graphqlSchema: GraphQLSchema, document: DocumentNode) {
  const typeInfo = new TypeInfo(graphqlSchema);
  const used = new Set<string>();
  visit(
    document,
    visitWithTypeInfo(typeInfo, {
      Field() {
        const parent = typeInfo.getParentType();
        const field = typeInfo.getFieldDef();
        if (parent && field) used.add(`${parent.name}.${field.name}`);
      },
    }),
  );
  return used;
}

const agent = contractsIn('agent');
const nuxt = contractsIn('nuxt');

/**
 * El contrato que usan el agente (FastAPI) y la web (Nuxt): sus operaciones
 * guardadas tienen que seguir siendo válidas con el esquema esperado y caber
 * en los límites de profundidad y coste con sus límites por defecto.
 */
describe('contrato GraphQL de FastAPI y Nuxt', () => {
  it('hay operaciones para el agente y para cada pantalla', () => {
    expect(agent.length).toBeGreaterThanOrEqual(10);
    expect(nuxt.map(({ file }) => file)).toEqual([
      'nuxt/borrador.graphql',
      'nuxt/evaluacion.graphql',
      'nuxt/feed.graphql',
      'nuxt/hoja.graphql',
      'nuxt/libros.graphql',
      'nuxt/proyecto.graphql',
      'nuxt/reglas.graphql',
      'nuxt/visor.graphql',
    ]);
  });

  it.each([...agent, ...nuxt])(
    '$file es válido con el esquema, la profundidad y el coste',
    ({ document }) => {
      const errors = validate(schema, document, [
        ...specifiedRules,
        maxQueryDepth(GRAPHQL_MAX_DEPTH),
      ]);
      expect(errors.map((error) => error.message)).toEqual([]);
      for (const operation of operationsOf(document)) {
        expect(operation.name).toBeDefined();
        const cost = operationCost(schema, operation, fragmentsOf(document));
        expect({ operation: operation.name?.value, cost }).toEqual({
          operation: operation.name?.value,
          cost: expect.any(Number),
        });
        expect(cost).toBeLessThanOrEqual(MAX_QUERY_COST);
      }
    },
  );

  it('los nombres de operación no se repiten en el contrato del agente', () => {
    const names = agent.flatMap(({ document }) =>
      operationsOf(document).map((operation) => operation.name?.value),
    );
    expect(new Set(names).size).toBe(names.length);
  });

  it('el agente no usa ninguna operación que la ficha 05 le prohíbe', () => {
    for (const { file, document } of agent) {
      const forbidden = [...fieldsUsed(schema, document)].filter((field) =>
        FORBIDDEN_FOR_AGENT.has(field),
      );
      expect({ file, forbidden }).toEqual({ file, forbidden: [] });
    }
  });

  it('las 24 prohibidas existen en el esquema (si una cambia de nombre, se nota)', () => {
    for (const coordinate of FORBIDDEN_FOR_AGENT) {
      const [type, field] = coordinate.split('.');
      const object = schema.getType(type);
      expect(
        object && 'getFields' in object && field in object.getFields(),
      ).toBe(true);
    }
    expect(FORBIDDEN_FOR_AGENT.size).toBe(24);
  });
});
