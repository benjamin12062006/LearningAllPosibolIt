import { describe, expect, it } from '@jest/globals';
import { parseValue } from 'graphql';
import { JsonObjectScalar } from '../../../src/graphql/common/json-object.scalar.js';

describe('JSONObject', () => {
  it('admite un objeto por variable y lo devuelve tal cual', () => {
    const filter = { and: [{ column: 'c1', op: 'eq', value: 3 }] };
    expect(JsonObjectScalar.parseValue(filter)).toBe(filter);
  });

  it('rechaza por variable lo que no es un objeto', () => {
    for (const value of [null, [], 'texto', 3, true]) {
      expect(() => JsonObjectScalar.parseValue(value)).toThrow(
        'JSONObject solo admite un objeto.',
      );
    }
  });

  it('lee un objeto escrito en la consulta, con variables dentro', () => {
    const literal = parseValue(
      '{ column: "c1", values: [1, $n], deep: { ok: true } }',
    );
    expect(JsonObjectScalar.parseLiteral(literal, { n: 2 })).toEqual({
      column: 'c1',
      values: [1, 2],
      deep: { ok: true },
    });
  });

  it('rechaza en la consulta lo que no es un objeto', () => {
    for (const source of ['[1]', '"texto"', '3', 'null']) {
      expect(() =>
        JsonObjectScalar.parseLiteral(parseValue(source), {}),
      ).toThrow('JSONObject solo admite un objeto.');
    }
  });
});
