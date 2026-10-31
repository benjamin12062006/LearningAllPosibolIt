import { GraphQLScalarType } from 'graphql';

/** Solo salida: devuelve objetos JSON tal como los guarda PostgreSQL. */
export const JsonScalar = new GraphQLScalarType({
  name: 'JSON',
  description: 'Objeto JSON de solo lectura.',
  serialize: (value) => value,
  parseValue: () => {
    throw new TypeError('JSON no se acepta como entrada.');
  },
  parseLiteral: () => {
    throw new TypeError('JSON no se acepta como entrada.');
  },
});
