import { GraphQLScalarType, Kind, valueFromASTUntyped } from 'graphql';

/**
 * Entrada para lo que ya es un árbol validado por un analizador del dominio
 * (filtro de filas, operaciones de un borrador, plantilla de mapeo…): solo un
 * objeto, como el `@IsObject()` de REST. Lo demás lo valida el servicio
 * (plan C7, G5).
 */
export const JsonObjectScalar = new GraphQLScalarType({
  name: 'JSONObject',
  description: 'Objeto JSON de entrada; lo valida el servicio, como en REST.',
  serialize: (value) => value,
  parseValue: (value) => {
    if (!isPlainObject(value)) {
      throw new TypeError('JSONObject solo admite un objeto.');
    }
    return value;
  },
  parseLiteral: (ast, variables) => {
    if (ast.kind !== Kind.OBJECT) {
      throw new TypeError('JSONObject solo admite un objeto.');
    }
    return valueFromASTUntyped(ast, variables);
  },
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
